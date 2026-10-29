using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api.Services.Acoes;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>Ferramenta Ações (/api/acoes): operações e carteira pelo preço médio.</summary>
public class AcoesApiTests : IClassFixture<TasksApiFactory>
{
    private readonly TasksApiFactory _factory;

    public AcoesApiTests(TasksApiFactory factory) => _factory = factory;

    private class CotacoesFixas : ICotacoes
    {
        public Task<Dictionary<string, Cotacao>> ObterAsync(IEnumerable<string> tickers, CancellationToken ct) =>
            Task.FromResult(tickers.Where(t => t == "PETR4")
                .ToDictionary(t => t, t => new Cotacao(t, "Petrobras", 40m, 1.5m, DateTime.UtcNow)));
    }

    private async Task<HttpClient> NovoCliente()
    {
        var app = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<ICotacoes, CotacoesFixas>()));
        var email = $"acoes_{Guid.NewGuid():N}@example.com";
        var res = await app.CreateClient().PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString();
        var c = app.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    private static object Op(string ticker, string tipo, decimal qtd, decimal preco, string data, decimal taxas = 0) =>
        new { ticker, tipo, quantidade = qtd, precoUnitario = preco, taxas, data, observacoes = (string?)null };

    [Fact]
    public async Task Sem_login_401()
    {
        var res = await _factory.CreateClient().GetAsync("/api/acoes/carteira");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Carteira_pelo_preco_medio_com_cotacao()
    {
        var c = await NovoCliente();
        (await c.PostAsJsonAsync("/api/acoes/operacoes", Op("petr4", "compra", 100, 30, "2026-01-10", 10))).EnsureSuccessStatusCode();
        (await c.PostAsJsonAsync("/api/acoes/operacoes", Op("PETR4", "compra", 100, 34, "2026-02-10"))).EnsureSuccessStatusCode();
        (await c.PostAsJsonAsync("/api/acoes/operacoes", Op("PETR4", "venda", 50, 38, "2026-03-10"))).EnsureSuccessStatusCode();
        (await c.PostAsJsonAsync("/api/acoes/operacoes", Op("MXRF11", "compra", 10, 10, "2026-03-10"))).EnsureSuccessStatusCode();

        var carteira = await c.GetFromJsonAsync<JsonElement>("/api/acoes/carteira");
        var petr = carteira.GetProperty("posicoes").EnumerateArray().Single(p => p.GetProperty("ticker").GetString() == "PETR4");
        Assert.Equal(150m, petr.GetProperty("quantidade").GetDecimal());
        Assert.Equal(32.05m, petr.GetProperty("precoMedio").GetDecimal());        // (3000 + 10 + 3400) / 200
        Assert.Equal(297.5m, petr.GetProperty("resultadoRealizado").GetDecimal()); // 50 × (38 − 32,05)
        Assert.Equal(6000m, petr.GetProperty("valorAtual").GetDecimal());
        Assert.Equal(1192.5m, petr.GetProperty("resultado").GetDecimal());
        // MXRF11 ficou sem cotação: os totais de valor não são inventados.
        Assert.False(carteira.GetProperty("cotacoesCompletas").GetBoolean());
        Assert.Equal(JsonValueKind.Null, carteira.GetProperty("valorAtual").ValueKind);
    }

    [Fact]
    public async Task Nao_vende_mais_do_que_tem_e_valida_ticker()
    {
        var c = await NovoCliente();
        (await c.PostAsJsonAsync("/api/acoes/operacoes", Op("VALE3", "compra", 10, 60, "2026-05-01"))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/acoes/operacoes", Op("VALE3", "venda", 11, 60, "2026-05-02"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/acoes/operacoes", Op("VALE3", "venda", 5, 60, "2026-04-01"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/acoes/operacoes", Op("XX", "compra", 1, 1, "2026-05-01"))).StatusCode);
    }

    [Fact]
    public async Task Remove_operacao_so_do_proprio_usuario()
    {
        var c = await NovoCliente();
        var outro = await NovoCliente();
        var res = await c.PostAsJsonAsync("/api/acoes/operacoes", Op("ITUB4", "compra", 1, 30, "2026-05-01"));
        var id = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        Assert.Equal(HttpStatusCode.NotFound, (await outro.DeleteAsync($"/api/acoes/operacoes/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/acoes/operacoes/{id}")).StatusCode);
        Assert.Empty((await c.GetFromJsonAsync<JsonElement>("/api/acoes/operacoes")).EnumerateArray());
    }
}
