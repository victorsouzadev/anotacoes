using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api.Data;
using Notas.Api.Services.Financas;
using Xunit;

namespace Notas.Api.Tests;

// As metodologias de planejamento sobre lançamentos montados à mão.
public class PlanejamentoTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private readonly TasksApiFactory _factory;
    private HttpClient _client = null!;
    private string _userId = "";

    public PlanejamentoTests(TasksApiFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _client = _factory.CreateClient();
        var res = await _client.PostAsJsonAsync("/api/auth/register",
            new { email = $"plan_{Guid.NewGuid():N}@example.com", password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var corpo = await res.Content.ReadFromJsonAsync<JsonElement>();
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", corpo.GetProperty("accessToken").GetString());
        _userId = corpo.GetProperty("user").GetProperty("id").GetString()!;
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        return Task.CompletedTask;
    }

    private async Task Lancar(params (int Mes, Categoria Cat, TipoTransacao Tipo, decimal Valor, string Desc)[] itens)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        foreach (var (mes, cat, tipo, valor, desc) in itens)
            db.Transacoes.Add(new Transacao
            {
                UserId = _userId, Descricao = desc, Valor = valor, Tipo = tipo, Categoria = cat,
                Data = new DateOnly(2026, mes, 5), Status = StatusTransacao.Confirmado,
            });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Saude_calcula_taxa_de_poupanca_reserva_e_independencia()
    {
        await Lancar(
            (8, Categoria.Salario, TipoTransacao.Receita, 10000, "Salário"),
            (8, Categoria.Moradia, TipoTransacao.Despesa, 3000, "Aluguel"),
            (8, Categoria.Lazer, TipoTransacao.Despesa, 2000, "Viagem"),
            (9, Categoria.Salario, TipoTransacao.Receita, 10000, "Salário"),
            (9, Categoria.Moradia, TipoTransacao.Despesa, 3000, "Aluguel"),
            (9, Categoria.Investimentos, TipoTransacao.Despesa, 1000, "CDB"));

        (await _client.PutAsJsonAsync("/api/financas/planejamento/preferencias",
            new { mesesReserva = 6, percentualPagueSePrimeiro = 20, patrimonioInvestido = 50000 })).EnsureSuccessStatusCode();

        var s = await _client.GetFromJsonAsync<JsonElement>("/api/financas/planejamento/saude?ano=2026&mes=9");
        // O CDB é poupança, não consumo: setembro consumiu 3.000 de 10.000.
        Assert.Equal(70m, s.GetProperty("taxaPoupanca").GetDecimal());
        Assert.Equal(60m, s.GetProperty("taxaPoupancaMedia").GetDecimal());     // (20000-8000)/20000
        Assert.Equal(3000m, s.GetProperty("gastoEssencialMedio").GetDecimal());
        Assert.Equal(18000m, s.GetProperty("reservaAlvo").GetDecimal());
        Assert.Equal(2000m, s.GetProperty("valorPagueSePrimeiro").GetDecimal());
        Assert.Equal(1000m, s.GetProperty("guardadoNoMes").GetDecimal());
        // Consumo médio 4.000/mês → 48.000/ano → alvo 1,2 milhão (25×).
        Assert.Equal(1200000m, s.GetProperty("patrimonioAlvo").GetDecimal());
        Assert.True(s.GetProperty("anosParaIndependencia").GetDecimal() > 0);
    }

    [Fact]
    public async Task Metodo_50_30_20_distribui_as_despesas_nas_fatias()
    {
        await Lancar(
            (7, Categoria.Salario, TipoTransacao.Receita, 5000, "Salário"),
            (7, Categoria.Alimentacao, TipoTransacao.Despesa, 1000, "Mercado"),
            (7, Categoria.Lazer, TipoTransacao.Despesa, 500, "Cinema"),
            (7, Categoria.Investimentos, TipoTransacao.Despesa, 700, "Tesouro"));

        var m = await _client.GetFromJsonAsync<JsonElement>("/api/financas/planejamento/metodo?ano=2026&mes=7&metodo=50-30-20");
        var fatias = m.GetProperty("fatias").EnumerateArray().ToDictionary(f => f.GetProperty("chave").GetString()!);
        Assert.Equal(2500m, fatias["necessidades"].GetProperty("planejado").GetDecimal());
        Assert.Equal(1000m, fatias["necessidades"].GetProperty("realizado").GetDecimal());
        Assert.Equal(500m, fatias["desejos"].GetProperty("realizado").GetDecimal());
        Assert.Equal(700m, fatias["poupanca"].GetProperty("realizado").GetDecimal());
        Assert.Equal(70m, fatias["poupanca"].GetProperty("utilizado").GetDecimal()); // 700 de 1000
    }

    [Fact]
    public void Avalanche_paga_menos_juros_e_bola_de_neve_quita_a_menor_primeiro()
    {
        var dividas = new List<Divida>
        {
            new() { Nome = "Cartão", Saldo = 5000, JurosMensal = 12, ParcelaMinima = 300 },
            new() { Nome = "Empréstimo", Saldo = 1000, JurosMensal = 2, ParcelaMinima = 100 },
        };
        var r = PlanejamentoService.SimularDividas(dividas, 600);

        Assert.True(r.Avalanche.Viavel && r.BolaDeNeve.Viavel);
        Assert.Equal("Empréstimo", r.BolaDeNeve.Ordem[0].Nome);
        Assert.Equal("Cartão", r.Avalanche.Ordem[0].Nome);
        Assert.True(r.Avalanche.JurosTotais < r.BolaDeNeve.JurosTotais);
        Assert.Contains("avalanche economiza", r.Recomendacao);
    }

    [Fact]
    public void Pagamento_menor_que_os_juros_nao_e_viavel()
    {
        var r = PlanejamentoService.SimularDividas(
            [new Divida { Nome = "Rotativo", Saldo = 10000, JurosMensal = 15, ParcelaMinima = 500 }], 0);
        Assert.False(r.Avalanche.Viavel);
        Assert.Contains("juros crescem", r.Recomendacao);
    }

    [Fact]
    public async Task Provisao_divide_por_doze_e_indica_atraso()
    {
        var res = await _client.PostAsJsonAsync("/api/financas/planejamento/provisoes",
            new { nome = "IPVA", valor = 2400, mesVencimento = 1, valorReservado = 0 });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var p = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(200m, p.GetProperty("valorMensal").GetDecimal());

        var lista = await _client.GetFromJsonAsync<JsonElement>("/api/financas/planejamento/provisoes");
        Assert.Equal(200m, lista.GetProperty("totalMensal").GetDecimal());

        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PostAsJsonAsync("/api/financas/planejamento/provisoes",
            new { nome = "X", valor = 10, mesVencimento = 13 })).StatusCode);
    }

    [Fact]
    public void Provisao_em_dia_atrasada_e_completa()
    {
        var hoje = new DateOnly(2026, 10, 11);
        // Vence em janeiro: faltam 4 meses (out, nov, dez, jan); esperado 9/12.
        var atrasada = PlanejamentoService.MontarProvisao(
            new ProvisaoAnual { Nome = "IPVA", Valor = 1200, MesVencimento = 1, ValorReservado = 100 }, hoje);
        Assert.Equal(4, atrasada.MesesRestantes);
        Assert.Equal("atrasada", atrasada.Situacao);
        Assert.Equal(275m, atrasada.NecessarioPorMes); // (1200-100)/4

        Assert.Equal("em-dia", PlanejamentoService.MontarProvisao(
            new ProvisaoAnual { Nome = "IPVA", Valor = 1200, MesVencimento = 1, ValorReservado = 900 }, hoje).Situacao);
        Assert.Equal("completa", PlanejamentoService.MontarProvisao(
            new ProvisaoAnual { Nome = "IPVA", Valor = 1200, MesVencimento = 1, ValorReservado = 1200 }, hoje).Situacao);
    }

    [Fact]
    public async Task Fechamento_guarda_as_respostas_e_compara_com_o_mes_anterior()
    {
        await Lancar(
            (5, Categoria.Alimentacao, TipoTransacao.Despesa, 800, "Mercado"),
            (6, Categoria.Salario, TipoTransacao.Receita, 4000, "Salário"),
            (6, Categoria.Alimentacao, TipoTransacao.Despesa, 1000, "Mercado"));

        var res = await _client.PutAsJsonAsync("/api/financas/planejamento/fechamento/2026/6",
            new { metaPoupanca = 1500, reflexao = "Gastei muito com delivery", compromisso = "Cozinhar mais" });
        res.EnsureSuccessStatusCode();

        var f = await _client.GetFromJsonAsync<JsonElement>("/api/financas/planejamento/fechamento/2026/6");
        Assert.Equal(3000m, f.GetProperty("saldo").GetDecimal());
        Assert.Equal("Cozinhar mais", f.GetProperty("compromisso").GetString());
        var alimentacao = f.GetProperty("categorias")[0];
        Assert.Equal(1000m, alimentacao.GetProperty("valor").GetDecimal());
        Assert.Equal(800m, alimentacao.GetProperty("valorMesAnterior").GetDecimal());
    }

    [Fact]
    public async Task Envelope_acumula_o_que_sobrou_do_mes_anterior()
    {
        foreach (var mes in new[] { 3, 4 })
            (await _client.PutAsJsonAsync("/api/financas/orcamentos", new
            {
                ano = 2026, mes, valorTotal = 1000m,
                itens = new[] { new { categoria = "Lazer", percentual = 100m } }, observacoes = (string?)null,
            })).EnsureSuccessStatusCode();
        await Lancar((3, Categoria.Lazer, TipoTransacao.Despesa, 600, "Bar"), (4, Categoria.Lazer, TipoTransacao.Despesa, 1100, "Show"));

        var envelopes = await _client.GetFromJsonAsync<JsonElement>("/api/financas/planejamento/envelopes?ano=2026&mes=4");
        var lazer = envelopes.EnumerateArray().Single(e => e.GetProperty("categoria").GetString() == "Lazer");
        // Sobraram 400 em março; abril gastou 100 a mais: ficam 300 no envelope.
        Assert.Equal(300m, lazer.GetProperty("saldoAcumulado").GetDecimal());
    }

    [Fact]
    public void Independencia_financeira_em_anos()
    {
        Assert.Equal(0m, PlanejamentoService.AnosParaAlvo(100, 0, 50));
        Assert.Null(PlanejamentoService.AnosParaAlvo(0, 0, 1000));
        var anos = PlanejamentoService.AnosParaAlvo(0, 1000, 120000)!.Value;
        Assert.InRange(anos, 8m, 10m); // 120 mil a 1.000/mês com 4% a.a. ≈ 8,7 anos
    }

    [Fact]
    public async Task Fluxo_projeta_recorrentes_e_avisa_o_dia_negativo()
    {
        DateOnly hoje;
        using (var scope = _factory.Services.CreateScope())
        {
            hoje = scope.ServiceProvider.GetRequiredService<FinancasClock>().Hoje();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            // Aluguel de 3.000 nos três meses anteriores, sempre no dia 1, e um
            // salário de 2.000 no dia 2 — o mês que vem deve fechar no vermelho.
            for (var i = 1; i <= 3; i++)
            {
                var m = new DateOnly(hoje.Year, hoje.Month, 1).AddMonths(-i);
                db.Transacoes.Add(new Transacao { UserId = _userId, Descricao = "Aluguel apartamento", Valor = 3000,
                    Tipo = TipoTransacao.Despesa, Categoria = Categoria.Moradia, Data = m, Status = StatusTransacao.Confirmado });
                db.Transacoes.Add(new Transacao { UserId = _userId, Descricao = "Salario empresa", Valor = 2000,
                    Tipo = TipoTransacao.Receita, Categoria = Categoria.Salario, Data = m.AddDays(1), Status = StatusTransacao.Confirmado });
            }
            await db.SaveChangesAsync();
        }

        (await _client.PutAsJsonAsync("/api/financas/planejamento/preferencias", new { saldoInicialFluxo = 500 }))
            .EnsureSuccessStatusCode();
        var f = await _client.GetFromJsonAsync<JsonElement>("/api/financas/planejamento/fluxo?dias=60");

        Assert.Equal("informado", f.GetProperty("origemSaldo").GetString());
        var eventos = f.GetProperty("eventos").EnumerateArray().ToList();
        Assert.Contains(eventos, e => e.GetProperty("descricao").GetString() == "Aluguel apartamento"
                                      && e.GetProperty("valor").GetDecimal() == -3000m);
        Assert.Contains(eventos, e => e.GetProperty("valor").GetDecimal() == 2000m);
        Assert.Equal(JsonValueKind.String, f.GetProperty("primeiroDiaNegativo").ValueKind);
        Assert.Equal(61, f.GetProperty("pontos").GetArrayLength());
    }
}
