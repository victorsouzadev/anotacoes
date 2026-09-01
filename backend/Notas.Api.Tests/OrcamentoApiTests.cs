using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Notas.Api.Tests;

// Integração da ferramenta de orçamento: sobe a API inteira e exercita o ciclo
// completo (cadastrar distribuição, lançar despesas, acompanhar).
public class OrcamentoApiTests : IClassFixture<OrcamentoApiTests.Contexto>
{
    // Um usuário só para toda a classe: o endpoint de registro tem limite por IP,
    // e registrar um usuário por teste estoura a cota e faz os testes falharem
    // por 429 em vez de pelo que estão verificando. O isolamento entre testes vem
    // de cada um usar uma competência (ano/mês) própria.
    public class Contexto : IAsyncLifetime
    {
        public TasksApiFactory Factory { get; } = new();
        public HttpClient Client { get; private set; } = null!;

        public async Task InitializeAsync()
        {
            Client = Factory.CreateClient();
            var email = $"orc_{Guid.NewGuid():N}@example.com";
            var res = await Factory.CreateClient().PostAsJsonAsync("/api/auth/register",
                new { email, password = "Sup3rSecret!" });
            res.EnsureSuccessStatusCode();
            var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
            Client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        }

        public async Task DisposeAsync()
        {
            Client.Dispose();
            await Factory.DisposeAsync();
        }
    }

    private static int _proximoMes;

    private readonly Contexto _ctx;
    private readonly HttpClient _client;

    // Cada teste recebe sua própria competência, para que um não enxergue os
    // lançamentos nem o orçamento do outro.
    private readonly int Ano;
    private readonly int Mes;

    public OrcamentoApiTests(Contexto ctx)
    {
        _ctx = ctx;
        _client = ctx.Client;

        // Competências no passado: o PATCH de lançamento recusa datas mais de um
        // ano à frente, e os testes precisam gravar transações nesse mês.
        var indice = Interlocked.Increment(ref _proximoMes);
        Ano = 2024 - indice / 12;
        Mes = indice % 12 + 1;
    }

    private object Payload(decimal valorTotal, params (string Categoria, decimal Percentual)[] itens) => new
    {
        ano = Ano,
        mes = Mes,
        valorTotal,
        itens = itens.Select(i => new { categoria = i.Categoria, percentual = i.Percentual }).ToArray(),
        observacoes = (string?)null,
    };

    // Mês seguinte ao da competência do teste, sem estourar dezembro.
    private (int Ano, int Mes) MesDestino => Mes == 12 ? (Ano + 1, 1) : (Ano, Mes + 1);

    private Task<HttpResponseMessage> Salvar(object payload) =>
        _client.PutAsJsonAsync("/api/financas/orcamentos", payload);

    private static async Task<string> Erro(HttpResponseMessage res) =>
        (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("erro").GetString()!;

    [Fact]
    public async Task SalvaEDevolveDistribuicaoEmReais()
    {
        var res = await Salvar(Payload(4000m, ("Moradia", 50m), ("Alimentacao", 30m), ("Investimentos", 20m)));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var orcamento = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(4000m, orcamento.GetProperty("valorTotal").GetDecimal());

        var itens = orcamento.GetProperty("itens").EnumerateArray().ToList();
        Assert.Equal(3, itens.Count);

        // Ordenado por percentual, então moradia (50%) vem primeiro.
        Assert.Equal("Moradia", itens[0].GetProperty("categoria").GetString());
        Assert.Equal(2000m, itens[0].GetProperty("valorPlanejado").GetDecimal());
        Assert.Equal("Moradia", itens[0].GetProperty("categoriaRotulo").GetString());
        Assert.Equal("Essenciais", itens[0].GetProperty("grupo").GetString());

        Assert.Equal(4000m, itens.Sum(i => i.GetProperty("valorPlanejado").GetDecimal()));
    }

    [Fact]
    public async Task SalvarDuasVezesSubstituiEmVezDeDuplicar()
    {
        await Salvar(Payload(1000m, ("Moradia", 60m), ("Lazer", 40m)));
        await Salvar(Payload(2000m, ("Moradia", 70m), ("Saude", 30m)));

        var res = await _client.GetAsync($"/api/financas/orcamentos/atual?ano={Ano}&mes={Mes}");
        var orcamento = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(2000m, orcamento.GetProperty("valorTotal").GetDecimal());
        var categorias = orcamento.GetProperty("itens").EnumerateArray()
            .Select(i => i.GetProperty("categoria").GetString()).ToList();
        Assert.Equal(new[] { "Moradia", "Saude" }, categorias);

        // E continua havendo um único orçamento para o mês.
        var lista = await _client.GetFromJsonAsync<JsonElement>("/api/financas/orcamentos");
        Assert.Equal(1, lista.EnumerateArray().Count(o => o.GetProperty("mes").GetInt32() == Mes));
    }

    [Fact]
    public async Task DistribuicaoQueNaoSomaCemEhRejeitada()
    {
        var res = await Salvar(Payload(1000m, ("Moradia", 50m), ("Lazer", 30m)));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);

        var erro = await Erro(res);
        Assert.Contains("100%", erro);
        Assert.Contains("faltam 20", erro);
    }

    [Fact]
    public async Task CategoriaRepetidaEhRejeitada()
    {
        var res = await Salvar(Payload(1000m, ("Lazer", 50m), ("Lazer", 50m)));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("mais de uma vez", await Erro(res));
    }

    [Fact]
    public async Task CategoriaDeReceitaNaoEntraNaDistribuicao()
    {
        var res = await Salvar(Payload(1000m, ("Salario", 100m)));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("receita", await Erro(res));
    }

    [Fact]
    public async Task ValorTotalZeradoEhRejeitado()
    {
        var res = await Salvar(Payload(0m, ("Moradia", 100m)));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("maior que zero", await Erro(res));
    }

    [Fact]
    public async Task MesInvalidoEhRejeitado()
    {
        var res = await _client.PutAsJsonAsync("/api/financas/orcamentos", new
        {
            ano = Ano,
            mes = 13,
            valorTotal = 1000m,
            itens = new[] { new { categoria = "Moradia", percentual = 100m } },
            observacoes = (string?)null,
        });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("Mês inválido", await Erro(res));
    }

    [Fact]
    public async Task MesSemOrcamentoDevolve204()
    {
        var res = await _client.GetAsync("/api/financas/orcamentos/atual?ano=2030&mes=1");
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
    }

    [Fact]
    public async Task AcompanhamentoCruzaPlanejadoComRealizado()
    {
        await Salvar(Payload(1000m, ("Alimentacao", 60m), ("Lazer", 40m)));

        // 500 em alimentação (83% do planejado de 600) e 500 em lazer (125% de 400).
        await LancarDespesa("Alimentacao", 500m);
        await LancarDespesa("Lazer", 500m);

        var r = await _client.GetFromJsonAsync<JsonElement>(
            $"/api/financas/orcamentos/acompanhamento?ano={Ano}&mes={Mes}");

        Assert.True(r.GetProperty("temOrcamento").GetBoolean());
        Assert.Equal(1000m, r.GetProperty("totalPlanejado").GetDecimal());
        Assert.Equal(1000m, r.GetProperty("totalRealizado").GetDecimal());
        Assert.Equal(0m, r.GetProperty("saldoDisponivel").GetDecimal());

        var itens = r.GetProperty("itens").EnumerateArray().ToList();
        var alimentacao = itens.Single(i => i.GetProperty("categoria").GetString() == "Alimentacao");
        Assert.Equal(600m, alimentacao.GetProperty("valorPlanejado").GetDecimal());
        Assert.Equal(500m, alimentacao.GetProperty("valorRealizado").GetDecimal());
        Assert.Equal(100m, alimentacao.GetProperty("valorRestante").GetDecimal());
        Assert.Equal("atencao", alimentacao.GetProperty("situacao").GetString());

        var lazer = itens.Single(i => i.GetProperty("categoria").GetString() == "Lazer");
        Assert.Equal(-100m, lazer.GetProperty("valorRestante").GetDecimal());
        Assert.Equal("estourado", lazer.GetProperty("situacao").GetString());
    }

    [Fact]
    public async Task GastoEmCategoriaForaDoOrcamentoApareceNoAcompanhamento()
    {
        await Salvar(Payload(1000m, ("Moradia", 100m)));
        await LancarDespesa("Transporte", 80m);

        var r = await _client.GetFromJsonAsync<JsonElement>(
            $"/api/financas/orcamentos/acompanhamento?ano={Ano}&mes={Mes}");

        var transporte = r.GetProperty("itens").EnumerateArray()
            .Single(i => i.GetProperty("categoria").GetString() == "Transporte");

        Assert.Equal(0m, transporte.GetProperty("valorPlanejado").GetDecimal());
        Assert.Equal(80m, transporte.GetProperty("valorRealizado").GetDecimal());
        Assert.Equal("sem_orcamento", transporte.GetProperty("situacao").GetString());

        // O total realizado precisa incluir o que ficou de fora do orçamento,
        // senão a tela não bate com o extrato.
        Assert.Equal(80m, r.GetProperty("totalRealizado").GetDecimal());
    }

    [Fact]
    public async Task AcompanhamentoDeMesSemOrcamentoAindaMostraRealizado()
    {
        await LancarDespesa("Compras", 250m);

        var r = await _client.GetFromJsonAsync<JsonElement>(
            $"/api/financas/orcamentos/acompanhamento?ano={Ano}&mes={Mes}");

        Assert.False(r.GetProperty("temOrcamento").GetBoolean());
        Assert.Equal(0m, r.GetProperty("totalPlanejado").GetDecimal());
        Assert.Equal(250m, r.GetProperty("totalRealizado").GetDecimal());
    }

    [Fact]
    public async Task ReceitasNaoContamComoRealizado()
    {
        await Salvar(Payload(1000m, ("Moradia", 100m)));
        await LancarTransacao("Salario", 5000m, "receita");

        var r = await _client.GetFromJsonAsync<JsonElement>(
            $"/api/financas/orcamentos/acompanhamento?ano={Ano}&mes={Mes}");

        Assert.Equal(0m, r.GetProperty("totalRealizado").GetDecimal());
    }

    [Fact]
    public async Task CopiaDistribuicaoParaOutroMes()
    {
        await Salvar(Payload(3000m, ("Moradia", 50m), ("Alimentacao", 50m)));

        var res = await _client.PostAsJsonAsync("/api/financas/orcamentos/copiar", new
        {
            anoOrigem = Ano, mesOrigem = Mes,
            anoDestino = MesDestino.Ano, mesDestino = MesDestino.Mes,
            valorTotal = 3600m,
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var copia = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(MesDestino.Mes, copia.GetProperty("mes").GetInt32());
        Assert.Equal(3600m, copia.GetProperty("valorTotal").GetDecimal());

        // Os percentuais são preservados; os valores reescalam com o novo total.
        var itens = copia.GetProperty("itens").EnumerateArray().ToList();
        Assert.All(itens, i => Assert.Equal(50m, i.GetProperty("percentual").GetDecimal()));
        Assert.All(itens, i => Assert.Equal(1800m, i.GetProperty("valorPlanejado").GetDecimal()));
    }

    [Fact]
    public async Task CopiarDeMesInexistenteFalha()
    {
        var res = await _client.PostAsJsonAsync("/api/financas/orcamentos/copiar", new
        {
            anoOrigem = 2029, mesOrigem = 11,
            anoDestino = Ano, mesDestino = Mes,
            valorTotal = (decimal?)null,
        });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("Não há orçamento", await Erro(res));
    }

    [Fact]
    public async Task RemoveOrcamento()
    {
        await Salvar(Payload(1000m, ("Moradia", 100m)));

        var del = await _client.DeleteAsync($"/api/financas/orcamentos/{Ano}/{Mes}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        var res = await _client.GetAsync($"/api/financas/orcamentos/atual?ano={Ano}&mes={Mes}");
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);

        // Segunda remoção não encontra nada.
        Assert.Equal(HttpStatusCode.NotFound, (await _client.DeleteAsync($"/api/financas/orcamentos/{Ano}/{Mes}")).StatusCode);
    }

    [Fact]
    public async Task OrcamentoDeOutroUsuarioNaoEhVisivel()
    {
        await Salvar(Payload(9999m, ("Moradia", 100m)));

        var outro = _ctx.Factory.CreateClient();
        var email = $"outro_{Guid.NewGuid():N}@example.com";
        var reg = await outro.PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        reg.EnsureSuccessStatusCode();
        var token = (await reg.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        outro.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var res = await outro.GetAsync($"/api/financas/orcamentos/atual?ano={Ano}&mes={Mes}");
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);

        Assert.Equal(HttpStatusCode.NotFound, (await outro.DeleteAsync($"/api/financas/orcamentos/{Ano}/{Mes}")).StatusCode);
    }

    [Fact]
    public async Task ExigeAutenticacao()
    {
        var anonimo = _ctx.Factory.CreateClient();
        var res = await anonimo.GetAsync("/api/financas/orcamentos/atual");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task ModelosVemComValoresJaCalculados()
    {
        var modelos = await _client.GetFromJsonAsync<JsonElement>("/api/financas/orcamentos/modelos?valorTotal=5000");
        var lista = modelos.EnumerateArray().ToList();

        Assert.NotEmpty(lista);
        foreach (var modelo in lista)
        {
            var itens = modelo.GetProperty("itens").EnumerateArray().ToList();
            Assert.Equal(100m, itens.Sum(i => i.GetProperty("percentual").GetDecimal()));
            Assert.Equal(5000m, itens.Sum(i => i.GetProperty("valorPlanejado").GetDecimal()));
        }
    }

    [Fact]
    public async Task ModeloAplicadoEhAceitoPelaValidacao()
    {
        var modelos = await _client.GetFromJsonAsync<JsonElement>("/api/financas/orcamentos/modelos?valorTotal=5000");

        foreach (var modelo in modelos.EnumerateArray())
        {
            var itens = modelo.GetProperty("itens").EnumerateArray()
                .Select(i => new
                {
                    categoria = i.GetProperty("categoria").GetString(),
                    percentual = i.GetProperty("percentual").GetDecimal(),
                }).ToArray();

            var res = await _client.PutAsJsonAsync("/api/financas/orcamentos", new
            {
                ano = Ano, mes = Mes, valorTotal = 5000m, itens, observacoes = (string?)null,
            });
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        }
    }

    [Fact]
    public async Task ListaDeCategoriasOrcaveisNaoIncluiReceita()
    {
        var categorias = await _client.GetFromJsonAsync<JsonElement>("/api/financas/orcamentos/categorias");
        var nomes = categorias.EnumerateArray().Select(c => c.GetProperty("categoria").GetString()).ToList();

        Assert.DoesNotContain("Salario", nomes);
        Assert.Contains("Moradia", nomes);
        Assert.All(categorias.EnumerateArray(), c => Assert.False(
            string.IsNullOrWhiteSpace(c.GetProperty("rotulo").GetString())));
    }

    // ------------------------------------------------------------------ apoio

    private Task LancarDespesa(string categoria, decimal valor) => LancarTransacao(categoria, valor, "despesa");

    // Cria o lançamento pelo texto livre e corrige via PATCH para a categoria/valor
    // exatos do teste — assim o caminho de escrita exercitado é o real.
    private async Task LancarTransacao(string categoria, decimal valor, string tipo)
    {
        var criada = await _client.PostAsJsonAsync("/api/financas/transacoes", new { texto = $"gastei {valor} reais" });
        criada.EnsureSuccessStatusCode();
        var id = (await criada.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();

        var patch = await _client.PatchAsJsonAsync($"/api/financas/transacoes/{id}", new
        {
            valor,
            tipo = tipo == "receita" ? "Receita" : "Despesa",
            categoria,
            data = $"{Ano:D4}-{Mes:D2}-10",
        });
        patch.EnsureSuccessStatusCode();
    }
}
