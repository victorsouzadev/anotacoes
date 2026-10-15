using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Options;

namespace Ops.Tests;

public class HostShellTests
{
    private static HostShell Shell(int maxOutput = 100_000) =>
        new(Options.Create(new OpsOptions { Mode = "local", MaxOutputBytes = maxOutput, MaxTimeoutSeconds = 30 }));

    [Fact]
    public async Task Devolve_saida_e_codigo()
    {
        var r = await Shell().RunAsync("echo oi; echo erro >&2; exit 3", 10);
        Assert.Equal(3, r.ExitCode);
        Assert.Equal("oi\n", r.Stdout);
        Assert.Equal("erro\n", r.Stderr);
        Assert.False(r.TimedOut);
    }

    [Fact]
    public async Task Diretorio_de_trabalho_com_aspas_no_nome()
    {
        var dir = Path.Combine(Path.GetTempPath(), "ops it's " + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var r = await Shell().RunAsync("pwd", 10, dir);
            Assert.Equal(dir, r.Stdout.Trim());
        }
        finally { Directory.Delete(dir); }
    }

    [Fact]
    public async Task Tempo_esgotado_encerra_o_processo()
    {
        var r = await Shell().RunAsync("sleep 20", 1);
        Assert.True(r.TimedOut);
        Assert.Equal(-1, r.ExitCode);
        Assert.True(r.ElapsedMs < 10_000);
    }

    [Fact]
    public async Task Saida_enorme_e_cortada_no_meio()
    {
        var r = await Shell(maxOutput: 1000).RunAsync("echo INICIO; seq 1 100000; echo FIM", 20);
        Assert.True(r.Truncated);
        Assert.StartsWith("INICIO", r.Stdout);
        Assert.EndsWith("FIM\n", r.Stdout);
        Assert.True(r.Stdout.Length < 1200);
    }

    [Fact]
    public async Task Quote_neutraliza_o_shell()
    {
        Assert.Equal("'a'\\''b'", HostShell.Quote("a'b"));
        // O texto citado volta literal, sem executar a substituição de comando.
        var r = await Shell().RunAsync("printf '%s' " + HostShell.Quote("$(echo injetado) `echo x` a'b"), 10);
        Assert.Equal("$(echo injetado) `echo x` a'b", r.Stdout);
    }

    [Theory]
    [InlineData("notas-api", true)]
    [InlineData("nginx-proxy-manager", true)]
    [InlineData("x; echo injetado", false)]
    [InlineData("-f", false)]
    [InlineData("", false)]
    public void Nome_de_container(string nome, bool valido)
    {
        if (valido) OpsTools.RequireName(nome);
        else Assert.Throws<ArgumentException>(() => OpsTools.RequireName(nome));
    }
}

public sealed class McpEndpointTests : IClassFixture<McpEndpointTests.Factory>
{
    public const string Token = "0123456789abcdef0123456789abcdef-teste";
    private readonly Factory _factory;

    public McpEndpointTests(Factory factory) => _factory = factory;

    public sealed class Factory : WebApplicationFactory<Program>
    {
        public readonly string Data = Path.Combine(Path.GetTempPath(), "ops-" + Guid.NewGuid().ToString("N"));

        protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
        {
            builder.UseSetting("Ops:Token", Token);
            builder.UseSetting("Ops:Mode", "local");
            builder.UseSetting("Ops:DataPath", Data);
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            try { Directory.Delete(Data, true); } catch (IOException) { }
        }
    }

    private static HttpRequestMessage Rpc(string json, string? token)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/mcp") { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        if (token is not null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return req;
    }

    [Theory]
    [InlineData(null)]
    [InlineData("errado-errado-errado-errado-errado-errado")]
    public async Task Sem_token_valido_401(string? token)
    {
        var r = await _factory.CreateClient().SendAsync(Rpc("""{"jsonrpc":"2.0","id":1,"method":"tools/list"}""", token));
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Health_nao_expoe_o_token()
    {
        var body = await _factory.CreateClient().GetStringAsync("/health");
        Assert.Contains("\"status\":\"ok\"", body);
        Assert.DoesNotContain(Token, body);
    }

    [Fact]
    public async Task Lista_ferramentas_e_executa_comando_com_auditoria()
    {
        var c = _factory.CreateClient();

        var list = await (await c.SendAsync(Rpc("""{"jsonrpc":"2.0","id":1,"method":"tools/list"}""", Token))).Content.ReadAsStringAsync();
        foreach (var t in new[] { "run_command", "system_status", "list_containers", "container_logs", "container_action", "read_file", "write_file" })
            Assert.Contains($"\"name\":\"{t}\"", list);

        var call = await c.SendAsync(Rpc("""{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"run_command","arguments":{"command":"echo ola-ops"}}}""", Token));
        var body = await call.Content.ReadAsStringAsync();
        Assert.Contains("ola-ops", body);
        Assert.DoesNotContain("\"isError\":true", body);

        var audit = await File.ReadAllTextAsync(Path.Combine(_factory.Data, "audit.log"));
        Assert.Contains("\"tool\":\"run_command\"", audit);
        Assert.Contains("echo ola-ops", audit);
    }

    [Fact]
    public async Task Write_file_grava_e_guarda_copia()
    {
        var dir = Path.Combine(_factory.Data, "arquivos");
        Directory.CreateDirectory(dir);
        var file = Path.Combine(dir, "conf.txt");
        await File.WriteAllTextAsync(file, "antigo");

        var json = """{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"write_file","arguments":{"path":"ARQ","content":"novo 'com aspas' e $(echo nada)"}}}"""
            .Replace("ARQ", file);
        var body = await (await _factory.CreateClient().SendAsync(Rpc(json, Token))).Content.ReadAsStringAsync();
        Assert.Contains("gravado", body);
        Assert.Equal("novo 'com aspas' e $(echo nada)", await File.ReadAllTextAsync(file));
        Assert.Single(Directory.GetFiles(dir, "conf.txt.bak-*"));
    }
}
