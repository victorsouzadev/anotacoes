using System.Text;
using Hub.Core;
using Hub.Data;
using Hub.Index;
using Hub.Vault;
using Microsoft.Extensions.Options;

namespace Hub.Pipeline;

/// <summary>
/// Processa a Inbox em segundo plano: extrai (link, áudio), enriquece com o
/// Claude e grava a sugestão no frontmatter. Por padrão não move nada:
/// quem aprova é você.
/// </summary>
public sealed class ProcessingWorker : BackgroundService
{
    private const int MaxAttempts = 3;

    private readonly ProcessingQueue _queue;
    private readonly HubDb _db;
    private readonly VaultStore _vault;
    private readonly NoteIndex _index;
    private readonly LinkExtractor _links;
    private readonly Transcriber _transcriber;
    private readonly ClaudeClassifier _classifier;
    private readonly ApprovalService _approval;
    private readonly HubOptions _options;
    private readonly ILogger<ProcessingWorker> _log;

    public ProcessingWorker(ProcessingQueue queue, HubDb db, VaultStore vault, NoteIndex index,
        LinkExtractor links, Transcriber transcriber, ClaudeClassifier classifier, ApprovalService approval,
        IOptions<HubOptions> options, ILogger<ProcessingWorker> log)
    {
        _queue = queue;
        _db = db;
        _vault = vault;
        _index = index;
        _links = links;
        _transcriber = transcriber;
        _classifier = classifier;
        _approval = approval;
        _options = options.Value;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Retoma o que ficou pendente antes de um restart.
        foreach (var pending in _db.ListByStatus(CaptureStatus.Queued, CaptureStatus.Processing))
            _queue.Enqueue(pending.Id);

        if (!_classifier.Enabled)
            _log.LogWarning("Sem provedor de IA (tela do Cérebro ou .env): capturas ficam na Inbox sem classificação.");

        await foreach (var id in _queue.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                await ProcessAsync(id, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                await HandleFailureAsync(id, ex, stoppingToken);
            }
        }
    }

    private async Task ProcessAsync(string id, CancellationToken ct)
    {
        var capture = _db.Get(id);
        if (capture is null || capture.Status is not (CaptureStatus.Queued or CaptureStatus.Processing)) return;

        if (!_vault.Exists(capture.Path))
        {
            _db.Update(id, status: CaptureStatus.Error, error: "Nota removida antes do processamento.");
            return;
        }

        _db.Update(id, status: CaptureStatus.Processing);
        var doc = await _vault.ReadAsync(capture.Path, ct);
        var extra = new StringBuilder();

        // 1. Extração
        var url = doc.FrontMatter.GetString("url");
        if (capture.Kind == CaptureKind.Link && !string.IsNullOrWhiteSpace(url) && !doc.Body.Contains("## Conteúdo extraído"))
        {
            var page = await _links.ExtractAsync(url, ct);
            if (page is not null)
            {
                if (!string.IsNullOrWhiteSpace(page.Title)) doc.FrontMatter.Set("page_title", page.Title);
                extra.Append("\n## Conteúdo extraído\n\n").Append(page.Text).Append('\n');
            }
        }

        var attachment = FindAttachment(doc.Body);
        if (attachment is not null && Transcriber.IsAudio(attachment) && !doc.Body.Contains("## Transcrição"))
        {
            if (_transcriber.Enabled)
            {
                var text = await _transcriber.TranscribeAsync(_vault.FullPath(attachment), ct);
                extra.Append("\n## Transcrição\n\n").Append(text).Append('\n');
            }
            else
            {
                doc.FrontMatter.Set("hub_note", "Transcrição desativada (Hub:Transcription:ApiKey vazio).");
            }
        }

        if (extra.Length > 0)
            doc.Body = doc.Body.TrimEnd('\n') + "\n" + extra;

        // 2. Classificação
        if (_classifier.Enabled)
        {
            var title = ProvisionalTitle(doc, capture.Path);
            var folders = AllowedFolders();
            var candidates = _index.Candidates(title + "\n" + doc.Body);
            var result = await _classifier.ClassifyAsync(title, doc.Body, capture.Source, folders, candidates, ct);

            var tags = doc.FrontMatter.GetList("tags").Concat(result.Tags).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            doc.FrontMatter
                .Set("title", result.Title)
                .Set("summary", result.Summary)
                .Set("tags", tags)
                .Set("suggested_folder", result.Folder)
                .Set("suggested_links", result.Links.Select(l => $"[[{l}]]").ToList())
                .Set("confidence", result.Confidence.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture));

            if (!string.IsNullOrWhiteSpace(result.Summary) && !doc.Body.Contains("> [!summary]"))
                doc.Body = InsertAfterH1(doc.Body, $"> [!summary] Resumo\n> {result.Summary}\n");
        }

        doc.FrontMatter.Set("status", "processed").Remove("hub_error");
        await _vault.ReplaceAsync(capture.Path, doc, "processamento", ct);
        _db.Update(id, status: CaptureStatus.Processed, clearError: true);

        // 3. Movimento automático só para o caso de baixo risco (links → Recursos).
        if (_options.AutoMoveLowRisk && _classifier.Enabled && capture.Kind == CaptureKind.Link &&
            VaultLayout.IsUnder(doc.FrontMatter.GetString("suggested_folder") ?? "", VaultLayout.Resources))
        {
            await _approval.ApproveAsync(capture.Path, null, ct);
        }
    }

    private async Task HandleFailureAsync(string id, Exception ex, CancellationToken ct)
    {
        _db.Update(id, incrementAttempts: true, error: ex.Message);
        var capture = _db.Get(id);
        if (capture is null) return;

        if (capture.Attempts < MaxAttempts)
        {
            var delay = TimeSpan.FromSeconds(15 * Math.Pow(2, capture.Attempts - 1));
            _log.LogWarning(ex, "Captura {Id} falhou (tentativa {N}); nova tentativa em {Delay}", id, capture.Attempts, delay);
            _db.Update(id, status: CaptureStatus.Queued);
            _ = Task.Delay(delay, ct).ContinueWith(_ => _queue.Enqueue(id), TaskContinuationOptions.OnlyOnRanToCompletion);
            return;
        }

        _log.LogError(ex, "Captura {Id} falhou {N} vezes; marcada como erro.", id, capture.Attempts);
        _db.Update(id, status: CaptureStatus.Error);
        try
        {
            if (_vault.Exists(capture.Path))
            {
                var doc = await _vault.ReadAsync(capture.Path, ct);
                doc.FrontMatter.Set("status", "error").Set("hub_error", ex.Message);
                await _vault.ReplaceAsync(capture.Path, doc, "erro de processamento", ct);
            }
        }
        catch (Exception inner) when (inner is not OperationCanceledException)
        {
            _log.LogWarning(inner, "Não consegui registrar o erro na nota {Path}", capture.Path);
        }
    }

    /// <summary>Pastas permanentes + subpastas existentes (até 2 níveis) como opções de destino.</summary>
    private List<string> AllowedFolders()
    {
        var folders = new List<string>();
        foreach (var root in VaultLayout.PermanentFolders)
        {
            folders.Add(root);
            var full = _vault.FullPath(root);
            if (!Directory.Exists(full)) continue;
            foreach (var dir in Directory.EnumerateDirectories(full, "*", new EnumerationOptions { RecurseSubdirectories = true, MaxRecursionDepth = 1 }))
            {
                var rel = _vault.ToRelative(dir);
                if (rel.Split('/').Any(p => p.StartsWith('.')) || VaultLayout.IsUnder(rel, VaultLayout.RejectedInbox)) continue;
                folders.Add(rel);
            }
        }
        return folders.Take(60).ToList();
    }

    /// <summary>Título para o LLM: title, H1 ou primeira linha do texto (não o nome do arquivo com data).</summary>
    internal static string ProvisionalTitle(NoteDocument doc, string path)
    {
        var title = doc.ResolveTitle(path);
        if (title != Path.GetFileNameWithoutExtension(path)) return title;
        var firstLine = doc.Body.Split('\n').Select(l => l.Trim().TrimStart('>', '#', '-', ' ')).FirstOrDefault(l => l.Length > 0);
        return firstLine ?? VaultLayout.StripCapturePrefix(title);
    }

    private static string? FindAttachment(string body)
    {
        var start = body.IndexOf("![[" + VaultLayout.Attachments + "/", StringComparison.Ordinal);
        if (start < 0) return null;
        var end = body.IndexOf("]]", start, StringComparison.Ordinal);
        return end < 0 ? null : body[(start + 3)..end];
    }

    private static string InsertAfterH1(string body, string block)
    {
        var lines = body.Split('\n').ToList();
        var h1 = lines.FindIndex(l => l.StartsWith("# ", StringComparison.Ordinal));
        if (h1 < 0) return block + "\n" + body;
        lines.Insert(h1 + 1, "\n" + block.TrimEnd('\n'));
        return string.Join('\n', lines);
    }
}
