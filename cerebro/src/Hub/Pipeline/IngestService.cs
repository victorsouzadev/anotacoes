using System.Text;
using System.Threading.Channels;
using Hub.Core;
using Hub.Data;
using Hub.Vault;
using Microsoft.Extensions.Options;

namespace Hub.Pipeline;

public static class CaptureKind
{
    public const string Text = "text";
    public const string Link = "link";
    public const string File = "file";
    public const string Webhook = "webhook";
}

public sealed record CaptureRequest(
    string Source,
    string? ExternalId,
    string Kind,
    string? Content,
    string? Url,
    string? Title,
    IReadOnlyList<string>? Tags,
    DateTimeOffset? OccurredAt,
    string? AttachmentPath = null,
    string? RawPayload = null);

public sealed record CaptureResult(string Id, string Path, string Status, bool Duplicate);

/// <summary>Fila em memória de ids de captura. O estado durável fica no HubDb.</summary>
public sealed class ProcessingQueue
{
    private readonly Channel<string> _channel = Channel.CreateUnbounded<string>();
    public void Enqueue(string id) => _channel.Writer.TryWrite(id);
    public ChannelReader<string> Reader => _channel.Reader;
}

/// <summary>Toda entrada vira uma nota na Inbox e um item na fila. Nada vai direto para notas permanentes.</summary>
public sealed class IngestService
{
    private readonly VaultStore _vault;
    private readonly HubDb _db;
    private readonly ProcessingQueue _queue;
    private readonly HubClock _clock;
    private readonly HubOptions _options;
    private readonly ILogger<IngestService> _log;

    public IngestService(VaultStore vault, HubDb db, ProcessingQueue queue, HubClock clock,
        IOptions<HubOptions> options, ILogger<IngestService> log)
    {
        _vault = vault;
        _db = db;
        _queue = queue;
        _clock = clock;
        _options = options.Value;
        _log = log;
    }

    public async Task<CaptureResult> CaptureAsync(CaptureRequest req, CancellationToken ct = default)
    {
        var source = NormalizeSource(req.Source);
        var externalId = string.IsNullOrWhiteSpace(req.ExternalId) ? null : req.ExternalId.Trim();

        if (externalId is not null && _db.FindByExternal(source, externalId) is { } existing)
            return new CaptureResult(existing.Id, existing.Path, existing.Status, Duplicate: true);

        var now = _clock.Now;
        var occurred = req.OccurredAt is { } o ? _clock.ToLocal(o) : now;
        var id = Guid.CreateVersion7().ToString("N");
        var title = BuildTitle(req);
        var fileName = $"{occurred:yyyy-MM-dd HHmm} {source} - {VaultLayout.SafeFileName(title, 50)}";
        var path = _vault.UniquePath(VaultLayout.Inbox, fileName);

        var trust = req.Kind == CaptureKind.Text &&
                    _options.TrustedSources.Contains(source, StringComparer.OrdinalIgnoreCase)
            ? "self"
            : "external";

        var record = new CaptureRecord(id, source, externalId, req.Kind, path, CaptureStatus.Queued, 0, null, now, now);
        if (!_db.TryInsert(record))
        {
            // Corrida: outra requisição com o mesmo external_id entrou primeiro.
            var dup = externalId is null ? null : _db.FindByExternal(source, externalId);
            if (dup is not null) return new CaptureResult(dup.Id, dup.Path, dup.Status, Duplicate: true);
            throw new InvalidOperationException("Não foi possível registrar a captura.");
        }

        var fm = new FrontMatter()
            .Set("id", id)
            .Set("type", "capture")
            .Set("source", source);
        if (externalId is not null) fm.Set("external_id", externalId);
        fm.Set("kind", req.Kind)
            .Set("created", occurred)
            .Set("status", "inbox")
            .Set("trust", trust)
            .Set("tags", req.Tags?.Select(t => t.Trim().TrimStart('#')).ToList() ?? new List<string>());
        if (!string.IsNullOrWhiteSpace(req.Url)) fm.Set("url", req.Url.Trim());
        fm.Set("suggested_folder", null)
          .Set("suggested_links", new List<string>())
          .Set("approve", false);

        var body = new StringBuilder();
        // Sem título explícito, o título é a primeira linha do texto: não repete como H1.
        var titleFromContent = string.IsNullOrWhiteSpace(req.Title) && !string.IsNullOrWhiteSpace(req.Content);
        if (!titleFromContent) body.Append("# ").Append(title).Append("\n\n");
        if (!string.IsNullOrWhiteSpace(req.Content)) body.Append(req.Content.Trim()).Append("\n\n");
        if (!string.IsNullOrWhiteSpace(req.Url)) body.Append("Fonte: ").Append(req.Url.Trim()).Append("\n\n");
        if (req.AttachmentPath is not null) body.Append("![[").Append(req.AttachmentPath).Append("]]\n\n");
        if (req.RawPayload is not null) body.Append("```json\n").Append(req.RawPayload.Trim()).Append("\n```\n");

        try
        {
            await _vault.CreateAsync(path, new NoteDocument(fm, body.ToString()), $"captura {source}", ct);
        }
        catch (Exception ex)
        {
            _db.Update(id, status: CaptureStatus.Error, error: ex.Message);
            throw;
        }

        _queue.Enqueue(id);
        _log.LogInformation("Captura {Id} de {Source} em {Path}", id, source, path);
        return new CaptureResult(id, path, CaptureStatus.Queued, Duplicate: false);
    }

    /// <summary>Verifica duplicata antes de gastar trabalho (ex.: salvar um anexo).</summary>
    public CaptureResult? FindDuplicate(string source, string? externalId)
    {
        if (string.IsNullOrWhiteSpace(externalId)) return null;
        return _db.FindByExternal(NormalizeSource(source), externalId.Trim()) is { } existing
            ? new CaptureResult(existing.Id, existing.Path, existing.Status, Duplicate: true)
            : null;
    }

    private static string BuildTitle(CaptureRequest req)
    {
        if (!string.IsNullOrWhiteSpace(req.Title)) return req.Title.Trim();

        var firstLine = req.Content?
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(firstLine))
            return firstLine.Length > 60 ? firstLine[..60].TrimEnd() + "…" : firstLine;

        if (!string.IsNullOrWhiteSpace(req.Url) && Uri.TryCreate(req.Url, UriKind.Absolute, out var uri))
            return uri.Host + uri.AbsolutePath.TrimEnd('/');

        if (req.AttachmentPath is not null) return Path.GetFileNameWithoutExtension(req.AttachmentPath);

        return "Captura";
    }

    private static string NormalizeSource(string source)
    {
        var s = VaultLayout.Slug(string.IsNullOrWhiteSpace(source) ? "api" : source, 30);
        return s == "item" ? "api" : s;
    }
}
