using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Hub.Core;

/// <summary>Pastas do vault e as regras de quem pode escrever onde.</summary>
public static partial class VaultLayout
{
    public const string Inbox = "00-Inbox";
    public const string Daily = "01-Diario";
    public const string Projects = "10-Projetos";
    public const string Areas = "20-Areas";
    public const string Resources = "30-Recursos";
    public const string People = "40-Pessoas";
    public const string Archive = "90-Arquivo";
    public const string Attachments = "_sistema/anexos";
    public const string Ai = "_sistema/ai";
    public const string Templates = "_sistema/templates";
    public const string RejectedInbox = "90-Arquivo/Inbox rejeitada";
    /// <summary>Notas excluídas pela tela. Dá para restaurar movendo de volta (e o git guarda tudo).</summary>
    public const string Trash = "_sistema/lixeira";
    /// <summary>Resumos trazidos dos apps do hub pela rotina de sincronização (regravados a cada vez).</summary>
    public const string Apps = "_sistema/apps";

    public static readonly string[] AllFolders =
        { Inbox, Daily, Projects, Areas, Resources, People, Archive, Attachments, Ai, Templates, Trash, Apps };

    /// <summary>Destinos possíveis ao aprovar um item da Inbox.</summary>
    public static readonly string[] PermanentFolders = { Projects, Areas, Resources, People, Archive };

    /// <summary>
    /// Normaliza um caminho relativo vindo de fora (MCP, API) e recusa qualquer
    /// tentativa de sair do vault ou tocar em pastas ocultas (.obsidian, .git, .trash).
    /// </summary>
    public static string NormalizeRelative(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            throw new VaultAccessException("Caminho vazio.");

        var p = path.Replace('\\', '/').Trim().Trim('/');
        var parts = p.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0)
            throw new VaultAccessException("Caminho vazio.");

        foreach (var part in parts)
        {
            if (part is "." or ".." || part.StartsWith('.'))
                throw new VaultAccessException($"Caminho não permitido: {path}");
            if (part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                throw new VaultAccessException($"Caractere inválido no caminho: {path}");
        }
        return string.Join('/', parts);
    }

    public static bool IsUnder(string relative, string folder) =>
        relative.Equals(folder, StringComparison.OrdinalIgnoreCase) ||
        relative.StartsWith(folder + "/", StringComparison.OrdinalIgnoreCase);

    public static string FolderOf(string relative)
    {
        var i = relative.LastIndexOf('/');
        return i < 0 ? "" : relative[..i];
    }

    public static bool IsPermanentTarget(string folder)
    {
        var f = NormalizeRelative(folder);
        return PermanentFolders.Any(p => IsUnder(f, p));
    }

    public static bool CanCreate(string relative) =>
        IsUnder(relative, Inbox) || IsUnder(relative, Ai) || IsUnder(relative, Attachments) || IsUnder(relative, Apps);

    public static bool CanReplace(string relative) =>
        IsUnder(relative, Inbox) || IsUnder(relative, Ai) || IsUnder(relative, Apps);

    public static bool CanAppend(string relative) => IsUnder(relative, Daily);

    /// <summary>
    /// O que VOCÊ pode criar e editar pela tela: qualquer nota .md do vault, menos anexos e a lixeira
    /// (de lá só se restaura). Agentes (MCP) continuam presos às regras acima.
    /// </summary>
    public static bool UserCanEdit(string relative) =>
        relative.EndsWith(".md", StringComparison.OrdinalIgnoreCase) &&
        !IsUnder(relative, Attachments) && !IsUnder(relative, Trash);

    /// <summary>Pasta onde você pode criar ou para onde pode mover notas pela tela.</summary>
    public static bool UserCanUseFolder(string folder) =>
        folder.Length == 0 || (!IsUnder(folder, Attachments) && !IsUnder(folder, Trash));

    public static string DailyPath(DateOnly date) =>
        $"{Daily}/{date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}.md";

    /// <summary>Nome de arquivo legível e seguro em qualquer sistema (o Obsidian usa o nome nos [[links]]).</summary>
    public static string SafeFileName(string title, int maxLength = 80)
    {
        var cleaned = InvalidNameChars().Replace(title, " ");
        cleaned = Whitespace().Replace(cleaned, " ").Trim(' ', '.');
        if (cleaned.Length > maxLength) cleaned = cleaned[..maxLength].TrimEnd(' ', '.');
        return cleaned.Length == 0 ? "sem titulo" : cleaned;
    }

    /// <summary>slug-ascii para nomes curtos de anexos e arquivos de captura.</summary>
    public static string Slug(string text, int maxLength = 40)
    {
        var normalized = text.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder();
        foreach (var ch in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
            if (char.IsLetterOrDigit(ch) && ch < 128) sb.Append(char.ToLowerInvariant(ch));
            else if (sb.Length > 0 && sb[^1] != '-') sb.Append('-');
        }
        var slug = sb.ToString().Trim('-');
        if (slug.Length > maxLength) slug = slug[..maxLength].Trim('-');
        return slug.Length == 0 ? "item" : slug;
    }

    /// <summary>"2026-10-13 2110 celular - Título" → "Título" (nome de arquivo de captura).</summary>
    public static string StripCapturePrefix(string fileName) => CapturePrefix().Replace(fileName, "");

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2} \d{4} [a-z0-9-]+ - ")]
    private static partial Regex CapturePrefix();

    [GeneratedRegex(@"[\\/:*?""<>|#^\[\]\x00-\x1F]")]
    private static partial Regex InvalidNameChars();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}

public sealed class VaultAccessException(string message) : Exception(message);
