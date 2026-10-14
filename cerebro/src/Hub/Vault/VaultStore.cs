using System.Text;
using Hub.Core;
using Microsoft.Extensions.Options;

namespace Hub.Vault;

/// <summary>
/// Único ponto de leitura e escrita no vault. Garante:
/// caminhos dentro do vault, escrita atômica (temp + rename),
/// que só as pastas permitidas sejam alteradas e que nada seja sobrescrito sem querer.
/// </summary>
public sealed class VaultStore
{
    private const string TempPrefix = ".hub-tmp-";
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly ILogger<VaultStore> _log;

    public string Root { get; }

    /// <summary>Disparado após cada escrita do hub (caminho relativo, motivo).</summary>
    public event Action<string, string>? Written;

    public VaultStore(IOptions<HubOptions> options, ILogger<VaultStore> log)
    {
        _log = log;
        Root = Path.GetFullPath(options.Value.VaultPath).TrimEnd(Path.DirectorySeparatorChar);
    }

    public void EnsureLayout()
    {
        Directory.CreateDirectory(Root);
        foreach (var folder in VaultLayout.AllFolders)
            Directory.CreateDirectory(FullPath(folder));
        Directory.CreateDirectory(FullPath(VaultLayout.RejectedInbox));
    }

    public string FullPath(string relative)
    {
        var rel = VaultLayout.NormalizeRelative(relative);
        var full = Path.GetFullPath(Path.Combine(Root, rel));
        if (!full.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            throw new VaultAccessException($"Fora do vault: {relative}");
        return full;
    }

    public string ToRelative(string fullPath) =>
        Path.GetRelativePath(Root, fullPath).Replace(Path.DirectorySeparatorChar, '/');

    public bool Exists(string relative) => File.Exists(FullPath(relative));

    public async Task<string> ReadRawAsync(string relative, CancellationToken ct = default) =>
        await File.ReadAllTextAsync(FullPath(relative), ct);

    public async Task<NoteDocument> ReadAsync(string relative, CancellationToken ct = default) =>
        NoteDocument.Parse(await ReadRawAsync(relative, ct));

    /// <summary>Todas as notas .md, sem pastas ocultas.</summary>
    public IEnumerable<string> EnumerateNotes(string? folder = null)
    {
        var start = folder is null ? Root : FullPath(folder);
        if (!Directory.Exists(start)) yield break;

        var options = new EnumerationOptions
        {
            RecurseSubdirectories = true,
            AttributesToSkip = FileAttributes.Hidden | FileAttributes.System,
            IgnoreInaccessible = true
        };
        foreach (var file in Directory.EnumerateFiles(start, "*.md", options))
        {
            var rel = ToRelative(file);
            if (rel.Split('/').Any(part => part.StartsWith('.'))) continue;
            yield return rel;
        }
    }

    /// <summary>Cria uma nota nova. Falha se já existir (o hub nunca sobrescreve por engano).</summary>
    public async Task CreateAsync(string relative, NoteDocument doc, string reason, CancellationToken ct = default)
    {
        var rel = VaultLayout.NormalizeRelative(relative);
        if (!VaultLayout.CanCreate(rel))
            throw new VaultAccessException($"O hub não cria notas em {VaultLayout.FolderOf(rel)}.");

        await _writeLock.WaitAsync(ct);
        try
        {
            await WriteAtomicAsync(FullPath(rel), doc.ToString(), overwrite: false, ct);
        }
        finally { _writeLock.Release(); }
        OnWritten(rel, reason);
    }

    /// <summary>Regrava uma nota que pertence ao hub (Inbox ou _sistema/ai).</summary>
    public async Task ReplaceAsync(string relative, NoteDocument doc, string reason, CancellationToken ct = default)
    {
        var rel = VaultLayout.NormalizeRelative(relative);
        if (!VaultLayout.CanReplace(rel))
            throw new VaultAccessException($"O hub não edita notas em {VaultLayout.FolderOf(rel)}.");

        await _writeLock.WaitAsync(ct);
        try
        {
            await WriteAtomicAsync(FullPath(rel), doc.ToString(), overwrite: true, ct);
        }
        finally { _writeLock.Release(); }
        OnWritten(rel, reason);
    }

    /// <summary>Anexa texto ao fim de uma nota do diário, criando-a se não existir.</summary>
    public async Task AppendAsync(string relative, string text, Func<NoteDocument> createIfMissing, string reason, CancellationToken ct = default)
    {
        var rel = VaultLayout.NormalizeRelative(relative);
        if (!VaultLayout.CanAppend(rel))
            throw new VaultAccessException($"O hub só anexa texto no diário ({VaultLayout.Daily}).");

        await _writeLock.WaitAsync(ct);
        try
        {
            var full = FullPath(rel);
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            var current = File.Exists(full) ? await File.ReadAllTextAsync(full, ct) : createIfMissing().ToString();
            current = current.Replace("\r\n", "\n");
            if (!current.EndsWith('\n')) current += "\n";
            await WriteAtomicAsync(full, current + text.TrimEnd('\n') + "\n", overwrite: true, ct);
        }
        finally { _writeLock.Release(); }
        OnWritten(rel, reason);
    }

    /// <summary>Move uma nota da Inbox para uma pasta permanente. Devolve o novo caminho.</summary>
    public async Task<string> MoveFromInboxAsync(string relative, string targetFolder, string fileName, string reason, CancellationToken ct = default)
    {
        var rel = VaultLayout.NormalizeRelative(relative);
        var folder = VaultLayout.NormalizeRelative(targetFolder);
        if (!VaultLayout.IsUnder(rel, VaultLayout.Inbox))
            throw new VaultAccessException("Só itens da Inbox podem ser movidos pelo hub.");
        if (!VaultLayout.IsPermanentTarget(folder))
            throw new VaultAccessException($"Destino não permitido: {folder}");

        string dest;
        await _writeLock.WaitAsync(ct);
        try
        {
            Directory.CreateDirectory(FullPath(folder));
            dest = UniquePath(folder, VaultLayout.SafeFileName(fileName));
            File.Move(FullPath(rel), FullPath(dest), overwrite: false);
        }
        finally { _writeLock.Release(); }

        OnWritten(rel, reason);
        OnWritten(dest, reason);
        return dest;
    }

    /// <summary>Salva um anexo recebido em _sistema/anexos. Devolve o caminho relativo.</summary>
    public async Task<string> SaveAttachmentAsync(Stream content, string originalName, DateTimeOffset when, string reason, CancellationToken ct = default)
    {
        var ext = Path.GetExtension(originalName).ToLowerInvariant();
        if (ext.Length > 10 || ext.Any(c => !char.IsLetterOrDigit(c) && c != '.')) ext = ".bin";
        var baseName = $"{when:yyyy-MM-dd-HHmmss}-{VaultLayout.Slug(Path.GetFileNameWithoutExtension(originalName), 30)}";

        string rel;
        await _writeLock.WaitAsync(ct);
        try
        {
            Directory.CreateDirectory(FullPath(VaultLayout.Attachments));
            rel = UniquePath(VaultLayout.Attachments, baseName, ext);
            var full = FullPath(rel);
            var temp = Path.Combine(Path.GetDirectoryName(full)!, TempPrefix + Guid.NewGuid().ToString("N") + ext);
            await using (var fs = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true))
            {
                await content.CopyToAsync(fs, ct);
            }
            File.Move(temp, full, overwrite: false);
        }
        finally { _writeLock.Release(); }

        OnWritten(rel, reason);
        return rel;
    }

    /// <summary>Caminho livre em uma pasta: "Nome.md", "Nome 2.md", ...</summary>
    public string UniquePath(string folder, string baseName, string extension = ".md")
    {
        var candidate = $"{folder}/{baseName}{extension}";
        for (var i = 2; File.Exists(FullPath(candidate)); i++)
            candidate = $"{folder}/{baseName} {i}{extension}";
        return candidate;
    }

    private static async Task WriteAtomicAsync(string fullPath, string content, bool overwrite, CancellationToken ct)
    {
        var dir = Path.GetDirectoryName(fullPath)!;
        Directory.CreateDirectory(dir);
        if (!overwrite && File.Exists(fullPath))
            throw new IOException($"Arquivo já existe: {Path.GetFileName(fullPath)}");

        var temp = Path.Combine(dir, TempPrefix + Guid.NewGuid().ToString("N") + ".md");
        try
        {
            await File.WriteAllTextAsync(temp, content, new UTF8Encoding(false), ct);
            File.Move(temp, fullPath, overwrite);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }

    private void OnWritten(string relative, string reason)
    {
        _log.LogInformation("Vault: {Reason} → {Path}", reason, relative);
        Written?.Invoke(relative, reason);
    }
}
