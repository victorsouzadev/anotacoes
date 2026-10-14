using System.Globalization;
using Hub.Core;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Options;

namespace Hub.Data;

public sealed record CaptureRecord(
    string Id,
    string Source,
    string? ExternalId,
    string Kind,
    string Path,
    string Status,
    int Attempts,
    string? Error,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public static class CaptureStatus
{
    public const string Queued = "queued";          // aguardando processamento
    public const string Processing = "processing";
    public const string Processed = "processed";    // enriquecida, na Inbox esperando aprovação
    public const string Filed = "filed";            // aprovada e movida
    public const string Rejected = "rejected";
    public const string Error = "error";
}

/// <summary>Estado do hub (capturas e fila). O índice de busca fica em outro arquivo, descartável.</summary>
public sealed class HubDb
{
    private readonly string _connectionString;

    public HubDb(IOptions<HubOptions> options)
    {
        var dataPath = Path.GetFullPath(options.Value.DataPath);
        Directory.CreateDirectory(dataPath);
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(dataPath, "hub.db"),
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
            CREATE TABLE IF NOT EXISTS captures(
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                external_id TEXT NULL,
                kind TEXT NOT NULL,
                path TEXT NOT NULL,
                status TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                error TEXT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS ux_captures_source_ext
                ON captures(source, external_id) WHERE external_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS ix_captures_status ON captures(status);
            CREATE INDEX IF NOT EXISTS ix_captures_path ON captures(path);
            """;
        cmd.ExecuteNonQuery();
    }

    /// <summary>Insere; devolve false se (source, external_id) já existe.</summary>
    public bool TryInsert(CaptureRecord r)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            INSERT INTO captures(id, source, external_id, kind, path, status, attempts, error, created_at, updated_at)
            VALUES ($id, $source, $ext, $kind, $path, $status, 0, NULL, $created, $created)
            ON CONFLICT DO NOTHING;
            """;
        cmd.Parameters.AddWithValue("$id", r.Id);
        cmd.Parameters.AddWithValue("$source", r.Source);
        cmd.Parameters.AddWithValue("$ext", (object?)r.ExternalId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$kind", r.Kind);
        cmd.Parameters.AddWithValue("$path", r.Path);
        cmd.Parameters.AddWithValue("$status", r.Status);
        cmd.Parameters.AddWithValue("$created", r.CreatedAt.ToString("O"));
        return cmd.ExecuteNonQuery() == 1;
    }

    public CaptureRecord? Get(string id) =>
        Query("SELECT * FROM captures WHERE id = $v", ("$v", id)).FirstOrDefault();

    public CaptureRecord? FindByExternal(string source, string externalId) =>
        Query("SELECT * FROM captures WHERE source = $s AND external_id = $e", ("$s", source), ("$e", externalId)).FirstOrDefault();

    public CaptureRecord? FindByPath(string path) =>
        Query("SELECT * FROM captures WHERE path = $v ORDER BY created_at DESC LIMIT 1", ("$v", path)).FirstOrDefault();

    public IReadOnlyList<CaptureRecord> ListByStatus(params string[] statuses)
    {
        var names = statuses.Select((_, i) => $"$s{i}").ToArray();
        var args = statuses.Select((s, i) => ($"$s{i}", (object)s)).ToArray();
        return Query($"SELECT * FROM captures WHERE status IN ({string.Join(',', names)}) ORDER BY created_at", args);
    }

    public int CountByStatus(params string[] statuses) => ListByStatus(statuses).Count;

    public void Update(string id, string? status = null, string? path = null, string? error = null, bool incrementAttempts = false, bool clearError = false)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            UPDATE captures SET
                status = COALESCE($status, status),
                path = COALESCE($path, path),
                error = CASE WHEN $clear = 1 THEN NULL ELSE COALESCE($error, error) END,
                attempts = attempts + $inc,
                updated_at = $now
            WHERE id = $id;
            """;
        cmd.Parameters.AddWithValue("$status", (object?)status ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$path", (object?)path ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$error", (object?)error ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$clear", clearError ? 1 : 0);
        cmd.Parameters.AddWithValue("$inc", incrementAttempts ? 1 : 0);
        cmd.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    private IReadOnlyList<CaptureRecord> Query(string sql, params (string Name, object Value)[] args)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args) cmd.Parameters.AddWithValue(name, value);

        var list = new List<CaptureRecord>();
        using var r = cmd.ExecuteReader();
        while (r.Read())
        {
            list.Add(new CaptureRecord(
                r.GetString(r.GetOrdinal("id")),
                r.GetString(r.GetOrdinal("source")),
                r.IsDBNull(r.GetOrdinal("external_id")) ? null : r.GetString(r.GetOrdinal("external_id")),
                r.GetString(r.GetOrdinal("kind")),
                r.GetString(r.GetOrdinal("path")),
                r.GetString(r.GetOrdinal("status")),
                r.GetInt32(r.GetOrdinal("attempts")),
                r.IsDBNull(r.GetOrdinal("error")) ? null : r.GetString(r.GetOrdinal("error")),
                DateTimeOffset.Parse(r.GetString(r.GetOrdinal("created_at")), CultureInfo.InvariantCulture),
                DateTimeOffset.Parse(r.GetString(r.GetOrdinal("updated_at")), CultureInfo.InvariantCulture)));
        }
        return list;
    }
}
