using System.Globalization;
using Microsoft.Data.Sqlite;
using Npgsql;

namespace CopiaParaPostgres;

public sealed record TabelaCopiada(string Tabela, string Schema, long Linhas);
public sealed record Resultado(IReadOnlyList<TabelaCopiada> Tabelas);

/// <summary>
/// Spec 038: copia cada tabela do SQLite para a tabela de mesmo nome no Postgres, no schema que a tem (o do dono, criado
/// pelo próprio núcleo ou plug-in). Tudo numa transação: um erro ou uma contagem diferente desfaz a cópia inteira. Os
/// tipos seguem a coluna de destino. Os históricos de migração ficam de fora.
/// </summary>
public static class Copia
{
    private static readonly string[] Ignoradas = ["sqlite_", "__EFMigrationsHistory", "__EFMigrationsLock"];

    public static Resultado Executar(string arquivoSqlite, string pg, bool limpar, TextWriter log)
    {
        using var origem = new SqliteConnection(new SqliteConnectionStringBuilder
        { DataSource = arquivoSqlite, Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString());
        origem.Open();
        using var destino = new NpgsqlConnection(pg);
        destino.Open();

        var tabelas = TabelasDaOrigem(origem);
        var donos = SchemasDoDestino(destino);
        var semDono = tabelas.Where(t => !donos.ContainsKey(t)).ToList();
        if (semDono.Count > 0)
            throw new InvalidOperationException($"tabelas sem destino no Postgres (o dono já subiu nele?): {string.Join(", ", semDono)}");
        var ambiguas = tabelas.Where(t => donos[t].Count > 1).ToList();
        if (ambiguas.Count > 0)
            throw new InvalidOperationException($"tabelas em mais de um schema: {string.Join(", ", ambiguas)}");

        using var tx = destino.BeginTransaction();
        // As chaves estrangeiras não disparam durante a cópia: a ordem das tabelas não importa (exige superusuário).
        Exec(destino, "SET LOCAL session_replication_role = replica");
        var copiadas = new List<TabelaCopiada>();
        foreach (var t in tabelas)
        {
            var schema = donos[t][0];
            var alvo = $"\"{schema}\".\"{t}\"";
            var ja = Contar(destino, $"SELECT count(*) FROM {alvo}");
            if (ja > 0)
            {
                // Ex.: a tabela TACO que a Dieta semeia na primeira subida.
                if (!limpar) throw new InvalidOperationException($"{alvo} já tem {ja} linhas (use --limpar)");
                Exec(destino, $"DELETE FROM {alvo}");
            }
            var linhas = CopiarTabela(origem, destino, schema, t);
            var esperado = Contar(origem, $"SELECT count(*) FROM \"{t}\"");
            var gravado = Contar(destino, $"SELECT count(*) FROM {alvo}");
            if (linhas != esperado || gravado != esperado)
                throw new InvalidOperationException($"{t}: origem {esperado}, gravadas {gravado}");
            AjustarSequencias(destino, schema, t);
            log.WriteLine($"{schema}.{t}: {gravado}");
            copiadas.Add(new(t, schema, gravado));
        }
        Exec(destino, "SET LOCAL session_replication_role = origin");
        tx.Commit();
        return new Resultado(copiadas);
    }

    internal static List<string> TabelasDaOrigem(SqliteConnection c)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name";
        using var r = cmd.ExecuteReader();
        var l = new List<string>();
        while (r.Read())
        {
            var n = r.GetString(0);
            if (!Ignoradas.Any(p => n.StartsWith(p, StringComparison.Ordinal))) l.Add(n);
        }
        return l;
    }

    private static Dictionary<string, List<string>> SchemasDoDestino(NpgsqlConnection c)
    {
        using var cmd = new NpgsqlCommand(
            "SELECT table_name, table_schema FROM information_schema.tables " +
            "WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')", c);
        using var r = cmd.ExecuteReader();
        var d = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        while (r.Read())
        {
            var t = r.GetString(0);
            if (!d.TryGetValue(t, out var l)) d[t] = l = [];
            l.Add(r.GetString(1));
        }
        return d;
    }

    private static long CopiarTabela(SqliteConnection origem, NpgsqlConnection destino, string schema, string tabela)
    {
        var tipos = new Dictionary<string, string>(StringComparer.Ordinal);
        using (var cmd = new NpgsqlCommand(
            "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = @s AND table_name = @t", destino))
        {
            cmd.Parameters.AddWithValue("s", schema);
            cmd.Parameters.AddWithValue("t", tabela);
            using var r = cmd.ExecuteReader();
            while (r.Read()) tipos[r.GetString(0)] = r.GetString(1);
        }

        using var sel = origem.CreateCommand();
        sel.CommandText = $"SELECT * FROM \"{tabela}\"";
        using var leitor = sel.ExecuteReader();
        var colunas = Enumerable.Range(0, leitor.FieldCount).Select(leitor.GetName).ToList();
        var faltam = colunas.Where(c => !tipos.ContainsKey(c)).ToList();
        if (faltam.Count > 0)
            throw new InvalidOperationException($"{tabela}: colunas sem destino no Postgres: {string.Join(", ", faltam)}");

        var lista = string.Join(", ", colunas.Select(c => $"\"{c}\""));
        long n = 0;
        using (var copia = destino.BeginBinaryImport($"COPY \"{schema}\".\"{tabela}\" ({lista}) FROM STDIN (FORMAT BINARY)"))
        {
            while (leitor.Read())
            {
                copia.StartRow();
                for (var i = 0; i < colunas.Count; i++)
                {
                    var tipo = tipos[colunas[i]];
                    var v = leitor.IsDBNull(i) ? null : Converter(leitor.GetValue(i), tipo, tabela, colunas[i]);
                    if (v is null) copia.WriteNull();
                    else copia.Write(v, NomeNpgsql(tipo));
                }
                n++;
            }
            copia.Complete();
        }
        return n;
    }

    internal static string NomeNpgsql(string dataType) => dataType switch
    {
        "character varying" => "varchar",
        "character" => "char",
        "timestamp with time zone" => "timestamptz",
        "timestamp without time zone" => "timestamp",
        "time without time zone" => "time",
        "double precision" => "float8",
        "real" => "float4",
        "integer" => "int4",
        "bigint" => "int8",
        "smallint" => "int2",
        _ => dataType,
    };

    /// <summary>O valor do SQLite (long, double, string ou byte[]) no tipo da coluna de destino.</summary>
    internal static object Converter(object v, string tipo, string tabela, string coluna)
    {
        var inv = CultureInfo.InvariantCulture;
        try
        {
            return tipo switch
            {
                "boolean" => v is string sb ? sb is "1" || sb.Equals("true", StringComparison.OrdinalIgnoreCase) : Convert.ToInt64(v, inv) != 0,
                "smallint" => Convert.ToInt16(v, inv),
                "integer" => Convert.ToInt32(v, inv),
                "bigint" => Convert.ToInt64(v, inv),
                "real" => Convert.ToSingle(v, inv),
                "double precision" => Convert.ToDouble(v, inv),
                "numeric" => v is string sn ? decimal.Parse(sn, NumberStyles.Float, inv) : Convert.ToDecimal(v, inv),
                "timestamp with time zone" => Data(v, utc: true),
                "timestamp without time zone" => Data(v, utc: false),
                "date" => v is string sd ? DateOnly.ParseExact(sd[..10], "yyyy-MM-dd", inv) : DateOnly.FromDateTime(Data(v, false)),
                "time without time zone" => TimeOnly.Parse((string)v, inv),
                "interval" => TimeSpan.Parse((string)v, inv),
                "uuid" => Guid.Parse(Convert.ToString(v, inv)!),
                "bytea" => v as byte[] ?? System.Text.Encoding.UTF8.GetBytes(Convert.ToString(v, inv)!),
                _ => v is byte[] b ? System.Text.Encoding.UTF8.GetString(b) : Convert.ToString(v, inv)!,
            };
        }
        catch (Exception e) when (e is FormatException or InvalidCastException or OverflowException or ArgumentException)
        {
            throw new InvalidOperationException($"{tabela}.{coluna}: o valor não cabe em {tipo} ({e.Message})", e);
        }
    }

    /// <summary>Datas do EF no SQLite são texto sem fuso, em UTC; com fuso explícito, converte para UTC.</summary>
    private static DateTime Data(object v, bool utc)
    {
        DateTime d;
        if (v is string s)
            d = TemFuso(s)
                ? DateTimeOffset.Parse(s, CultureInfo.InvariantCulture).UtcDateTime
                : DateTime.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
        else d = DateTime.UnixEpoch.AddSeconds(Convert.ToDouble(v, CultureInfo.InvariantCulture));
        return DateTime.SpecifyKind(d, utc ? DateTimeKind.Utc : DateTimeKind.Unspecified);
    }

    private static bool TemFuso(string s) =>
        s.EndsWith('Z') || (s.Length > 6 && (s[^6] is '+' or '-') && s[^3] == ':');

    private static void AjustarSequencias(NpgsqlConnection c, string schema, string tabela)
    {
        var cols = new List<string>();
        using (var cmd = new NpgsqlCommand(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = @s AND table_name = @t " +
            "AND (is_identity = 'YES' OR column_default LIKE 'nextval(%')", c))
        {
            cmd.Parameters.AddWithValue("s", schema);
            cmd.Parameters.AddWithValue("t", tabela);
            using var r = cmd.ExecuteReader();
            while (r.Read()) cols.Add(r.GetString(0));
        }
        foreach (var col in cols)
            Exec(c, $"SELECT setval(pg_get_serial_sequence('\"{schema}\".\"{tabela}\"', '{col}'), " +
                    $"GREATEST(COALESCE((SELECT max(\"{col}\") FROM \"{schema}\".\"{tabela}\"), 0), 1))");
    }

    private static void Exec(NpgsqlConnection c, string sql)
    {
        using var cmd = new NpgsqlCommand(sql, c);
        cmd.ExecuteNonQuery();
    }

    private static long Contar(System.Data.Common.DbConnection c, string sql)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        return Convert.ToInt64(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
    }
}
