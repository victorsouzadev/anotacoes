using System.Globalization;
using Hub.Core;
using Hub.Vault;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Options;

namespace Hub.Index;

public sealed record TrechoAchado(string Path, double Score, string Texto);

/// <summary>
/// Vetores dos trechos de cada nota (spec 027), num SQLite à parte (vectors.db): derivado do vault e
/// recriável. Atualiza só as notas cujo hash mudou (ou cujo modelo mudou). A busca é por força bruta
/// em memória — com alguns milhares de trechos cabe folgado e dispensa extensão nativa.
/// </summary>
public sealed class VectorIndex
{
    private readonly string _connectionString;
    private readonly NoteIndex _index;
    private readonly VaultStore _vault;
    private readonly Embeddings _embeddings;
    private readonly ILogger<VectorIndex> _log;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private List<(string Path, string Texto, float[] Vetor)>? _cache;

    public VectorIndex(IOptions<HubOptions> options, NoteIndex index, VaultStore vault, Embeddings embeddings, ILogger<VectorIndex> log)
    {
        _index = index;
        _vault = vault;
        _embeddings = embeddings;
        _log = log;
        var dataPath = Path.GetFullPath(options.Value.DataPath);
        Directory.CreateDirectory(dataPath);
        _connectionString = new SqliteConnectionStringBuilder { DataSource = Path.Combine(dataPath, "vectors.db"), DefaultTimeout = 30 }.ToString();
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS notas(path TEXT PRIMARY KEY, hash TEXT NOT NULL, model TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS trechos(path TEXT NOT NULL, idx INTEGER NOT NULL, texto TEXT NOT NULL, vec BLOB NOT NULL, PRIMARY KEY(path, idx));
            """;
        cmd.ExecuteNonQuery();
    }

    private SqliteConnection Open()
    {
        var c = new SqliteConnection(_connectionString);
        c.Open();
        return c;
    }

    /// <summary>Notas com vetores do conteúdo atual / total de notas.</summary>
    public (int Feitas, int Total) Progresso()
    {
        var hashes = _index.Hashes();
        var modelo = _embeddings.Resolve().Model;
        var feitas = 0;
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT path, hash, model FROM notas";
        using var r = cmd.ExecuteReader();
        while (r.Read())
            if (hashes.TryGetValue(r.GetString(0), out var h) && h == r.GetString(1) && r.GetString(2) == modelo) feitas++;
        return (feitas, hashes.Count);
    }

    /// <summary>Calcula os vetores do que mudou e tira o que saiu do vault. Devolve quantas notas processou.</summary>
    public async Task<int> SincronizarAsync(CancellationToken ct, int maxNotas = 200)
    {
        if (!_embeddings.Ativo) return 0;
        await _lock.WaitAsync(ct);
        try
        {
            var hashes = _index.Hashes();
            var modelo = _embeddings.Resolve().Model;
            var existentes = new Dictionary<string, (string Hash, string Model)>(StringComparer.Ordinal);
            using (var c = Open())
            using (var cmd = c.CreateCommand())
            {
                cmd.CommandText = "SELECT path, hash, model FROM notas";
                using var r = cmd.ExecuteReader();
                while (r.Read()) existentes[r.GetString(0)] = (r.GetString(1), r.GetString(2));
            }

            foreach (var velho in existentes.Keys.Where(p => !hashes.ContainsKey(p)).ToList()) Remover(velho);

            var pendentes = hashes.Where(h => !existentes.TryGetValue(h.Key, out var e) || e.Hash != h.Value || e.Model != modelo)
                .Select(h => h.Key).Take(maxNotas).ToList();
            var feitas = 0;
            foreach (var path in pendentes)
            {
                ct.ThrowIfCancellationRequested();
                if (!_vault.Exists(path)) continue;
                var doc = await _vault.ReadAsync(path, ct);
                var trechos = HybridRanker.Trechos(doc.ResolveTitle(path), doc.Body);
                var vetores = new List<float[]>();
                for (var i = 0; i < trechos.Count; i += 64)
                    vetores.AddRange(await _embeddings.EmbedAsync(trechos.Skip(i).Take(64).ToList(), ct));
                Gravar(path, hashes[path], modelo, trechos, vetores);
                feitas++;
            }
            if (feitas > 0 || existentes.Count != hashes.Count) _cache = null;
            if (feitas > 0) _log.LogInformation("Busca semântica: vetores de {Notas} nota(s) atualizados.", feitas);
            return feitas;
        }
        finally { _lock.Release(); }
    }

    private void Gravar(string path, string hash, string modelo, IReadOnlyList<string> trechos, IReadOnlyList<float[]> vetores)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        Exec(c, tx, "DELETE FROM trechos WHERE path = $p", ("$p", path));
        for (var i = 0; i < trechos.Count; i++)
            Exec(c, tx, "INSERT INTO trechos(path, idx, texto, vec) VALUES ($p, $i, $t, $v)",
                ("$p", path), ("$i", i), ("$t", trechos[i]), ("$v", ParaBytes(vetores[i])));
        Exec(c, tx, "INSERT OR REPLACE INTO notas(path, hash, model) VALUES ($p, $h, $m)", ("$p", path), ("$h", hash), ("$m", modelo));
        tx.Commit();
        _cache = null;
    }

    private void Remover(string path)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        Exec(c, tx, "DELETE FROM trechos WHERE path = $p", ("$p", path));
        Exec(c, tx, "DELETE FROM notas WHERE path = $p", ("$p", path));
        tx.Commit();
        _cache = null;
    }

    /// <summary>Melhor trecho de cada nota, das mais parecidas para as menos.</summary>
    public IReadOnlyList<TrechoAchado> Buscar(float[] consulta, int limite, Func<string, bool>? filtro = null)
    {
        var cache = _cache ??= Carregar();
        var melhor = new Dictionary<string, TrechoAchado>(StringComparer.Ordinal);
        foreach (var (path, texto, vetor) in cache)
        {
            if (filtro is not null && !filtro(path)) continue;
            var s = HybridRanker.Cosseno(consulta, vetor);
            if (!melhor.TryGetValue(path, out var atual) || s > atual.Score) melhor[path] = new(path, s, texto);
        }
        return melhor.Values.OrderByDescending(t => t.Score).Take(limite).ToList();
    }

    private List<(string, string, float[])> Carregar()
    {
        var lista = new List<(string, string, float[])>();
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT path, texto, vec FROM trechos";
        using var r = cmd.ExecuteReader();
        while (r.Read()) lista.Add((r.GetString(0), r.GetString(1), DeBytes((byte[])r["vec"])));
        return lista;
    }

    public static byte[] ParaBytes(float[] v)
    {
        var b = new byte[v.Length * 4];
        Buffer.BlockCopy(v, 0, b, 0, b.Length);
        return b;
    }

    public static float[] DeBytes(byte[] b)
    {
        var v = new float[b.Length / 4];
        Buffer.BlockCopy(b, 0, v, 0, b.Length);
        return v;
    }

    /// <summary>Caracteres do vault inteiro, para estimar o custo da indexação inicial.</summary>
    public long CaracteresDoVault()
    {
        long total = 0;
        foreach (var rel in _vault.EnumerateNotes())
        {
            try { total += new FileInfo(_vault.FullPath(rel)).Length; } catch (IOException) { }
        }
        return total;
    }

    private static void Exec(SqliteConnection c, SqliteTransaction tx, string sql, params (string Name, object Value)[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        foreach (var (name, value) in args) cmd.Parameters.AddWithValue(name, value);
        cmd.ExecuteNonQuery();
    }
}

/// <summary>Mantém os vetores em dia: ao subir, quando a opção é ligada e a cada 2 minutos.</summary>
public sealed class VectorIndexWorker(VectorIndex vetores, Embeddings embeddings, ILogger<VectorIndexWorker> log) : BackgroundService
{
    private readonly SemaphoreSlim _acordar = new(0);

    public void Acordar() => _acordar.Release();

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (embeddings.Ativo)
                    while (await vetores.SincronizarAsync(stoppingToken) > 0) { }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception e) { log.LogWarning(e, "Busca semântica: falha ao atualizar os vetores; tento de novo depois."); }
            try { await _acordar.WaitAsync(TimeSpan.FromMinutes(2), stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }
}

/// <summary>
/// Busca do Cérebro (tela, MCP e sugestões de links): palavras (FTS5) e, com a busca semântica ligada,
/// significado (vetores), combinados por RRF. Qualquer falha nos vetores cai para só palavras.
/// </summary>
public sealed class HybridSearch(NoteIndex index, VectorIndex vetores, Embeddings embeddings, ILogger<HybridSearch> log)
{
    public static readonly string[] Modos = ["auto", "palavras", "significado"];

    public async Task<IReadOnlyList<SearchHit>> SearchAsync(string query, string? folder, int limit, string? modo, CancellationToken ct)
    {
        limit = Math.Clamp(limit, 1, 50);
        modo = Modos.Contains(modo) ? modo : "auto";
        var palavras = index.Search(query, folder, 50);
        if (modo == "palavras" || !embeddings.Ativo) return palavras.Take(limit).ToList();

        IReadOnlyList<TrechoAchado> sentido;
        try
        {
            var q = (await embeddings.EmbedAsync([query], ct))[0];
            sentido = vetores.Buscar(q, 50, folder is null ? null : p => p == folder || p.StartsWith(folder + "/", StringComparison.Ordinal));
        }
        catch (Exception e) when (e is InvalidOperationException or HttpRequestException or TaskCanceledException)
        {
            log.LogWarning(e, "Busca semântica indisponível; usando só palavras.");
            return palavras.Take(limit).ToList();
        }
        return Juntar(palavras, sentido, modo == "significado" ? [Ids(sentido)] : [Ids(palavras), Ids(sentido)], limit);
    }

    /// <summary>Notas permanentes parecidas com o texto, para o classificador sugerir links.</summary>
    public async Task<IReadOnlyList<SearchHit>> CandidatesAsync(string texto, CancellationToken ct, int limit = 8)
    {
        var palavras = index.Candidates(texto, limit * 2);
        if (!embeddings.Ativo) return palavras.Take(limit).ToList();
        try
        {
            var q = (await embeddings.EmbedAsync([texto.Length > 2000 ? texto[..2000] : texto], ct))[0];
            var sentido = vetores.Buscar(q, limit * 2, p => !NoteIndex.ForaDasSugestoes(p));
            return Juntar(palavras, sentido, [Ids(palavras), Ids(sentido)], limit);
        }
        catch (Exception e) when (e is InvalidOperationException or HttpRequestException or TaskCanceledException)
        {
            return palavras.Take(limit).ToList();
        }
    }

    private static IReadOnlyList<string> Ids(IEnumerable<SearchHit> h) => h.Select(x => x.Path).ToList();
    private static IReadOnlyList<string> Ids(IEnumerable<TrechoAchado> h) => h.Select(x => x.Path).ToList();

    private IReadOnlyList<SearchHit> Juntar(IReadOnlyList<SearchHit> palavras, IReadOnlyList<TrechoAchado> sentido,
        IEnumerable<IReadOnlyList<string>> listas, int limit)
    {
        var porPalavra = palavras.ToDictionary(h => h.Path, StringComparer.Ordinal);
        var porSentido = sentido.ToDictionary(h => h.Path, StringComparer.Ordinal);
        return HybridRanker.Rrf(listas).Take(limit).Select(r =>
        {
            if (porPalavra.TryGetValue(r.Id, out var h)) return h with { Rank = -r.Score };
            var t = porSentido[r.Id];
            var corpo = t.Texto.Contains("\n\n") ? t.Texto[(t.Texto.IndexOf("\n\n", StringComparison.Ordinal) + 2)..] : t.Texto;
            var trecho = corpo.Length > 200 ? corpo[..200].TrimEnd() + " …" : corpo;
            return new SearchHit(r.Id, index.Title(r.Id) ?? Path.GetFileNameWithoutExtension(r.Id), trecho, null, -r.Score);
        }).ToList();
    }

    public object Estado()
    {
        var cfg = embeddings.Resolve();
        var (feitas, total) = vetores.Progresso();
        var caracteres = vetores.CaracteresDoVault();
        var tokens = caracteres / 4;
        return new
        {
            ligado = embeddings.Ligado,
            disponivel = cfg.Enabled,
            origem_chave = cfg.KeySource,
            modelo = cfg.Model,
            progresso = new { feitas, total },
            estimativa = new
            {
                tokens,
                custo_usd = Math.Round(tokens / 1_000_000.0 * Embeddings.PrecoPorMilhaoUsd, 4).ToString("0.####", CultureInfo.InvariantCulture),
            },
        };
    }
}
