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
    private readonly SemaphoreSlim _gitLock = new(1, 1);
    private volatile bool _ready;

    /// <summary>Repositório pronto para histórico e restauração.</summary>
    public bool Ready => _ready;

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

        _ready = true;
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

    /// <summary>Commita agora o que estiver pendente (ex.: antes de restaurar, para não perder o estado atual).</summary>
    public Task SnapshotNowAsync(string message, CancellationToken ct = default) => CommitAsync(message, ct);

    private async Task CommitAsync(string message, CancellationToken ct)
    {
        await _gitLock.WaitAsync(ct);
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
        finally { _gitLock.Release(); }
    }

    public sealed record Change(string Status, string Path);
    public sealed record Entry(string Commit, DateTimeOffset Date, string Message, IReadOnlyList<Change> Changes);

    /// <summary>
    /// Histórico (o "log" do Cérebro): cada versão com data, motivo (quem mudou: tela, MCP, sync do
    /// Obsidian) e arquivos alterados. Com path, só as versões daquela nota, seguindo renomeações.
    /// </summary>
    public async Task<IReadOnlyList<Entry>> HistoryAsync(string? path, int limit, int skip, CancellationToken ct = default)
    {
        if (!_ready) return [];
        var args = new List<string> { "log", "--format=%x1e%H%x1f%aI%x1f%s", "--name-status", "-n", Math.Clamp(limit, 1, 200).ToString(), "--skip", Math.Max(0, skip).ToString() };
        if (path is not null) { args.Add("--follow"); args.Add("--"); args.Add(path); }

        string output;
        await _gitLock.WaitAsync(ct);
        try { output = await RunWorkTreeAsync(ct, args.ToArray()); }
        catch (InvalidOperationException) { return []; }  // repositório ainda sem commits
        finally { _gitLock.Release(); }

        var list = new List<Entry>();
        foreach (var block in output.Split('\x1e', StringSplitOptions.RemoveEmptyEntries))
        {
            var lines = block.Split('\n', StringSplitOptions.RemoveEmptyEntries);
            var head = lines[0].Split('\x1f');
            if (head.Length < 3) continue;
            var changes = lines.Skip(1)
                .Select(l => l.Split('\t'))
                .Where(p => p.Length >= 2)
                .Select(p => new Change(p[0][..1], p[^1]))
                .ToList();
            list.Add(new Entry(head[0], DateTimeOffset.Parse(head[1], System.Globalization.CultureInfo.InvariantCulture), head[2], changes));
        }
        return list;
    }

    /// <summary>Conteúdo de um arquivo numa versão. Null se ele não existia nela.</summary>
    public async Task<string?> ShowAsync(string commit, string path, CancellationToken ct = default)
    {
        RequireCommit(commit);
        await _gitLock.WaitAsync(ct);
        try { return await RunWorkTreeAsync(ct, "show", $"{commit}:{path}"); }
        catch (InvalidOperationException) { return null; }
        finally { _gitLock.Release(); }
    }

    /// <summary>Arquivos que mudaram depois de uma versão: (status, caminho) com A = criado depois, M = alterado, D = apagado depois.</summary>
    public async Task<IReadOnlyList<Change>> ChangedSinceAsync(string commit, CancellationToken ct = default)
    {
        RequireCommit(commit);
        string output;
        await _gitLock.WaitAsync(ct);
        try { output = await RunWorkTreeAsync(ct, "diff", "--name-status", "--no-renames", commit, "HEAD"); }
        finally { _gitLock.Release(); }
        return output.Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(l => l.Split('\t'))
            .Where(p => p.Length >= 2)
            .Select(p => new Change(p[0][..1], p[1]))
            .ToList();
    }

    private static void RequireCommit(string commit)
    {
        if (commit.Length is < 7 or > 40 || !commit.All(Uri.IsHexDigit))
            throw new ArgumentException("Versão inválida.");
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
