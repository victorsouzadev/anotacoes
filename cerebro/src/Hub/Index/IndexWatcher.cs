using System.Threading.Channels;
using Hub.Core;
using Hub.Pipeline;
using Hub.Vault;

namespace Hub.Index;

/// <summary>
/// Mantém o índice em dia com o disco: escritas do hub, do WebDAV (seus aparelhos)
/// ou de qualquer outra coisa. Também detecta approve: true marcado no Obsidian.
/// </summary>
public sealed class IndexWatcher : BackgroundService
{
    private static readonly TimeSpan Debounce = TimeSpan.FromSeconds(1.5);
    private static readonly TimeSpan FullScanInterval = TimeSpan.FromHours(6);

    private readonly VaultStore _vault;
    private readonly NoteIndex _index;
    private readonly ApprovalService _approval;
    private readonly ILogger<IndexWatcher> _log;
    private readonly Channel<string> _changes = Channel.CreateUnbounded<string>();
    private const string FullScanSignal = "\0fullscan";

    public DateTimeOffset? LastExternalChange { get; private set; }

    public IndexWatcher(VaultStore vault, NoteIndex index, ApprovalService approval, ILogger<IndexWatcher> log)
    {
        _vault = vault;
        _index = index;
        _approval = approval;
        _log = log;
        _vault.Written += (path, _) => _changes.Writer.TryWrite(path);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await _index.FullScanAsync(stoppingToken);

        using var watcher = new FileSystemWatcher(_vault.Root)
        {
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size,
            InternalBufferSize = 64 * 1024
        };
        watcher.Changed += (_, e) => OnFsEvent(e.FullPath);
        watcher.Created += (_, e) => OnFsEvent(e.FullPath);
        watcher.Deleted += (_, e) => OnFsEvent(e.FullPath);
        watcher.Renamed += (_, e) => { OnFsEvent(e.OldFullPath); OnFsEvent(e.FullPath); };
        watcher.Error += (_, e) =>
        {
            _log.LogWarning(e.GetException(), "Watcher perdeu eventos; agendando varredura completa.");
            _changes.Writer.TryWrite(FullScanSignal);
        };
        watcher.EnableRaisingEvents = true;

        using var timer = new PeriodicTimer(FullScanInterval);
        _ = Task.Run(async () =>
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
                _changes.Writer.TryWrite(FullScanSignal);
        }, stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            var batch = new HashSet<string>(StringComparer.Ordinal);
            try
            {
                batch.Add(await _changes.Reader.ReadAsync(stoppingToken));
                await Task.Delay(Debounce, stoppingToken);
                while (_changes.Reader.TryRead(out var more)) batch.Add(more);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            if (batch.Remove(FullScanSignal))
            {
                try { await _index.FullScanAsync(stoppingToken); }
                catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogError(ex, "Falha na varredura completa."); }
            }

            foreach (var rel in batch)
            {
                try
                {
                    await _index.UpsertAsync(rel, stoppingToken);
                    if (VaultLayout.IsUnder(rel, VaultLayout.Inbox))
                        await _approval.HandleInboxChangeAsync(rel, stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _log.LogWarning(ex, "Falha ao reindexar {Path}", rel);
                }
            }
        }
    }

    private void OnFsEvent(string fullPath)
    {
        string rel;
        try { rel = _vault.ToRelative(fullPath); }
        catch (Exception) { return; }

        if (rel.StartsWith("..", StringComparison.Ordinal) || rel.Split('/').Any(p => p.StartsWith('.'))) return;

        if (rel.EndsWith(".md", StringComparison.OrdinalIgnoreCase))
        {
            LastExternalChange = DateTimeOffset.UtcNow;
            _changes.Writer.TryWrite(rel);
        }
        else if (!Path.HasExtension(rel))
        {
            // Pasta criada, movida ou apagada: mais simples revarrer tudo.
            _changes.Writer.TryWrite(FullScanSignal);
        }
    }
}
