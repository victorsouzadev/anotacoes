using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Notas.Api.Tests;

// Metas de reserva: progresso, ritmo, vínculo com lançamentos de investimento.
public class MetasApiTests : IClassFixture<MetasApiTests.Contexto>
{
    public class Contexto : IAsyncLifetime
    {
        public TasksApiFactory Factory { get; } = new();
        public HttpClient Client { get; private set; } = null!;

        public async Task InitializeAsync()
        {
            Client = Factory.CreateClient();
            var res = await Factory.CreateClient().PostAsJsonAsync("/api/auth/register",
                new { email = $"meta_{Guid.NewGuid():N}@example.com", password = "Sup3rSecret!" });
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

    private readonly Contexto _ctx;
    private readonly HttpClient _client;

    public MetasApiTests(Contexto ctx)
    {
        _ctx = ctx;
        _client = ctx.Client;
    }

    private async Task<JsonElement> CriarMeta(decimal alvo = 10000m, DateOnly? dataAlvo = null, string? nome = null)
    {
        var res = await _client.PostAsJsonAsync("/api/financas/metas", new
        {
            nome = nome ?? $"Reserva {Guid.NewGuid():N}"[..20],
            valorAlvo = alvo,
            dataAlvo,
            observacoes = (string?)null,
        });
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    private Task<HttpResponseMessage> Aportar(string metaId, decimal? valor, DateOnly? data = null, Guid? transacaoId = null) =>
        _client.PostAsJsonAsync($"/api/financas/metas/{metaId}/aportes", new
        {
            valor, data, observacoes = (string?)null, transacaoId,
        });

    private static async Task<string> Erro(HttpResponseMessage res) =>
        (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("erro").GetString()!;

    private static string Id(JsonElement meta) => meta.GetProperty("id").GetString()!;

    [Fact]
    public async Task CriaMetaComProgressoZerado()
    {
        var meta = await CriarMeta(10000m);

        Assert.Equal(10000m, meta.GetProperty("valorAlvo").GetDecimal());
        Assert.Equal(0m, meta.GetProperty("valorAcumulado").GetDecimal());
        Assert.Equal(10000m, meta.GetProperty("valorRestante").GetDecimal());
        Assert.Equal(0m, meta.GetProperty("percentualConcluido").GetDecimal());
        Assert.False(meta.GetProperty("concluida").GetBoolean());
        Assert.Equal("sem_prazo", meta.GetProperty("situacao").GetString());
    }

    [Fact]
    public async Task AporteAvulsoAvancaOProgresso()
    {
        var meta = await CriarMeta(1000m);

        var res = await Aportar(Id(meta), 250m);
        res.EnsureSuccessStatusCode();
        var atualizada = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(250m, atualizada.GetProperty("valorAcumulado").GetDecimal());
        Assert.Equal(750m, atualizada.GetProperty("valorRestante").GetDecimal());
        Assert.Equal(25m, atualizada.GetProperty("percentualConcluido").GetDecimal());
        Assert.Single(atualizada.GetProperty("aportes").EnumerateArray());
    }

    [Fact]
    public async Task AtingirOAlvoConcluiAMeta()
    {
        var meta = await CriarMeta(500m);
        await Aportar(Id(meta), 300m);
        var res = await Aportar(Id(meta), 200m);

        var final = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(final.GetProperty("concluida").GetBoolean());
        Assert.Equal("concluida", final.GetProperty("situacao").GetString());
        Assert.Equal(0m, final.GetProperty("valorRestante").GetDecimal());
    }

    [Fact]
    public async Task RemoverAporteReabreAMetaConcluida()
    {
        var meta = await CriarMeta(500m);
        var comAporte = await (await Aportar(Id(meta), 500m)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(comAporte.GetProperty("concluida").GetBoolean());

        var aporteId = comAporte.GetProperty("aportes")[0].GetProperty("id").GetString();
        var res = await _client.DeleteAsync($"/api/financas/metas/{Id(meta)}/aportes/{aporteId}");
        res.EnsureSuccessStatusCode();

        var depois = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(depois.GetProperty("concluida").GetBoolean());
        Assert.Equal(0m, depois.GetProperty("valorAcumulado").GetDecimal());
    }

    [Fact]
    public async Task AporteAcimaDoAlvoNaoPassaDeCemPorCentoNoRestante()
    {
        var meta = await CriarMeta(100m);
        var res = await Aportar(Id(meta), 250m);

        var final = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(250m, final.GetProperty("valorAcumulado").GetDecimal());
        // O restante nunca fica negativo — "faltam -150" não diz nada ao usuário.
        Assert.Equal(0m, final.GetProperty("valorRestante").GetDecimal());
        Assert.Equal(250m, final.GetProperty("percentualConcluido").GetDecimal());
    }

    [Fact]
    public async Task MetaComPrazoCalculaOAporteMensalNecessario()
    {
        // Prazo daqui a 3 meses (contando o mês corrente) para R$ 900 → R$ 300/mês.
        var hoje = DateTime.UtcNow;
        var alvo = new DateOnly(hoje.Year, hoje.Month, 1).AddMonths(2);
        var meta = await CriarMeta(900m, alvo);

        Assert.Equal(3, meta.GetProperty("mesesRestantes").GetInt32());
        Assert.Equal(300m, meta.GetProperty("aporteMensalNecessario").GetDecimal());
    }

    [Fact]
    public async Task MetaSemAporteEComPrazoApertadoFicaAtrasada()
    {
        var hoje = DateTime.UtcNow;
        var meta = await CriarMeta(9000m, new DateOnly(hoje.Year, hoje.Month, 1).AddMonths(1));

        Assert.Equal("atrasada", meta.GetProperty("situacao").GetString());
    }

    [Fact]
    public async Task MetaComPrazoVencidoEhMarcadaComoVencida()
    {
        var hoje = DateTime.UtcNow;
        var meta = await CriarMeta(1000m, DateOnly.FromDateTime(hoje).AddMonths(-2));

        Assert.Equal("vencida", meta.GetProperty("situacao").GetString());
    }

    [Fact]
    public async Task VinculaLancamentoDeInvestimentoComoAporte()
    {
        var meta = await CriarMeta(5000m);
        var transacao = await CriarInvestimento(900m);

        var res = await Aportar(Id(meta), valor: null, transacaoId: Guid.Parse(transacao));
        res.EnsureSuccessStatusCode();

        var atualizada = await res.Content.ReadFromJsonAsync<JsonElement>();
        // Valor e data vêm do lançamento, não do corpo da requisição.
        Assert.Equal(900m, atualizada.GetProperty("valorAcumulado").GetDecimal());
        Assert.Equal(transacao, atualizada.GetProperty("aportes")[0].GetProperty("transacaoId").GetString());
    }

    [Fact]
    public async Task OMesmoLancamentoNaoContaEmDuasMetas()
    {
        var meta1 = await CriarMeta(5000m);
        var meta2 = await CriarMeta(5000m);
        var transacao = Guid.Parse(await CriarInvestimento(500m));

        (await Aportar(Id(meta1), null, transacaoId: transacao)).EnsureSuccessStatusCode();

        var res = await Aportar(Id(meta2), null, transacaoId: transacao);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("já foi vinculado", await Erro(res));
    }

    [Fact]
    public async Task LancamentoDeOutraCategoriaNaoViraAporte()
    {
        var meta = await CriarMeta(5000m);
        var transacao = await CriarLancamento("gastei 80 reais no mercado", "Alimentacao", 80m);

        var res = await Aportar(Id(meta), null, transacaoId: Guid.Parse(transacao));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("Investimentos", await Erro(res));
    }

    [Fact]
    public async Task InvestimentoVinculadoSaiDaListaDeDisponiveis()
    {
        var meta = await CriarMeta(5000m);
        var transacao = await CriarInvestimento(700m);

        var antes = await _client.GetFromJsonAsync<JsonElement>("/api/financas/metas/investimentos-disponiveis");
        Assert.Contains(transacao, antes.EnumerateArray().Select(i => i.GetProperty("id").GetString()));

        (await Aportar(Id(meta), null, transacaoId: Guid.Parse(transacao))).EnsureSuccessStatusCode();

        var depois = await _client.GetFromJsonAsync<JsonElement>("/api/financas/metas/investimentos-disponiveis");
        Assert.DoesNotContain(transacao, depois.EnumerateArray().Select(i => i.GetProperty("id").GetString()));
    }

    [Theory]
    [InlineData("", 1000, "nome")]
    [InlineData("Reserva", 0, "maior que zero")]
    [InlineData("Reserva", -50, "maior que zero")]
    public async Task MetaInvalidaEhRejeitada(string nome, decimal alvo, string trecho)
    {
        var res = await _client.PostAsJsonAsync("/api/financas/metas", new
        {
            nome, valorAlvo = alvo, dataAlvo = (DateOnly?)null, observacoes = (string?)null,
        });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains(trecho, await Erro(res), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task AporteSemValorNemTransacaoEhRejeitado()
    {
        var meta = await CriarMeta();
        var res = await Aportar(Id(meta), valor: null);

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("maior que zero", await Erro(res));
    }

    [Fact]
    public async Task AtualizaEArquivaMeta()
    {
        var meta = await CriarMeta(1000m, nome: "Viagem");

        var put = await _client.PutAsJsonAsync($"/api/financas/metas/{Id(meta)}", new
        {
            nome = "Viagem ao Chile", valorAlvo = 7000m, dataAlvo = (DateOnly?)null, observacoes = "com a família",
        });
        put.EnsureSuccessStatusCode();
        var atualizada = await put.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Viagem ao Chile", atualizada.GetProperty("nome").GetString());
        Assert.Equal(7000m, atualizada.GetProperty("valorAlvo").GetDecimal());

        var arq = await _client.PostAsync($"/api/financas/metas/{Id(meta)}/arquivar", null);
        arq.EnsureSuccessStatusCode();
        Assert.True((await arq.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("arquivada").GetBoolean());

        // Arquivada some da lista padrão, mas continua acessível com a flag.
        var padrao = await _client.GetFromJsonAsync<JsonElement>("/api/financas/metas");
        Assert.DoesNotContain(Id(meta), padrao.EnumerateArray().Select(m => m.GetProperty("id").GetString()));

        var todas = await _client.GetFromJsonAsync<JsonElement>("/api/financas/metas?incluirArquivadas=true");
        Assert.Contains(Id(meta), todas.EnumerateArray().Select(m => m.GetProperty("id").GetString()));
    }

    [Fact]
    public async Task RemoveMeta()
    {
        var meta = await CriarMeta();

        var del = await _client.DeleteAsync($"/api/financas/metas/{Id(meta)}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        var get = await _client.GetAsync($"/api/financas/metas/{Id(meta)}");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    [Fact]
    public async Task MetaDeOutroUsuarioNaoEhAcessivel()
    {
        var meta = await CriarMeta();

        var outro = _ctx.Factory.CreateClient();
        var reg = await outro.PostAsJsonAsync("/api/auth/register",
            new { email = $"outro_{Guid.NewGuid():N}@example.com", password = "Sup3rSecret!" });
        reg.EnsureSuccessStatusCode();
        var token = (await reg.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        outro.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        Assert.Equal(HttpStatusCode.NotFound, (await outro.GetAsync($"/api/financas/metas/{Id(meta)}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outro.DeleteAsync($"/api/financas/metas/{Id(meta)}")).StatusCode);
    }

    [Fact]
    public async Task ExigeAutenticacao()
    {
        using var anonimo = _ctx.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonimo.GetAsync("/api/financas/metas")).StatusCode);
    }

    // ------------------------------------------------------------------ apoio

    private Task<string> CriarInvestimento(decimal valor) =>
        CriarLancamento($"investi {valor} reais no tesouro", "Investimentos", valor);

    private async Task<string> CriarLancamento(string texto, string categoria, decimal valor)
    {
        var criada = await _client.PostAsJsonAsync("/api/financas/transacoes", new { texto });
        criada.EnsureSuccessStatusCode();
        var id = (await criada.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;

        var patch = await _client.PatchAsJsonAsync($"/api/financas/transacoes/{id}",
            new { valor, categoria, tipo = "Despesa" });
        patch.EnsureSuccessStatusCode();
        return id;
    }
}
