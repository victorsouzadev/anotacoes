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

/// <summary>MCP do Estúdio (/api/mcp/estudio): catálogo, confirmação de custo, biblioteca e documentos.</summary>
public class EstudioMcpTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private const string Token = "token-do-estudio-0123456789abcdef0123456789abcdef";
    private const string Png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    private readonly TasksApiFactory _factory;
    private readonly string _tokenFile = Path.Combine(Path.GetTempPath(), $"estudio-token-{Guid.NewGuid():N}.json");
    private WebApplicationFactory<Program> _app = null!;
    private string _uid = "";

    public EstudioMcpTests(TasksApiFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _app = _factory.WithWebHostBuilder(b => b.UseSetting("Mcp:TokenFile", _tokenFile));
        var email = $"mcpest_{Guid.NewGuid():N}@example.com";
        var res = await _app.CreateClient().PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        File.WriteAllText(_tokenFile, JsonSerializer.Serialize(new { sha256 = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Token))), email }));
        using var scope = _app.Services.CreateScope();
        _uid = (await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.FirstAsync(u => u.Email == email)).Id;

        // Chave do fal e limite de confirmação de US$ 0,10: quase toda geração pede confirmação.
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        var c = _app.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        (await c.PutAsJsonAsync("/api/estudio/config", new { chaveFal = "fal-chave-de-teste-1111", confirmarAcimaCentavos = 10, semLimite = true })).EnsureSuccessStatusCode();
    }

    public async Task DisposeAsync()
    {
        if (File.Exists(_tokenFile)) File.Delete(_tokenFile);
        await _app.DisposeAsync();
    }

    private async Task<string> Rpc(string metodo, object? parametros = null)
    {
        var corpo = JsonSerializer.Serialize(new { jsonrpc = "2.0", id = 1, method = metodo, @params = parametros ?? new { } });
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/mcp/estudio") { Content = new StringContent(corpo, Encoding.UTF8, "application/json") };
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        var res = await _app.CreateClient().SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return await res.Content.ReadAsStringAsync();
    }

    /// <summary>Chama a ferramenta e devolve o texto do resultado (a resposta vem em JSON ou SSE, com acentos escapados).</summary>
    private async Task<string> Chamar(string nome, object argumentos)
    {
        var corpo = await Rpc("tools/call", new { name = nome, arguments = argumentos });
        var json = corpo.Split('\n').Select(l => l.StartsWith("data:") ? l[5..].Trim() : l.Trim()).First(l => l.StartsWith('{'));
        using var doc = JsonDocument.Parse(json);
        return string.Concat(doc.RootElement.GetProperty("result").GetProperty("content").EnumerateArray().Select(c => c.GetProperty("text").GetString()));
    }

    [Fact]
    public async Task Rota_do_estudio_so_tem_ferramentas_do_estudio()
    {
        var lista = await Rpc("tools/list");
        Assert.Contains("\"estudio_gerar\"", lista);
        Assert.Contains("\"estudio_salvar_documento\"", lista);
        Assert.Contains("\"estudio_abrir_no_app\"", lista);
        Assert.DoesNotContain("\"tarefas_", lista);
    }

    [Fact]
    public async Task Catalogo_lista_modelos_com_operacoes()
    {
        var r = await Chamar("estudio_modelos", new { tipo = "video", operacao = "quadros", detalhes = true });
        Assert.Contains("veo-3.1", r);
        Assert.Contains("imagemFinal", r);
        Assert.DoesNotContain("nano-banana", r);
    }

    [Fact]
    public async Task Gerar_acima_do_limite_pede_confirmacao_e_nao_cria_nada()
    {
        var r = await Chamar("estudio_gerar", new { modelo = "nano-banana-pro", operacao = "texto", parametros = new { prompt = "um farol" } });
        Assert.Contains("confirmar=true", r);
        Assert.Contains("US$ 0.15", r);
        using var scope = _app.Services.CreateScope();
        Assert.False(await scope.ServiceProvider.GetRequiredService<AppDbContext>().EstudioJobs.AnyAsync(j => j.UserId == _uid));

        var confirmado = await Chamar("estudio_gerar", new { modelo = "nano-banana-pro", operacao = "texto", parametros = new { prompt = "um farol" }, confirmar = true });
        Assert.Contains("Geração", confirmado);
        Assert.True(await scope.ServiceProvider.GetRequiredService<AppDbContext>().EstudioJobs.AnyAsync(j => j.UserId == _uid && j.App == "mcp"));
    }

    [Fact]
    public async Task Parametro_errado_volta_como_erro_legivel()
    {
        var r = await Chamar("estudio_gerar", new { modelo = "veo-3.1", operacao = "texto", parametros = new { prompt = "x", duracao = 7 }, confirmar = true });
        Assert.Contains("Aceita: 4, 6, 8", r);
    }

    [Fact]
    public async Task Enviar_arquivo_e_achar_na_biblioteca_com_link()
    {
        var r = await Chamar("estudio_enviar_arquivo", new { nome = "logo.png", conteudo_base64 = Png, pasta = "Marca" });
        Assert.Contains("Na biblioteca", r);
        var lista = await Chamar("estudio_midias", new { pasta = "Marca" });
        Assert.Contains("logo.png", lista);
        Assert.Contains("/api/estudio/arquivos/", lista);
        var link = await Chamar("estudio_abrir_no_app", new { midia = "abc", app = "PhotoCraft" });
        Assert.Contains("/estudio/apps/photocraft?abrir=abc", link);
    }

    [Fact]
    public async Task Documento_da_cena_salvo_pelo_mcp_abre_no_palco()
    {
        var conteudo = new
        {
            objetos = new[] { new { id = "b1", tipo = "boneco", nome = "Ana", posicao = new[] { 0, 0, 0 }, rotacao = new[] { 0, 30, 0 }, escala = new[] { 1, 1, 1 } } },
            fundo = new { tipo = "cor", cor = "#ffffff" },
            camera = new { posicao = new[] { 0, 1.5, 4 }, alvo = new[] { 0, 1, 0 }, fov = 40 },
            luz = new { intensidade = 2, azimute = 30, elevacao = 50 },
            chao = true,
            proporcao = "16:9",
        };
        var r = await Chamar("estudio_salvar_documento", new { tipo = "cena", nome = "Café", conteudo });
        Assert.Contains("/estudio/ferramentas/palco?quadro=", r);
        var lista = await Chamar("estudio_documentos", new { tipo = "cena" });
        Assert.Contains("Café", lista);
    }

    [Fact]
    public async Task Apagar_exige_confirmacao()
    {
        await Chamar("estudio_enviar_arquivo", new { nome = "apagar.png", conteudo_base64 = Png });
        using var scope = _app.Services.CreateScope();
        var id = (await scope.ServiceProvider.GetRequiredService<AppDbContext>().EstudioMidias.FirstAsync(m => m.UserId == _uid && m.Nome == "apagar.png")).Id;
        Assert.Contains("confirmar=true", await Chamar("estudio_apagar_midia", new { id }));
        Assert.Contains("apagado", await Chamar("estudio_apagar_midia", new { id, confirmar = true }));
    }
}
