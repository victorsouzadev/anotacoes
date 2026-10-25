using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Notas.Api.Mcp;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>
/// MCP dos craft apps com as CLIs rodando na própria API (programa do Windows): sessão = processo,
/// mensagens por stdin/stdout. A CLI aqui é a de mentira do crafts-mcp (Node), num script com o nome
/// que a API procura.
/// </summary>
public class CraftsLocalTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private const string Token = "token-dos-crafts-local-0123456789abcdef0123456789ab";
    private readonly TasksApiFactory _factory;
    private readonly string _tokenFile = Path.Combine(Path.GetTempPath(), $"crafts-local-token-{Guid.NewGuid():N}.json");
    private readonly string _clis = Path.Combine(Path.GetTempPath(), $"crafts-clis-{Guid.NewGuid():N}");
    private WebApplicationFactory<Program> _app = null!;
    private bool _temNode;

    public CraftsLocalTests(TasksApiFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _temNode = !OperatingSystem.IsWindows() && Executa("node", "--version");
        Directory.CreateDirectory(_clis);
        var falsa = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../crafts-mcp/teste/cli-falsa.mjs"));
        foreach (var app in new[] { "gridcraft", "photocraft" })
        {
            var exe = CraftsLocal.Executavel(_clis, app);
            File.WriteAllText(exe, $"#!/bin/sh\nexec node \"{falsa}\" {app} \"$@\"\n");
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(exe, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }
        _app = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Mcp:TokenFile", _tokenFile);
            b.UseSetting("Estudio:CraftsCliDir", _clis);
        });
        var email = $"crafts_local_{Guid.NewGuid():N}@example.com";
        (await _app.CreateClient().PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" })).EnsureSuccessStatusCode();
        File.WriteAllText(_tokenFile, JsonSerializer.Serialize(new { sha256 = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Token))), email }));
    }

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        if (File.Exists(_tokenFile)) File.Delete(_tokenFile);
        Directory.Delete(_clis, recursive: true);
    }

    private static bool Executa(string exe, string args)
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo(exe, args) { RedirectStandardOutput = true, UseShellExecute = false })!;
            p.WaitForExit(10_000);
            return p.ExitCode == 0;
        }
        catch (System.ComponentModel.Win32Exception) { return false; }
    }

    private async Task<HttpResponseMessage> Rpc(string app, object corpo, string? sessao)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, $"/api/mcp/crafts/{app}") { Content = JsonContent.Create(corpo) };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        if (sessao is not null) req.Headers.Add("Mcp-Session-Id", sessao);
        return await _app.CreateClient().SendAsync(req);
    }

    [Fact]
    public async Task Abre_a_cli_na_pasta_da_sessao_repassa_e_fecha()
    {
        if (!_temNode) return; // sem Node (ou no Windows), não há a CLI de mentira

        // Sem sessão e sem initialize: recusa.
        Assert.Equal(HttpStatusCode.BadRequest, (await Rpc("gridcraft", new { jsonrpc = "2.0", id = 1, method = "tools/list" }, null)).StatusCode);

        var init = await Rpc("gridcraft", new { jsonrpc = "2.0", id = 1, method = "initialize", @params = new { } }, null);
        Assert.Equal(HttpStatusCode.OK, init.StatusCode);
        var sessao = init.Headers.GetValues("Mcp-Session-Id").Single();
        Assert.Equal("gridcraft-cli", (await init.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("result").GetProperty("serverInfo").GetProperty("name").GetString());

        Assert.Equal(HttpStatusCode.Accepted, (await Rpc("gridcraft", new { jsonrpc = "2.0", method = "notifications/initialized" }, sessao)).StatusCode);

        var lista = await (await Rpc("gridcraft", new { jsonrpc = "2.0", id = "a", method = "tools/list" }, sessao)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("a", lista.GetProperty("id").GetString());
        var nomes = lista.GetProperty("result").GetProperty("tools").EnumerateArray().Select(t => t.GetProperty("name").GetString()).ToList();
        Assert.Equal(["eco", "hub_biblioteca", "hub_trazer_midia", "hub_guardar_arquivo", "hub_arquivos_da_sessao"], nomes);

        // A CLI roda na pasta da sessão; o GridCraft não aceita as raízes (só o comando "mcp").
        var eco = await (await Rpc("gridcraft", new { jsonrpc = "2.0", id = 3, method = "tools/call", @params = new { name = "eco", arguments = new { } } }, sessao)).Content.ReadFromJsonAsync<JsonElement>();
        var dados = JsonDocument.Parse(eco.GetProperty("result").GetProperty("content")[0].GetProperty("text").GetString()!).RootElement;
        var pasta = Path.Combine(_factory.EstudioRaiz, "_mcp", sessao);
        Assert.Equal(Path.GetFullPath(pasta), Path.GetFullPath(dados.GetProperty("cwd").GetString()!));
        Assert.Equal(["mcp"], dados.GetProperty("args").EnumerateArray().Select(a => a.GetString()!).ToArray());

        // As ferramentas do hub falam o caminho de verdade da pasta (não /trabalho).
        var vazia = await (await Rpc("gridcraft", new { jsonrpc = "2.0", id = 4, method = "tools/call", @params = new { name = "hub_arquivos_da_sessao", arguments = new { } } }, sessao)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains(pasta, vazia.GetProperty("result").GetProperty("content")[0].GetProperty("text").GetString());

        // Sessão de outro app não serve.
        Assert.Equal(HttpStatusCode.BadRequest, (await Rpc("photocraft", new { jsonrpc = "2.0", id = 5, method = "tools/list" }, sessao)).StatusCode);

        // Encerrar mata a CLI e apaga a pasta.
        var del = new HttpRequestMessage(HttpMethod.Delete, "/api/mcp/crafts/gridcraft");
        del.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        del.Headers.Add("Mcp-Session-Id", sessao);
        Assert.Equal(HttpStatusCode.NoContent, (await _app.CreateClient().SendAsync(del)).StatusCode);
        Assert.False(Directory.Exists(pasta));
        Assert.Equal(HttpStatusCode.NotFound, (await Rpc("gridcraft", new { jsonrpc = "2.0", id = 6, method = "tools/list" }, sessao)).StatusCode);
    }

    [Fact]
    public async Task App_com_raizes_recebe_a_pasta_da_sessao_e_cli_ausente_e_503()
    {
        if (!_temNode) return;
        var init = await Rpc("photocraft", new { jsonrpc = "2.0", id = 1, method = "initialize", @params = new { } }, null);
        var sessao = init.Headers.GetValues("Mcp-Session-Id").Single();
        var eco = await (await Rpc("photocraft", new { jsonrpc = "2.0", id = 2, method = "tools/call", @params = new { name = "eco", arguments = new { } } }, sessao)).Content.ReadFromJsonAsync<JsonElement>();
        var args = JsonDocument.Parse(eco.GetProperty("result").GetProperty("content")[0].GetProperty("text").GetString()!).RootElement.GetProperty("args").EnumerateArray().Select(a => a.GetString()!).ToArray();
        var pasta = Path.Combine(_factory.EstudioRaiz, "_mcp", sessao);
        Assert.Equal(["mcp", "--automation-read-root", pasta, "--automation-write-root", pasta], args);

        var semCli = await Rpc("cadcraft", new { jsonrpc = "2.0", id = 1, method = "initialize", @params = new { } }, null);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, semCli.StatusCode);
    }
}
