using System.Text;
using Hub.Core;
using Hub.Data;
using Hub.Vault;

namespace Hub.Pipeline;

public sealed record ApprovalResult(string Path, string Status);

/// <summary>
/// Aplica ou descarta a sugestão de um item da Inbox.
/// Disparado pelo frontmatter (approve: true / approve: reject), pela API ou pelo MCP.
/// </summary>
public sealed class ApprovalService
{
    private readonly VaultStore _vault;
    private readonly HubDb _db;
    private readonly HubClock _clock;
    private readonly ILogger<ApprovalService> _log;
    private readonly SemaphoreSlim _lock = new(1, 1);

    public ApprovalService(VaultStore vault, HubDb db, HubClock clock, ILogger<ApprovalService> log)
    {
        _vault = vault;
        _db = db;
        _clock = clock;
        _log = log;
    }

    /// <summary>Aceita caminho relativo da nota ou id da captura.</summary>
    public string ResolvePath(string pathOrId)
    {
        if (_db.Get(pathOrId) is { } capture) return capture.Path;
        var rel = VaultLayout.NormalizeRelative(pathOrId);
        return rel.EndsWith(".md", StringComparison.OrdinalIgnoreCase) ? rel : rel + ".md";
    }

    public async Task<ApprovalResult> ApproveAsync(string pathOrId, string? folderOverride = null, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            var rel = ResolvePath(pathOrId);
            if (!_vault.Exists(rel))
                throw new FileNotFoundException($"Nota não encontrada: {rel}");
            if (!VaultLayout.IsUnder(rel, VaultLayout.Inbox))
                throw new VaultAccessException("Só itens da Inbox podem ser aprovados.");

            var doc = await _vault.ReadAsync(rel, ct);
            var folder = !string.IsNullOrWhiteSpace(folderOverride)
                ? folderOverride
                : doc.FrontMatter.GetString("suggested_folder");

            if (string.IsNullOrWhiteSpace(folder))
                throw new InvalidOperationException("Sem pasta de destino: preencha suggested_folder ou informe a pasta.");
            folder = VaultLayout.NormalizeRelative(folder);
            if (!VaultLayout.IsPermanentTarget(folder))
                throw new VaultAccessException($"Destino não permitido: {folder}. Use uma de: {string.Join(", ", VaultLayout.PermanentFolders)}");

            var links = doc.FrontMatter.GetList("suggested_links");
            var title = doc.FrontMatter.GetString("title") ?? VaultLayout.StripCapturePrefix(doc.ResolveTitle(rel));

            doc.FrontMatter
                .Set("status", "filed")
                .Set("filed", _clock.Now)
                .Remove("approve")
                .Remove("suggested_folder")
                .Remove("suggested_links");

            if (links.Count > 0 && !doc.Body.Contains("## Relacionadas"))
            {
                var sb = new StringBuilder(doc.Body.TrimEnd('\n'));
                sb.Append("\n\n## Relacionadas\n\n");
                foreach (var l in links) sb.Append("- ").Append(l).Append('\n');
                doc.Body = sb.ToString();
            }

            await _vault.ReplaceAsync(rel, doc, "aprovação", ct);
            var dest = await _vault.MoveFromInboxAsync(rel, folder, title, "aprovação", ct);

            if (doc.FrontMatter.GetString("id") is { } id && _db.Get(id) is not null)
                _db.Update(id, status: CaptureStatus.Filed, path: dest);

            _log.LogInformation("Aprovado: {From} → {To}", rel, dest);
            return new ApprovalResult(dest, CaptureStatus.Filed);
        }
        finally { _lock.Release(); }
    }

    public async Task<ApprovalResult> RejectAsync(string pathOrId, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            var rel = ResolvePath(pathOrId);
            if (!_vault.Exists(rel))
                throw new FileNotFoundException($"Nota não encontrada: {rel}");
            if (!VaultLayout.IsUnder(rel, VaultLayout.Inbox))
                throw new VaultAccessException("Só itens da Inbox podem ser rejeitados.");

            var doc = await _vault.ReadAsync(rel, ct);
            doc.FrontMatter.Set("status", "rejected").Set("rejected", _clock.Now).Remove("approve");
            await _vault.ReplaceAsync(rel, doc, "rejeição", ct);
            var dest = await _vault.MoveFromInboxAsync(rel, VaultLayout.RejectedInbox,
                Path.GetFileNameWithoutExtension(rel), "rejeição", ct);

            if (doc.FrontMatter.GetString("id") is { } id && _db.Get(id) is not null)
                _db.Update(id, status: CaptureStatus.Rejected, path: dest);

            return new ApprovalResult(dest, CaptureStatus.Rejected);
        }
        finally { _lock.Release(); }
    }

    /// <summary>
    /// Chamado pelo watcher quando uma nota da Inbox muda: se você marcou
    /// approve: true (ou "reject") no Obsidian, executa a ação.
    /// </summary>
    public async Task HandleInboxChangeAsync(string rel, CancellationToken ct)
    {
        if (!VaultLayout.IsUnder(rel, VaultLayout.Inbox) || !_vault.Exists(rel)) return;

        NoteDocument doc;
        try { doc = await _vault.ReadAsync(rel, ct); }
        catch (IOException) { return; }

        var approve = doc.FrontMatter.GetString("approve")?.Trim().ToLowerInvariant();
        try
        {
            if (approve is "true" or "yes" or "sim")
                await ApproveAsync(rel, null, ct);
            else if (approve is "reject" or "rejeitar" or "nao" or "não")
                await RejectAsync(rel, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogWarning(ex, "Aprovação pelo Obsidian falhou para {Path}", rel);
            await MarkErrorAsync(rel, ex.Message, ct);
        }
    }

    private async Task MarkErrorAsync(string rel, string message, CancellationToken ct)
    {
        try
        {
            var doc = await _vault.ReadAsync(rel, ct);
            doc.FrontMatter.Set("approve", false).Set("hub_error", message);
            await _vault.ReplaceAsync(rel, doc, "erro de aprovação", ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogWarning(ex, "Não consegui marcar o erro em {Path}", rel);
        }
    }
}
