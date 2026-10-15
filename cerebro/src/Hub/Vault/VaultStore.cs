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

    // ------------------------------------------------------------------ edição pela tela (você)

    /// <summary>Versão do conteúdo (SHA-256 do arquivo): detecta se a nota mudou desde que foi aberta.</summary>
    public string Version(string relative) =>
        Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(FullPath(relative))));

    /// <summary>
    /// Regrava uma nota com o texto completo vindo do editor da tela. Recusa se ela mudou desde que foi
    /// aberta (ex.: o Obsidian sincronizou no meio), para não apagar a edição de ninguém.
    /// </summary>
    public async Task<string> UserSaveAsync(string relative, string content, string expectedVersion, string by = "pela tela", CancellationToken ct = default)
    {
        var rel = VaultLayout.NormalizeRelative(relative);
        if (!VaultLayout.UserCanEdit(rel)) throw new VaultAccessException($"Esta nota não pode ser editada pela tela: {rel}");
        await _writeLock.WaitAsync(ct);
        try
        {
            if (!File.Exists(FullPath(rel))) throw new FileNotFoundException($"Nota não encontrada: {rel}");
            var current = Version(rel);
            if (!string.Equals(current, expectedVersion, StringComparison.OrdinalIgnoreCase))
                throw new NoteConflictException(rel, current);
            await WriteAtomicAsync(FullPath(rel), content.Replace("\r\n", "\n"), overwrite: true, ct);
        }
        finally { _writeLock.Release(); }
        OnWritten(rel, $"editada {by}");
        return Version(rel);
    }

    /// <summary>Cria uma nota nova numa pasta, com nome a partir do título. Devolve o caminho.</summary>
    public async Task<string> UserCreateAsync(string folder, string title, string? body, string by = "pela tela", CancellationToken ct = default)
    {
        var dir = folder.Trim().Trim('/').Length == 0 ? "" : VaultLayout.NormalizeRelative(folder);
        if (!VaultLayout.UserCanUseFolder(dir)) throw new VaultAccessException($"Não dá para criar notas em {dir}.");
        var name = VaultLayout.SafeFileName(title);
        var text = (body ?? "").Replace("\r\n", "\n").Trim();
        if (!text.StartsWith("# ", StringComparison.Ordinal)) text = $"# {title.Trim()}\n\n{text}";
        string rel;
        await _writeLock.WaitAsync(ct);
        try
        {
            rel = dir.Length == 0 ? UniquePath(".", name).TrimStart('.', '/') : UniquePath(dir, name);
            await WriteAtomicAsync(FullPath(rel), text.TrimEnd() + "\n", overwrite: false, ct);
        }
        finally { _writeLock.Release(); }
        OnWritten(rel, $"criada {by}");
        return rel;
    }

    /// <summary>Move e/ou renomeia uma nota (também restaura da lixeira). Devolve o caminho novo.</summary>
    public async Task<string> UserMoveAsync(string relative, string targetFolder, string? newName, string by = "pela tela", CancellationToken ct = default)
    {
        var rel = VaultLayout.NormalizeRelative(relative);
        if (!rel.EndsWith(".md", StringComparison.OrdinalIgnoreCase) || VaultLayout.IsUnder(rel, VaultLayout.Attachments))
            throw new VaultAccessException($"Esta nota não pode ser movida pela tela: {rel}");
        var dir = targetFolder.Trim().Trim('/').Length == 0 ? "" : VaultLayout.NormalizeRelative(targetFolder);
        if (!VaultLayout.UserCanUseFolder(dir)) throw new VaultAccessException($"Destino não permitido: {dir}");
        var name = VaultLayout.SafeFileName(string.IsNullOrWhiteSpace(newName) ? Path.GetFileNameWithoutExtension(rel) : newName);

        string dest;
        await _writeLock.WaitAsync(ct);
        try
        {
            if (!File.Exists(FullPath(rel))) throw new FileNotFoundException($"Nota não encontrada: {rel}");
            var same = (dir.Length == 0 ? name + ".md" : $"{dir}/{name}.md");
            if (same == rel) return rel;
            dest = dir.Length == 0 ? UniquePath(".", name).TrimStart('.', '/') : UniquePath(dir, name);
            Directory.CreateDirectory(Path.GetDirectoryName(FullPath(dest))!);
            File.Move(FullPath(rel), FullPath(dest), overwrite: false);
        }
        finally { _writeLock.Release(); }
        OnWritten(rel, $"movida {by}");
        OnWritten(dest, $"movida {by}");
        return dest;
    }

    /// <summary>Exclui pela tela: a nota vai para a lixeira (_sistema/lixeira). Devolve o caminho lá.</summary>
    public async Task<string> UserTrashAsync(string relative, string by = "pela tela", CancellationToken ct = default)
    {
        var rel = VaultLayout.NormalizeRelative(relative);
        if (!VaultLayout.UserCanEdit(rel)) throw new VaultAccessException($"Esta nota não pode ser excluída pela tela: {rel}");
        string dest;
        await _writeLock.WaitAsync(ct);
        try
        {
            if (!File.Exists(FullPath(rel))) throw new FileNotFoundException($"Nota não encontrada: {rel}");
            Directory.CreateDirectory(FullPath(VaultLayout.Trash));
            dest = UniquePath(VaultLayout.Trash, Path.GetFileNameWithoutExtension(rel));
            File.Move(FullPath(rel), FullPath(dest), overwrite: false);
        }
        finally { _writeLock.Release(); }
        OnWritten(rel, $"excluída {by}");
        OnWritten(dest, $"excluída {by}");
        return dest;
    }

    /// <summary>
    /// Grava o conteúdo de uma versão antiga (restauração). Cria a nota se ela não existir mais.
    /// Não passa pela checagem de versão: restaurar é sobrescrever de propósito (o git guarda o atual).
    /// </summary>
    public async Task UserRestoreAsync(string relative, string content, string reason, CancellationToken ct = default)
    {
        var rel = VaultLayout.NormalizeRelative(relative);
        if (VaultLayout.IsUnder(rel, VaultLayout.Attachments) && rel.EndsWith(".md", StringComparison.OrdinalIgnoreCase))
            throw new VaultAccessException($"Não dá para restaurar em {rel}.");
        await _writeLock.WaitAsync(ct);
        try { await WriteAtomicAsync(FullPath(rel), content, overwrite: true, ct); }
        finally { _writeLock.Release(); }
        OnWritten(rel, reason);
    }

    /// <summary>Pastas do vault (sem ocultas, anexos e lixeira), para criar e mover pela tela.</summary>
    public IReadOnlyList<string> UserFolders()
    {
        var options = new EnumerationOptions { RecurseSubdirectories = true, AttributesToSkip = FileAttributes.Hidden | FileAttributes.System, IgnoreInaccessible = true };
        return Directory.EnumerateDirectories(Root, "*", options)
            .Select(ToRelative)
            .Where(r => !r.Split('/').Any(p => p.StartsWith('.')) && VaultLayout.UserCanUseFolder(r) && r != "_sistema")
            .Order(StringComparer.Ordinal)
            .ToList();
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

/// <summary>A nota mudou desde que foi aberta no editor (409 na API).</summary>
public sealed class NoteConflictException(string path, string currentVersion)
    : Exception($"A nota {path} mudou desde que você abriu (talvez pelo Obsidian). Recarregue antes de salvar.")
{
    public string Path { get; } = path;
    public string CurrentVersion { get; } = currentVersion;
}
