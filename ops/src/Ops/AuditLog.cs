using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Ops;

/// <summary>Uma linha JSON por chamada de ferramenta, em DataPath/audit.log e no log do container.</summary>
public sealed class AuditLog
{
    private readonly string _path;
    private readonly ILogger<AuditLog> _log;
    private readonly SemaphoreSlim _lock = new(1, 1);

    public AuditLog(IOptions<OpsOptions> options, ILogger<AuditLog> log)
    {
        Directory.CreateDirectory(options.Value.DataPath);
        _path = Path.Combine(options.Value.DataPath, "audit.log");
        _log = log;
    }

    public string FilePath => _path;

    public async Task WriteAsync(string tool, object args, int? exitCode, long elapsedMs)
    {
        var line = JsonSerializer.Serialize(new { ts = DateTimeOffset.UtcNow, tool, args, exit = exitCode, ms = elapsedMs });
        _log.LogWarning("ops {Line}", line);
        await _lock.WaitAsync();
        try { await File.AppendAllTextAsync(_path, line + "\n"); }
        catch (IOException ex) { _log.LogError(ex, "Falha ao gravar a auditoria"); }
        finally { _lock.Release(); }
    }
}
