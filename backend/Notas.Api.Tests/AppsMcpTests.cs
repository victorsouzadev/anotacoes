using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api.Data;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>
/// MCPs dos apps (/api/mcp/{grupo}) para o Segundo Cérebro: token lido do arquivo que o Cérebro
/// grava (hash + e-mail do dono), cada rota só com as ferramentas do seu grupo.
/// </summary>
public class AppsMcpTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private const string Token = "token-dos-apps-0123456789abcdef0123456789abcdef";
    private readonly TasksApiFactory _factory;
    private readonly string _tokenFile = Path.Combine(Path.GetTempPath(), $"apps-token-{Guid.NewGuid():N}.json");
    private WebApplicationFactory<Program> _app = null!;
    private string _email = "";

    public AppsMcpTests(TasksApiFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _app = _factory.WithWebHostBuilder(b => b.UseSetting("Mcp:TokenFile", _tokenFile));
        var client = _app.CreateClient();
        _email = $"mcp_{Guid.NewGuid():N}@example.com";
        (await client.PostAsJsonAsync("/api/auth/register", new { email = _email, password = "Sup3rSecret!" })).EnsureSuccessStatusCode();

        using var scope = _app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var uid = (await db.Users.FirstAsync(u => u.Email == _email)).Id;
        var hoje = scope.ServiceProvider.GetRequiredService<Notas.Api.Services.Financas.FinancasClock>().Hoje();
        db.Transacoes.Add(new Transacao
        {
            UserId = uid, Descricao = "Mercado", Valor = 150.5m, Tipo = TipoTransacao.Despesa,
            Categoria = Categoria.Alimentacao, Data = hoje, Competencia = new DateOnly(hoje.Year, hoje.Month, 1),
        });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync()
    {
        if (File.Exists(_tokenFile)) File.Delete(_tokenFile);
        return Task.CompletedTask;
    }

    private void GravarToken(string email) =>
        File.WriteAllText(_tokenFile, JsonSerializer.Serialize(new
        {
            sha256 = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Token))),
            email,
        }));

    private async Task<(HttpStatusCode Status, string Body)> Rpc(string grupo, string json, string? token = Token)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, $"/api/mcp/{grupo}") { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        if (token is not null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var res = await _app.CreateClient().SendAsync(req);
        return (res.StatusCode, await res.Content.ReadAsStringAsync());
    }

    private const string Listar = """{"jsonrpc":"2.0","id":1,"method":"tools/list"}""";

    private static string Chamar(string nome) =>
        """{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"NOME","arguments":{}}}""".Replace("NOME", nome);

    [Fact]
    public async Task Sem_arquivo_e_sem_token_de_Conexoes_recusa()
    {
        if (File.Exists(_tokenFile)) File.Delete(_tokenFile);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Rpc("financas", Listar)).Status);
    }

    [Fact]
    public async Task Token_apps_de_Conexoes_vale_sem_o_arquivo_e_para_de_valer_ao_revogar()
    {
        if (File.Exists(_tokenFile)) File.Delete(_tokenFile);
        var c = _app.CreateClient();
        var login = await (await c.PostAsJsonAsync("/api/auth/login", new { email = _email, password = "Sup3rSecret!" })).Content.ReadFromJsonAsync<JsonElement>();
        c.DefaultRequestHeaders.Authorization = new("Bearer", login.GetProperty("accessToken").GetString());
        var r = await (await c.PostAsJsonAsync("/api/core/mcp-tokens", new { plugin = "apps" })).Content.ReadFromJsonAsync<JsonElement>();
        var token = r.GetProperty("token").GetString()!;

        var (status, body) = await Rpc("financas", Listar, token);
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Contains("financas_resumo", body);

        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/core/mcp-tokens/{r.GetProperty("id").GetString()}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Rpc("financas", Listar, token)).Status);
    }

    [Fact]
    public async Task Token_ops_de_Conexoes_vai_para_o_arquivo_do_ops()
    {
        var pasta = Path.Combine(Path.GetTempPath(), $"ops-access-{Guid.NewGuid():N}");
        Directory.CreateDirectory(pasta);
        var arquivo = Path.Combine(pasta, "ops-tokens.sha256");
        try
        {
            var app = _factory.WithWebHostBuilder(b => b.UseSetting("Ops:TokensFile", arquivo));
            var c = app.CreateClient();
            var login = await (await c.PostAsJsonAsync("/api/auth/login", new { email = _email, password = "Sup3rSecret!" })).Content.ReadFromJsonAsync<JsonElement>();
            c.DefaultRequestHeaders.Authorization = new("Bearer", login.GetProperty("accessToken").GetString());
            var r = await (await c.PostAsJsonAsync("/api/core/mcp-tokens", new { plugin = "ops" })).Content.ReadFromJsonAsync<JsonElement>();
            var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(r.GetProperty("token").GetString()!)));
            Assert.Contains(hash, File.ReadAllLines(arquivo));

            Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/core/mcp-tokens/{r.GetProperty("id").GetString()}")).StatusCode);
            Assert.DoesNotContain(hash, File.ReadAllLines(arquivo));
        }
        finally { Directory.Delete(pasta, true); }
    }

    [Fact]
    public async Task Token_errado_ou_ausente_401()
    {
        GravarToken(_email);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Rpc("financas", Listar, "outro-token")).Status);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Rpc("financas", Listar, null)).Status);
    }

    [Fact]
    public async Task So_a_rota_das_financas_fica_no_nucleo()
    {
        GravarToken(_email);
        var (status, financas) = await Rpc("financas", Listar);
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Contains("\"financas_resumo_mes\"", financas);

        // Specs 034/035: criativo, treino, dieta e tarefas são dos plug-ins (o Caddy manda essas URLs para eles).
        foreach (var grupo in new[] { "criativo", "treino", "dieta", "tarefas", "outro" })
            Assert.Equal(HttpStatusCode.NotFound, (await Rpc(grupo, Listar)).Status);
    }

    [Fact]
    public async Task Resumo_traz_os_dados_do_dono_do_cerebro()
    {
        GravarToken(_email);
        var financas = (await Rpc("financas", Chamar("financas_resumo"))).Body;
        Assert.Contains("Saldo", financas);
        Assert.Contains("150,50", financas);
        Assert.Contains("| Categoria | Total |", financas);
    }

    [Fact]
    public async Task Email_sem_conta_no_hub_403()
    {
        GravarToken("ninguem@example.com");
        Assert.Equal(HttpStatusCode.Forbidden, (await Rpc("financas", Listar)).Status);
    }
}
