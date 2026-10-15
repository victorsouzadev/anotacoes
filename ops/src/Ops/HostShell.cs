using System.Diagnostics;
using System.Text;
using Microsoft.Extensions.Options;

namespace Ops;

public sealed record ShellResult(int ExitCode, string Stdout, string Stderr, bool TimedOut, bool Truncated, long ElapsedMs);

/// <summary>
/// Executa comandos de shell como root no host da VPS. No modo "nsenter" o processo entra nos
/// namespaces do PID 1 (mount, uts, ipc, rede, pid): é um shell do host, não do container.
/// </summary>
public sealed class HostShell
{
    private readonly OpsOptions _options;

    public HostShell(IOptions<OpsOptions> options) => _options = options.Value;

    public string Mode => _options.Mode;

    public async Task<ShellResult> RunAsync(string command, int timeoutSeconds, string? workingDirectory = null, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(command)) throw new ArgumentException("Comando vazio.");
        var timeout = TimeSpan.FromSeconds(Math.Clamp(timeoutSeconds, 1, _options.MaxTimeoutSeconds));

        // O cd vai no próprio script: o diretório é do host, não do container.
        var script = string.IsNullOrWhiteSpace(workingDirectory) ? command : $"cd {Quote(workingDirectory)} && {command}";

        var psi = new ProcessStartInfo
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true,
            UseShellExecute = false,
        };
        if (_options.Mode == "nsenter")
        {
            psi.FileName = "nsenter";
            foreach (var a in new[] { "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "/bin/bash", "-lc", script })
                psi.ArgumentList.Add(a);
        }
        else
        {
            psi.FileName = "/bin/sh";
            psi.ArgumentList.Add("-c");
            psi.ArgumentList.Add(script);
        }

        var sw = Stopwatch.StartNew();
        using var process = Process.Start(psi) ?? throw new InvalidOperationException("Não foi possível iniciar o shell.");
        process.StandardInput.Close();

        var stdout = new BoundedBuffer(_options.MaxOutputBytes);
        var stderr = new BoundedBuffer(_options.MaxOutputBytes);
        var outTask = PumpAsync(process.StandardOutput, stdout);
        var errTask = PumpAsync(process.StandardError, stderr);

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(timeout);
        var timedOut = false;
        try
        {
            await process.WaitForExitAsync(timeoutCts.Token);
        }
        catch (OperationCanceledException)
        {
            timedOut = !ct.IsCancellationRequested;
            try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            await process.WaitForExitAsync(CancellationToken.None);
            if (!timedOut) throw;
        }
        await Task.WhenAll(outTask, errTask);

        return new ShellResult(
            timedOut ? -1 : process.ExitCode,
            stdout.ToString(), stderr.ToString(),
            timedOut, stdout.Truncated || stderr.Truncated, sw.ElapsedMilliseconds);
    }

    /// <summary>Aspas simples de shell: nada dentro é interpretado.</summary>
    public static string Quote(string value) => "'" + value.Replace("'", "'\\''") + "'";

    private static async Task PumpAsync(StreamReader reader, BoundedBuffer buffer)
    {
        var chunk = new char[8192];
        int n;
        while ((n = await reader.ReadAsync(chunk)) > 0) buffer.Append(chunk, n);
    }

    /// <summary>Guarda o começo e o fim da saída; o meio de uma saída enorme some.</summary>
    private sealed class BoundedBuffer(int maxChars)
    {
        private readonly StringBuilder _head = new();
        private readonly StringBuilder _tail = new();
        private readonly int _half = Math.Max(1, maxChars / 2);
        public bool Truncated { get; private set; }

        public void Append(char[] data, int count)
        {
            lock (_head)
            {
                var start = 0;
                if (_head.Length < _half)
                {
                    var take = Math.Min(_half - _head.Length, count);
                    _head.Append(data, 0, take);
                    start = take;
                }
                if (start >= count) return;
                _tail.Append(data, start, count - start);
                if (_tail.Length > _half)
                {
                    Truncated = true;
                    _tail.Remove(0, _tail.Length - _half);
                }
            }
        }

        public override string ToString()
        {
            lock (_head)
                return Truncated ? $"{_head}\n… [saída cortada no meio] …\n{_tail}" : _head.ToString() + _tail;
        }
    }
}
