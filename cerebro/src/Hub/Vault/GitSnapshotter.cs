using System.Diagnostics;
using System.Threading.Channels;
using Hub.Core;
using Microsoft.Extensions.Options;

namespace Hub.Vault;

/// <summary>
/// Versiona o vault num repositório git fora dele (DataPath/vault.git), para o
/// histórico não entrar no sync. Commita alguns segundos depois de cada escrita
/// do hub e, periodicamente, as mudanças que vieram do sync (edições suas).
/// </summary>
public sealed class GitSnapshotter : BackgroundService
{
    private readonly HubOptions _options;
    private readonly VaultStore _vault;
    private readonly ILogger<GitSnapshotter> _log;
    private readonly Channel<string> _signals = Channel.CreateUnbounded<string>();
    private readonly string _gitDir;

    public DateTimeOffset? LastCommitAt { get; private set; }

    public GitSnapshotter(IOptions<HubOptions> options, VaultStore vault, ILogger<GitSnapshotter> log)
    {
        _options = options.Value;
        _vault = vault;
        _log = log;
        _gitDir = Path.Combine(Path.GetFullPath(_options.DataPath), "vault.git");
        _vault.Written += (path, reason) => _signals.Writer.TryWrite($"{reason}: {path}");
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.GitEnabled)
        {
            _log.LogInformation("Git desativado (Hub:GitEnabled=false).");
            return;
        }

        try
        {
            await InitAsync(stoppingToken);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Não foi possível iniciar o repositório git; snapshots desativados.");
            return;
        }

        await CommitAsync("hub: snapshot inicial", stoppingToken);

        var debounce = TimeSpan.FromSeconds(Math.Max(1, _options.GitDebounceSeconds));
        var periodic = TimeSpan.FromMinutes(Math.Max(1, _options.GitPeriodicMinutes));

        while (!stoppingToken.IsCancellationRequested)
        {
            var reasons = new List<string>();
            using var periodicCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
            periodicCts.CancelAfter(periodic);

            try
            {
                reasons.Add(await _signals.Reader.ReadAsync(periodicCts.Token));
                await Task.Delay(debounce, stoppingToken);
                while (_signals.Reader.TryRead(out var more)) reasons.Add(more);
            }
            catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
            {
                // Tempo periódico esgotado: captura mudanças feitas pelo sync.
            }
            catch (OperationCanceledException)
            {
                break;
            }

            var message = reasons.Count == 0
                ? "sync: alterações externas"
                : "hub: " + string.Join("; ", reasons.Distinct().Take(10)) + (reasons.Count > 10 ? $" (+{reasons.Count - 10})" : "");

            await CommitAsync(message, stoppingToken);
        }

        await CommitAsync("hub: snapshot ao desligar", CancellationToken.None);
    }

    private async Task InitAsync(CancellationToken ct)
    {
        if (!Directory.Exists(_gitDir))
        {
            Directory.CreateDirectory(_gitDir);
            await RunAsync(ct, "init", "--bare", _gitDir);
        }
        await RunAsync(ct, "--git-dir", _gitDir, "config", "user.name", "Segundo Cerebro Hub");
        await RunAsync(ct, "--git-dir", _gitDir, "config", "user.email", "hub@localhost");
        await RunAsync(ct, "--git-dir", _gitDir, "config", "core.bare", "false");
        await RunAsync(ct, "--git-dir", _gitDir, "config", "core.quotepath", "false");

        var exclude = Path.Combine(_gitDir, "info", "exclude");
        Directory.CreateDirectory(Path.GetDirectoryName(exclude)!);
        await File.WriteAllTextAsync(exclude,
            ".hub-tmp-*\n.trash/\n.obsidian/workspace*.json\n.obsidian/cache\n", ct);
    }

    private async Task CommitAsync(string message, CancellationToken ct)
    {
        try
        {
            await RunWorkTreeAsync(ct, "add", "-A");
            var status = await RunWorkTreeAsync(ct, "status", "--porcelain");
            if (string.IsNullOrWhiteSpace(status)) return;

            await RunWorkTreeAsync(ct, "commit", "-q", "-m", message);
            LastCommitAt = DateTimeOffset.UtcNow;
            _log.LogInformation("Git: {Message}", message);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogWarning(ex, "Falha no commit git.");
        }
    }

    private Task<string> RunWorkTreeAsync(CancellationToken ct, params string[] args) =>
        RunAsync(ct, new[] { "--git-dir", _gitDir, "--work-tree", _vault.Root }.Concat(args).ToArray());

    private static async Task<string> RunAsync(CancellationToken ct, params string[] args)
    {
        var psi = new ProcessStartInfo("git")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        foreach (var a in args) psi.ArgumentList.Add(a);

        using var process = Process.Start(psi) ?? throw new InvalidOperationException("git não encontrado.");
        var stdout = process.StandardOutput.ReadToEndAsync(ct);
        var stderr = process.StandardError.ReadToEndAsync(ct);
        await process.WaitForExitAsync(ct);

        if (process.ExitCode != 0)
            throw new InvalidOperationException($"git {string.Join(' ', args)} falhou: {await stderr}");
        return await stdout;
    }
}
