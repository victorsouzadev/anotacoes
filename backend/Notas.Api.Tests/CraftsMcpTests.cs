using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api.Data;
using Notas.Api.Mcp;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>MCP remoto dos craft apps: repasse ao crafts-mcp e as ferramentas do hub (biblioteca ↔ pasta da sessão).</summary>
public class CraftsMcpTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private const string Token = "token-dos-crafts-0123456789abcdef0123456789abcdef";
    private const string Sessao = "11111111-2222-3333-4444-555555555555";
    private const string Png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    private readonly TasksApiFactory _factory;
    private readonly string _tokenFile = Path.Combine(Path.GetTempPath(), $"crafts-token-{Guid.NewGuid():N}.json");
    private readonly CraftsFalso _falso = new();
    private WebApplicationFactory<Program> _app = null!;
    private HttpClient _logado = null!;

    public CraftsMcpTests(TasksApiFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _app = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Mcp:TokenFile", _tokenFile);
            b.UseSetting("Estudio:CraftsMcpUrl", "http://crafts-mcp:8080");
            b.ConfigureTestServices(s => s.AddHttpClient(CraftsMcp.NomeHttp).ConfigurePrimaryHttpMessageHandler(() => _falso));
        });
        var email = $"crafts_{Guid.NewGuid():N}@example.com";
        var res = await _app.CreateClient().PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        File.WriteAllText(_tokenFile, JsonSerializer.Serialize(new { sha256 = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Token))), email }));
        _logado = _app.CreateClient();
        _logado.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",
            (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString());
    }

    public async Task DisposeAsync()
    {
        _logado.Dispose();
        if (File.Exists(_tokenFile)) File.Delete(_tokenFile);
        await _app.DisposeAsync();
    }

    private async Task<HttpResponseMessage> Rpc(string app, object corpo, string? sessao = Sessao, string? token = Token)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, $"/api/mcp/crafts/{app}") { Content = JsonContent.Create(corpo) };
        if (token is not null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (sessao is not null) req.Headers.Add("Mcp-Session-Id", sessao);
        return await _app.CreateClient().SendAsync(req);
    }

    private static async Task<string> Texto(HttpResponseMessage r) =>
        (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("result").GetProperty("content")[0].GetProperty("text").GetString()!;

    [Fact]
    public async Task Sem_token_e_401_e_app_desconhecido_404()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await Rpc("gridcraft", new { jsonrpc = "2.0", id = 1, method = "tools/list" }, token: null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Rpc("outro", new { jsonrpc = "2.0", id = 1, method = "tools/list" })).StatusCode);
    }

    [Fact]
    public async Task Repassa_ao_crafts_mcp_e_soma_as_ferramentas_do_hub()
    {
        var r = await Rpc("gridcraft", new { jsonrpc = "2.0", id = 7, method = "tools/list" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(Sessao, r.Headers.GetValues("Mcp-Session-Id").Single());
        var nomes = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("result").GetProperty("tools").EnumerateArray().Select(t => t.GetProperty("name").GetString()).ToList();
        Assert.Equal(["cell_set", "hub_biblioteca", "hub_trazer_midia", "hub_guardar_arquivo", "hub_arquivos_da_sessao"], nomes);
        Assert.Equal("http://crafts-mcp:8080/gridcraft", _falso.Ultimo);
    }

    [Fact]
    public async Task Hub_traz_arquivo_da_biblioteca_e_guarda_o_resultado()
    {
        var put = await _logado.PostAsJsonAsync("/api/estudio/midias", new { nome = "logo.png", dataUrl = Png });
        var id = (await put.Content.ReadFromJsonAsync<JsonElement>())[0].GetProperty("id").GetString();

        var achado = await Texto(await Rpc("photocraft", new { jsonrpc = "2.0", id = 9, method = "tools/call", @params = new { name = "hub_biblioteca", arguments = new { busca = "logo", tipo = "imagem" } } }));
        Assert.Contains($"logo.png (imagem", achado);
        Assert.Contains($"id {id}", achado);
        Assert.Contains("Nada", await Texto(await Rpc("photocraft", new { jsonrpc = "2.0", id = 10, method = "tools/call", @params = new { name = "hub_biblioteca", arguments = new { busca = "nao-existe-xyz" } } })));

        var trazer = await Texto(await Rpc("photocraft", new { jsonrpc = "2.0", id = 1, method = "tools/call", @params = new { name = "hub_trazer_midia", arguments = new { midia = id } } }));
        Assert.Contains($"/trabalho/{Sessao}/logo.png", trazer);
        var pasta = Path.Combine(_factory.EstudioRaiz, "_mcp", Sessao);
        Assert.True(File.Exists(Path.Combine(pasta, "logo.png")));

        // O app "exportou" um arquivo na pasta da sessão; o hub guarda na biblioteca.
        File.Copy(Path.Combine(pasta, "logo.png"), Path.Combine(pasta, "arte-final.png"), overwrite: true);
        var guardar = await Texto(await Rpc("photocraft", new { jsonrpc = "2.0", id = 2, method = "tools/call", @params = new { name = "hub_guardar_arquivo", arguments = new { caminho = $"/trabalho/{Sessao}/arte-final.png" } } }));
        Assert.Contains("Na biblioteca: arte-final.png", guardar);
        var lista = await _logado.GetFromJsonAsync<JsonElement>("/api/estudio/midias?q=arte-final");
        Assert.Equal("PhotoCraft", lista[0].GetProperty("pasta").GetString());

        // Fora da pasta da sessão, não.
        var fora = await Texto(await Rpc("photocraft", new { jsonrpc = "2.0", id = 3, method = "tools/call", @params = new { name = "hub_guardar_arquivo", arguments = new { caminho = "/trabalho/../../db/notas.db" } } }));
        Assert.Contains("não encontrado", fora);
    }

    [Fact]
    public async Task Ferramenta_do_hub_sem_sessao_pede_initialize()
    {
        var r = await Rpc("gridcraft", new { jsonrpc = "2.0", id = 1, method = "tools/call", @params = new { name = "hub_arquivos_da_sessao", arguments = new { } } }, sessao: null);
        Assert.Contains("initialize", await Texto(r));
    }

    private sealed class CraftsFalso : HttpMessageHandler
    {
        public string? Ultimo { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
        {
            Ultimo = req.RequestUri!.ToString();
            var msg = JsonNode.Parse(await req.Content!.ReadAsStringAsync(ct))!;
            var resposta = new JsonObject { ["jsonrpc"] = "2.0", ["id"] = msg["id"]?.DeepClone(), ["result"] = new JsonObject { ["tools"] = new JsonArray(new JsonObject { ["name"] = "cell_set" }) } };
            var r = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(resposta.ToJsonString(), Encoding.UTF8, "application/json") };
            r.Headers.Add("Mcp-Session-Id", req.Headers.TryGetValues("Mcp-Session-Id", out var s) ? s.First() : Sessao);
            return r;
        }
    }
}
