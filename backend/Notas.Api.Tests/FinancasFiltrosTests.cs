using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Notas.Api.Tests;

// Os filtros da API chegam pela query string. O binding de enum do ASP.NET é
// sensível a maiúsculas, então `tipo=despesa` — exatamente o formato que a API
// devolve nas respostas — chegava a dar 400. Estes testes travam a tolerância.
public class FinancasFiltrosTests : IClassFixture<FinancasFiltrosTests.Contexto>
{
    public class Contexto : IAsyncLifetime
    {
        public TasksApiFactory Factory { get; } = new();
        public HttpClient Client { get; private set; } = null!;

        public async Task InitializeAsync()
        {
            Client = Factory.CreateClient();
            var res = await Factory.CreateClient().PostAsJsonAsync("/api/auth/register",
                new { email = $"filtros_{Guid.NewGuid():N}@example.com", password = "Sup3rSecret!" });
            res.EnsureSuccessStatusCode();
            var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
            Client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

            // Um lançamento para os filtros terem o que devolver.
            var criada = await Client.PostAsJsonAsync("/api/financas/transacoes", new { texto = "gastei 45 reais no mercado" });
            criada.EnsureSuccessStatusCode();
        }

        public async Task DisposeAsync()
        {
            Client.Dispose();
            await Factory.DisposeAsync();
        }
    }

    private readonly HttpClient _client;

    public FinancasFiltrosTests(Contexto ctx) => _client = ctx.Client;

    [Theory]
    // Minúsculo é o formato devolvido pela própria API em `tipo`.
    [InlineData("tipo=despesa")]
    [InlineData("tipo=Despesa")]
    [InlineData("tipo=DESPESA")]
    [InlineData("tipo=receita")]
    [InlineData("categoria=Alimentacao")]
    [InlineData("categoria=alimentacao")]
    [InlineData("categoria=Alimentação")]
    [InlineData("status=PendenteRevisao")]
    [InlineData("status=pendenterevisao")]
    [InlineData("tipo=despesa&categoria=alimentacao&status=confirmado")]
    public async Task FiltrosDeListaAceitamQualquerCaixa(string query)
    {
        var res = await _client.GetAsync($"/api/financas/transacoes?{query}");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Theory]
    [InlineData("tipo=despesa")]
    [InlineData("tipo=Despesa")]
    [InlineData("tipo=receita")]
    public async Task FiltroDeCategoriasDoDashboardAceitaQualquerCaixa(string query)
    {
        var res = await _client.GetAsync($"/api/financas/dashboard/categorias?ano=2026&mes=8&{query}");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Theory]
    [InlineData("tipo=transferencia")]
    [InlineData("categoria=criptomoedas")]
    [InlineData("status=arquivado")]
    public async Task ValorInvalidoNoFiltroVira400(string query)
    {
        // Um filtro inválido não pode ser silenciosamente ignorado: o usuário
        // veria uma lista completa achando que estava filtrada.
        var res = await _client.GetAsync($"/api/financas/transacoes?{query}");
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task FiltroVazioNaoRestringe()
    {
        var comVazio = await _client.GetFromJsonAsync<JsonElement>("/api/financas/transacoes?tipo=&categoria=&status=");
        var semFiltro = await _client.GetFromJsonAsync<JsonElement>("/api/financas/transacoes");
        Assert.Equal(semFiltro.GetArrayLength(), comVazio.GetArrayLength());
        Assert.True(semFiltro.GetArrayLength() > 0);
    }

    [Fact]
    public async Task FiltroDeTipoRealmenteFiltra()
    {
        var despesas = await _client.GetFromJsonAsync<JsonElement>("/api/financas/transacoes?tipo=despesa");
        var receitas = await _client.GetFromJsonAsync<JsonElement>("/api/financas/transacoes?tipo=receita");

        Assert.True(despesas.GetArrayLength() > 0);
        Assert.Equal(0, receitas.GetArrayLength());
        Assert.All(despesas.EnumerateArray(), t => Assert.Equal("despesa", t.GetProperty("tipo").GetString()));
    }

    [Fact]
    public async Task MesInvalidoNoDashboardVira400()
    {
        var res = await _client.GetAsync("/api/financas/dashboard/resumo?ano=2026&mes=13");
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task TendenciasPreenchemPeriodosVazios()
    {
        var t = await _client.GetFromJsonAsync<JsonElement>("/api/financas/dashboard/tendencias?agrupamento=mensal&periodos=6");
        // Um mês sem lançamento precisa entrar como zero, senão a linha do gráfico
        // ligaria dois meses distantes como se fossem consecutivos.
        Assert.Equal(6, t.GetArrayLength());
        Assert.All(t.EnumerateArray(), p => Assert.False(
            string.IsNullOrWhiteSpace(p.GetProperty("periodoRotulo").GetString())));

        var periodos = t.EnumerateArray().Select(p => p.GetProperty("periodo").GetString()!).ToList();
        Assert.Equal(periodos.OrderBy(x => x, StringComparer.Ordinal), periodos);
    }

    [Fact]
    public async Task TextoAcimaDoLimiteEhRejeitado()
    {
        var res = await _client.PostAsJsonAsync("/api/financas/transacoes", new { texto = new string('a', 600) });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task PatchComValorNegativoEhRejeitado()
    {
        var lista = await _client.GetFromJsonAsync<JsonElement>("/api/financas/transacoes");
        var id = lista[0].GetProperty("id").GetString();

        var res = await _client.PatchAsJsonAsync($"/api/financas/transacoes/{id}", new { valor = -50m });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task PatchPermiteLimparAFormaDePagamento()
    {
        var criada = await _client.PostAsJsonAsync("/api/financas/transacoes", new { texto = "paguei 30 reais no pix" });
        var id = (await criada.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();

        var comForma = await _client.GetFromJsonAsync<JsonElement>($"/api/financas/transacoes/{id}");
        Assert.Equal("Pix", comForma.GetProperty("formaPagamento").GetString());

        var res = await _client.PatchAsJsonAsync($"/api/financas/transacoes/{id}", new { limparFormaPagamento = true });
        res.EnsureSuccessStatusCode();

        var depois = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, depois.GetProperty("formaPagamento").ValueKind);
    }
}
