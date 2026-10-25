using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Notas.Api.Services.Estudio;

namespace Notas.Api.Mcp;

/// <summary>
/// As CLIs dos craft apps rodando na própria máquina da API (o programa do Windows, que as traz em
/// crafts-cli\): o mesmo papel do serviço crafts-mcp da VPS (crafts-mcp/servidor.mjs), sem o Node.
/// Cada sessão MCP é um processo "&lt;app&gt;-cli mcp" com a sua pasta de trabalho
/// (data/estudio/_mcp/&lt;sessão&gt;); as mensagens vão por stdin e as respostas voltam por stdout, uma
/// por linha, casadas pelo id.
/// </summary>
public sealed class CraftsLocal : IDisposable
{
    /// <summary>Como cada CLI abre o MCP sem janela, e se aceita prender leitura e escrita numa pasta.</summary>
    private static readonly Dictionary<string, (string[] Args, bool Raizes)> Apps = new()
    {
        ["photocraft"] = (["mcp"], true),
        ["vectorcraft"] = (["mcp", "--headless"], true),
        ["filmcraft"] = (["mcp"], false),
        ["lightcraft"] = (["mcp"], false),
        ["pdfcraft"] = (["mcp"], true),
        ["effectcraft"] = (["mcp"], false),
        ["designcraft"] = (["mcp"], true),
        ["figcraft"] = (["mcp"], true),
        ["wordcraft"] = (["mcp"], true),
        ["soundcraft"] = (["mcp"], true),
        ["deckcraft"] = (["mcp"], true),
        ["cadcraft"] = (["mcp"], false),
        ["gridcraft"] = (["mcp"], false),
    };

    private const int MaxSessoes = 4;
    private static readonly TimeSpan Ociosa = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan Prazo = TimeSpan.FromMinutes(2);

    private readonly EstudioOptions _opt;
    private readonly EstudioArmazenamento _arm;
    private readonly ConcurrentDictionary<string, Sessao> _sessoes = new();
    private readonly Timer _limpeza;

    public CraftsLocal(IOptions<EstudioOptions> opt, EstudioArmazenamento arm)
    {
        _opt = opt.Value;
        _arm = arm;
        _limpeza = new Timer(_ => Limpar(), null, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(1));
    }

    private sealed class Sessao
    {
        public required string Id { get; init; }
        public required string App { get; init; }
        public required string Pasta { get; init; }
        public required Process Processo { get; init; }
        public ConcurrentDictionary<string, TaskCompletionSource<JsonObject>> Pendentes { get; } = new();
        public DateTime UsadaEm { get; set; } = DateTime.UtcNow;
        public StringBuilder Erro { get; } = new();
        public SemaphoreSlim Escrita { get; } = new(1, 1);
    }

    public static string Executavel(string pasta, string app) =>
        Path.Combine(pasta, OperatingSystem.IsWindows() ? $"{app}-cli.exe" : $"{app}-cli");

    public static string[] ArgumentosDa(string app, string pasta)
    {
        var (args, raizes) = Apps[app];
        return raizes ? [.. args, "--automation-read-root", pasta, "--automation-write-root", pasta] : args;
    }

    /// <summary>Repassa uma mensagem (ou um lote) à CLI da sessão; abre a sessão no initialize.</summary>
    public async Task<(int Status, string? Sessao, JsonNode? Corpo)> Enviar(string app, string? idSessao, JsonNode corpo, CancellationToken ct)
    {
        var mensagens = corpo is JsonArray lote ? lote.OfType<JsonObject>().ToList() : corpo is JsonObject o ? [o] : [];
        Sessao? s = null;
        if (idSessao is not null) _sessoes.TryGetValue(idSessao, out s);
        if (s is null)
        {
            if (!mensagens.Any(m => (string?)m["method"] == "initialize"))
                return (idSessao is null ? 400 : 404, null, ErroRpc(null, idSessao is null ? "falta o cabeçalho Mcp-Session-Id" : "sessão encerrada; comece com initialize"));
            var exe = Executavel(_opt.CraftsCliDir!, app);
            if (!File.Exists(exe)) return (503, null, ErroRpc(null, $"A linha de comando do {app} não está instalada ({exe})."));
            s = Abrir(app, exe);
        }
        if (s.App != app) return (400, null, ErroRpc(null, "a sessão é de outro app"));

        var respostas = (await Task.WhenAll(mensagens.Select(m => Mandar(s, m, ct)))).OfType<JsonObject>().ToList();
        if (respostas.Count == 0) return (202, s.Id, null);
        return (200, s.Id, corpo is JsonArray ? new JsonArray([.. respostas]) : respostas[0]);
    }

    public void Fechar(string id)
    {
        if (!_sessoes.TryRemove(id, out var s)) return;
        try { if (!s.Processo.HasExited) s.Processo.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
        s.Processo.Dispose();
        try { Directory.Delete(s.Pasta, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private Sessao Abrir(string app, string exe)
    {
        // Sem memória para mais uma CLI: fecha a sessão parada há mais tempo.
        if (_sessoes.Count >= MaxSessoes && _sessoes.Values.MinBy(x => x.UsadaEm) is { } velha) Fechar(velha.Id);
        var id = Guid.NewGuid().ToString();
        var pasta = CraftsMcp.PastaDaSessao(_arm, id);
        Directory.CreateDirectory(pasta);
        var info = new ProcessStartInfo(exe)
        {
            WorkingDirectory = pasta,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false),
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in ArgumentosDa(app, pasta)) info.ArgumentList.Add(a);
        if (!OperatingSystem.IsWindows()) info.Environment["HOME"] = pasta;
        var proc = new Process { StartInfo = info, EnableRaisingEvents = true };
        var s = new Sessao { Id = id, App = app, Pasta = pasta, Processo = proc };
        proc.ErrorDataReceived += (_, e) =>
        {
            if (e.Data is null) return;
            lock (s.Erro) { s.Erro.AppendLine(e.Data); if (s.Erro.Length > 2000) s.Erro.Remove(0, s.Erro.Length - 2000); }
        };
        proc.Exited += (_, _) =>
        {
            string erro;
            lock (s.Erro) erro = s.Erro.ToString().Trim();
            var codigo = -1;
            try { codigo = proc.ExitCode; } catch (InvalidOperationException) { }
            foreach (var p in s.Pendentes.Values) p.TrySetResult(ErroRpc(null, $"{app}-cli saiu ({codigo}): {(erro.Length > 400 ? erro[^400..] : erro)}"));
            s.Pendentes.Clear();
            _sessoes.TryRemove(id, out _);
        };
        proc.Start();
        proc.BeginErrorReadLine();
        _ = Task.Run(() => Ler(s));
        _sessoes[id] = s;
        return s;
    }

    private static async Task Ler(Sessao s)
    {
        try
        {
            while (await s.Processo.StandardOutput.ReadLineAsync() is { } linha)
            {
                JsonNode? msg;
                try { msg = JsonNode.Parse(linha); } catch (JsonException) { continue; }
                foreach (var m in msg is JsonArray a ? a.OfType<JsonObject>() : msg is JsonObject o ? [o] : [])
                    if (m["id"] is { } id && (m.ContainsKey("result") || m.ContainsKey("error")) && s.Pendentes.TryRemove(id.ToJsonString(), out var p))
                        p.TrySetResult(m);
            }
        }
        catch (Exception e) when (e is IOException or ObjectDisposedException or InvalidOperationException) { }
    }

    /// <summary>Notificação (sem id) só é escrita; requisição espera a resposta com o mesmo id.</summary>
    private static async Task<JsonObject?> Mandar(Sessao s, JsonObject msg, CancellationToken ct)
    {
        s.UsadaEm = DateTime.UtcNow;
        var id = msg["id"];
        TaskCompletionSource<JsonObject>? espera = null;
        if (id is not null)
        {
            espera = new TaskCompletionSource<JsonObject>(TaskCreationOptions.RunContinuationsAsynchronously);
            s.Pendentes[id.ToJsonString()] = espera;
        }
        await s.Escrita.WaitAsync(ct);
        try
        {
            await s.Processo.StandardInput.WriteLineAsync(msg.ToJsonString());
            await s.Processo.StandardInput.FlushAsync(ct);
        }
        catch (Exception e) when (e is IOException or InvalidOperationException)
        {
            if (id is null) return null;
            s.Pendentes.TryRemove(id.ToJsonString(), out _);
            return ErroRpc(id, $"{s.App}-cli não está mais rodando.");
        }
        finally { s.Escrita.Release(); }
        if (espera is null) return null;
        try
        {
            var r = await espera.Task.WaitAsync(Prazo, ct);
            r["id"] = id!.DeepClone();
            return r;
        }
        catch (TimeoutException)
        {
            s.Pendentes.TryRemove(id!.ToJsonString(), out _);
            return ErroRpc(id, $"{s.App} não respondeu em {Prazo.TotalSeconds:0} s", -32001);
        }
    }

    private void Limpar()
    {
        var limite = DateTime.UtcNow - Ociosa;
        foreach (var s in _sessoes.Values.Where(x => x.UsadaEm < limite).ToList()) Fechar(s.Id);
    }

    private static JsonObject ErroRpc(JsonNode? id, string mensagem, int codigo = -32000) => new()
    {
        ["jsonrpc"] = "2.0", ["id"] = id?.DeepClone(), ["error"] = new JsonObject { ["code"] = codigo, ["message"] = mensagem },
    };

    public void Dispose()
    {
        _limpeza.Dispose();
        foreach (var id in _sessoes.Keys.ToList()) Fechar(id);
    }
}
