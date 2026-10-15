using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Hub.Core;
using Hub.Vault;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Options;

namespace Hub.Index;

public sealed record SearchHit(string Path, string Title, string Snippet, string? Trust, double Rank);

public sealed record NoteSummary(string Path, string Title, string Folder, IReadOnlyList<string> Tags, string? Status, DateTimeOffset Modified);

/// <summary>
/// Índice de busca em SQLite (FTS5 + metadados + grafo de links).
/// É derivado do vault: pode ser apagado e reconstruído a qualquer momento.
/// </summary>
public sealed class NoteIndex
{
    private readonly VaultStore _vault;
    private readonly ILogger<NoteIndex> _log;
    private readonly string _connectionString;
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    public NoteIndex(IOptions<HubOptions> options, VaultStore vault, ILogger<NoteIndex> log)
    {
        _vault = vault;
        _log = log;
        var dataPath = Path.GetFullPath(options.Value.DataPath);
        Directory.CreateDirectory(dataPath);
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(dataPath, "index.db"),
            DefaultTimeout = 30
        }.ToString();
        Initialize();
    }

    private SqliteConnection Open()
    {
        var c = new SqliteConnection(_connectionString);
        c.Open();
        return c;
    }

    private void Initialize()
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS notes(
                path TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                folder TEXT NOT NULL,
                tags TEXT NOT NULL,
                trust TEXT NULL,
                status TEXT NULL,
                modified TEXT NOT NULL,
                hash TEXT NOT NULL
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                path UNINDEXED, title, tags, body,
                tokenize = 'unicode61 remove_diacritics 2'
            );
            CREATE TABLE IF NOT EXISTS links(src TEXT NOT NULL, dst TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS ix_links_src ON links(src);
            CREATE INDEX IF NOT EXISTS ix_links_dst ON links(dst);
            """;
        cmd.ExecuteNonQuery();
    }

    public int Count()
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM notes";
        return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    /// <summary>Reindexa tudo e remove do índice o que não existe mais no disco.</summary>
    public async Task FullScanAsync(CancellationToken ct = default)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var rel in _vault.EnumerateNotes())
        {
            ct.ThrowIfCancellationRequested();
            seen.Add(rel);
            await UpsertAsync(rel, ct);
        }

        var stale = new List<string>();
        using (var c = Open())
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT path FROM notes";
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                var p = r.GetString(0);
                if (!seen.Contains(p)) stale.Add(p);
            }
        }
        foreach (var p in stale) await RemoveAsync(p, ct);

        _log.LogInformation("Índice: varredura completa, {Count} notas.", seen.Count);
    }

    public async Task UpsertAsync(string relative, CancellationToken ct = default)
    {
        string text;
        DateTime modified;
        try
        {
            var full = _vault.FullPath(relative);
            if (!File.Exists(full)) { await RemoveAsync(relative, ct); return; }
            text = await File.ReadAllTextAsync(full, ct);
            modified = File.GetLastWriteTimeUtc(full);
        }
        catch (IOException ex)
        {
            _log.LogDebug(ex, "Arquivo ocupado, reindexo depois: {Path}", relative);
            return;
        }

        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
        var doc = NoteDocument.Parse(text);
        var title = doc.ResolveTitle(relative);
        var tags = doc.ResolveTags();
        var links = doc.ResolveLinks();

        await _writeLock.WaitAsync(ct);
        try
        {
            using var c = Open();

            using (var check = c.CreateCommand())
            {
                check.CommandText = "SELECT hash FROM notes WHERE path = $p";
                check.Parameters.AddWithValue("$p", relative);
                if (check.ExecuteScalar() is string existing && existing == hash) return;
            }

            using var tx = c.BeginTransaction();
            Exec(c, tx, "DELETE FROM notes WHERE path = $p", ("$p", relative));
            Exec(c, tx, "DELETE FROM notes_fts WHERE path = $p", ("$p", relative));
            Exec(c, tx, "DELETE FROM links WHERE src = $p", ("$p", relative));

            Exec(c, tx, """
                INSERT INTO notes(path, title, folder, tags, trust, status, modified, hash)
                VALUES ($p, $title, $folder, $tags, $trust, $status, $modified, $hash)
                """,
                ("$p", relative), ("$title", title), ("$folder", VaultLayout.FolderOf(relative)),
                ("$tags", string.Join(',', tags)),
                ("$trust", (object?)doc.FrontMatter.GetString("trust") ?? DBNull.Value),
                ("$status", (object?)doc.FrontMatter.GetString("status") ?? DBNull.Value),
                ("$modified", new DateTimeOffset(modified, TimeSpan.Zero).ToString("O")),
                ("$hash", hash));

            Exec(c, tx, "INSERT INTO notes_fts(path, title, tags, body) VALUES ($p, $title, $tags, $body)",
                ("$p", relative), ("$title", title), ("$tags", string.Join(' ', tags)), ("$body", doc.Body));

            foreach (var link in links)
                Exec(c, tx, "INSERT INTO links(src, dst) VALUES ($p, $d)", ("$p", relative), ("$d", NormalizeLinkTarget(link)));

            tx.Commit();
        }
        finally { _writeLock.Release(); }
    }

    public async Task RemoveAsync(string relative, CancellationToken ct = default)
    {
        await _writeLock.WaitAsync(ct);
        try
        {
            using var c = Open();
            using var tx = c.BeginTransaction();
            Exec(c, tx, "DELETE FROM notes WHERE path = $p", ("$p", relative));
            Exec(c, tx, "DELETE FROM notes_fts WHERE path = $p", ("$p", relative));
            Exec(c, tx, "DELETE FROM links WHERE src = $p", ("$p", relative));
            tx.Commit();
        }
        finally { _writeLock.Release(); }
    }

    /// <summary>Busca full-text. Cada palavra vira um termo com prefixo; todas precisam aparecer.</summary>
    public IReadOnlyList<SearchHit> Search(string query, string? folder = null, int limit = 10)
    {
        var match = BuildMatchExpression(query);
        if (match is null) return Array.Empty<SearchHit>();

        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            SELECT f.path, n.title, snippet(notes_fts, 3, '**', '**', ' … ', 24), n.trust, bm25(notes_fts, 0.0, 8.0, 4.0, 1.0) AS rank
            FROM notes_fts f
            JOIN notes n ON n.path = f.path
            WHERE notes_fts MATCH $q
              AND ($folder IS NULL OR n.path = $folder OR n.path LIKE $folderPrefix ESCAPE '\')
            ORDER BY rank
            LIMIT $limit
            """;
        cmd.Parameters.AddWithValue("$q", match);
        cmd.Parameters.AddWithValue("$folder", (object?)folder ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$folderPrefix", folder is null ? DBNull.Value : (object)(EscapeLike(folder) + "/%"));
        cmd.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 50));

        var hits = new List<SearchHit>();
        using var r = cmd.ExecuteReader();
        while (r.Read())
            hits.Add(new SearchHit(r.GetString(0), r.GetString(1), r.IsDBNull(2) ? "" : r.GetString(2),
                r.IsDBNull(3) ? null : r.GetString(3), r.GetDouble(4)));
        return hits;
    }

    public IReadOnlyList<NoteSummary> List(string? folder = null, DateTimeOffset? modifiedSince = null, int limit = 50)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            SELECT path, title, folder, tags, status, modified FROM notes
            WHERE ($folder IS NULL OR path LIKE $folderPrefix ESCAPE '\')
              AND ($since IS NULL OR modified >= $since)
            ORDER BY modified DESC
            LIMIT $limit
            """;
        cmd.Parameters.AddWithValue("$folder", (object?)folder ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$folderPrefix", folder is null ? DBNull.Value : (object)(EscapeLike(folder) + "/%"));
        cmd.Parameters.AddWithValue("$since", modifiedSince is null ? DBNull.Value : (object)modifiedSince.Value.ToUniversalTime().ToString("O"));
        cmd.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 500));

        var list = new List<NoteSummary>();
        using var r = cmd.ExecuteReader();
        while (r.Read())
            list.Add(new NoteSummary(
                r.GetString(0), r.GetString(1), r.GetString(2),
                r.GetString(3).Split(',', StringSplitOptions.RemoveEmptyEntries),
                r.IsDBNull(4) ? null : r.GetString(4),
                DateTimeOffset.Parse(r.GetString(5), CultureInfo.InvariantCulture)));
        return list;
    }

    /// <summary>Quantas notas há em cada pasta de primeiro nível (ex.: "10-Projetos" → 12). Raiz = "".</summary>
    public IReadOnlyDictionary<string, int> TopFolderCounts()
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT folder, COUNT(*) FROM notes GROUP BY folder";
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        using var r = cmd.ExecuteReader();
        while (r.Read())
        {
            var folder = r.GetString(0);
            var top = folder.Split('/')[0];
            counts[top] = counts.GetValueOrDefault(top) + r.GetInt32(1);
        }
        return counts;
    }

    /// <summary>
    /// Caminho da nota que um [[wikilink]] aponta: caminho exato ou nome de arquivo (como o Obsidian
    /// resolve). Null se não existir.
    /// </summary>
    public string? ResolveLink(string target)
    {
        var t = target.Split('|')[0].Split('#')[0].Trim();
        if (t.Length == 0) return null;
        var withExt = t.EndsWith(".md", StringComparison.OrdinalIgnoreCase) ? t : t + ".md";
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            SELECT path FROM notes
            WHERE lower(path) = lower($p) OR lower(path) LIKE lower($suffix) ESCAPE '\' OR lower(title) = lower($t)
            ORDER BY (lower(path) = lower($p)) DESC, length(path)
            LIMIT 1
            """;
        cmd.Parameters.AddWithValue("$p", withExt);
        cmd.Parameters.AddWithValue("$suffix", "%/" + EscapeLike(withExt));
        cmd.Parameters.AddWithValue("$t", t);
        return cmd.ExecuteScalar() as string;
    }

    /// <summary>Notas que apontam para esta (por nome de arquivo ou caminho).</summary>
    public IReadOnlyList<string> Backlinks(string relative)
    {
        var name = NormalizeLinkTarget(Path.GetFileNameWithoutExtension(relative));
        var pathNoExt = NormalizeLinkTarget(relative[..^Path.GetExtension(relative).Length]);

        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT DISTINCT src FROM links WHERE dst = $a OR dst = $b ORDER BY src LIMIT 100";
        cmd.Parameters.AddWithValue("$a", name);
        cmd.Parameters.AddWithValue("$b", pathNoExt);

        var list = new List<string>();
        using var r = cmd.ExecuteReader();
        while (r.Read()) list.Add(r.GetString(0));
        return list;
    }

    /// <summary>Títulos e caminhos de notas permanentes, para o LLM sugerir links reais.</summary>
    public IReadOnlyList<SearchHit> Candidates(string text, int limit = 8)
    {
        // Usa as palavras mais longas do texto como consulta OR.
        var words = text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
            .Select(w => new string(w.Where(char.IsLetterOrDigit).ToArray()))
            .Where(w => w.Length >= 5)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderByDescending(w => w.Length)
            .Take(12)
            .ToList();
        if (words.Count == 0) return Array.Empty<SearchHit>();

        var match = string.Join(" OR ", words.Select(w => $"\"{w}\""));
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            SELECT f.path, n.title, '', n.trust, bm25(notes_fts, 0.0, 8.0, 4.0, 1.0) AS rank
            FROM notes_fts f JOIN notes n ON n.path = f.path
            WHERE notes_fts MATCH $q
              AND n.folder NOT LIKE '00-Inbox%' AND n.folder NOT LIKE '01-Diario%'
              AND n.folder NOT LIKE '\_sistema%' ESCAPE '\'
            ORDER BY rank LIMIT $limit
            """;
        cmd.Parameters.AddWithValue("$q", match);
        cmd.Parameters.AddWithValue("$limit", limit);

        var hits = new List<SearchHit>();
        using var r = cmd.ExecuteReader();
        while (r.Read()) hits.Add(new SearchHit(r.GetString(0), r.GetString(1), "", null, r.GetDouble(4)));
        return hits;
    }

    internal static string? BuildMatchExpression(string query)
    {
        var terms = query
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
            .Select(t => new string(t.Where(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_').ToArray()).Trim('-', '_'))
            .Where(t => t.Length > 0)
            .Take(16)
            .ToList();
        return terms.Count == 0 ? null : string.Join(' ', terms.Select(t => $"\"{t}\"*"));
    }

    internal static string NormalizeLinkTarget(string target)
    {
        var t = target.Trim().Replace('\\', '/');
        if (t.EndsWith(".md", StringComparison.OrdinalIgnoreCase)) t = t[..^3];
        return t.ToLowerInvariant();
    }

    private static string EscapeLike(string value) =>
        value.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    private static void Exec(SqliteConnection c, SqliteTransaction tx, string sql, params (string Name, object Value)[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        foreach (var (name, value) in args) cmd.Parameters.AddWithValue(name, value);
        cmd.ExecuteNonQuery();
    }
}
