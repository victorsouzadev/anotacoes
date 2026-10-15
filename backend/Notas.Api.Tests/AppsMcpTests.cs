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
        db.TaskItems.AddRange(
            new TaskItem { Id = Guid.NewGuid().ToString(), UserId = uid, Title = "Pagar o IPVA", DueDate = DateTime.UtcNow.Date.AddDays(-2), CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
            new TaskItem { Id = Guid.NewGuid().ToString(), UserId = uid, Title = "Ler o livro do clube", IsCompleted = true, CompletedAt = DateTime.UtcNow.AddHours(-1), CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
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
    public async Task Sem_arquivo_de_token_fica_desligado()
    {
        if (File.Exists(_tokenFile)) File.Delete(_tokenFile);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await Rpc("tarefas", Listar)).Status);
    }

    [Fact]
    public async Task Token_errado_ou_ausente_401()
    {
        GravarToken(_email);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Rpc("tarefas", Listar, "outro-token")).Status);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Rpc("tarefas", Listar, null)).Status);
    }

    [Fact]
    public async Task Cada_rota_so_mostra_as_ferramentas_do_grupo()
    {
        GravarToken(_email);
        var (status, tarefas) = await Rpc("tarefas", Listar);
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Contains("\"tarefas_resumo\"", tarefas);
        Assert.DoesNotContain("\"financas_resumo\"", tarefas);

        var financas = (await Rpc("financas", Listar)).Body;
        Assert.Contains("\"financas_resumo_mes\"", financas);
        Assert.DoesNotContain("\"tarefas_", financas);

        var criativo = (await Rpc("criativo", Listar)).Body;
        Assert.Contains("\"criativo_sites\"", criativo);
        Assert.Equal(HttpStatusCode.NotFound, (await Rpc("outro", Listar)).Status);
    }

    [Fact]
    public async Task Resumos_trazem_os_dados_do_dono_do_cerebro()
    {
        GravarToken(_email);
        var tarefas = (await Rpc("tarefas", Chamar("tarefas_resumo"))).Body;
        Assert.Contains("Pagar o IPVA", tarefas);
        Assert.Contains("Ler o livro do clube", tarefas);

        var financas = (await Rpc("financas", Chamar("financas_resumo"))).Body;
        Assert.Contains("Saldo", financas);
        Assert.Contains("150,50", financas);
        Assert.Contains("| Categoria | Total |", financas);

        var criativo = (await Rpc("criativo", Chamar("criativo_resumo"))).Body;
        Assert.Contains("Nenhum site publicado", criativo);
    }

    [Fact]
    public async Task Email_sem_conta_no_hub_403()
    {
        GravarToken("ninguem@example.com");
        Assert.Equal(HttpStatusCode.Forbidden, (await Rpc("tarefas", Listar)).Status);
    }
}
