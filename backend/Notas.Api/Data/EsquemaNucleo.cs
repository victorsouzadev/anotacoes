using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace Notas.Api.Data;

/// <summary>
/// Cria e atualiza as tabelas do núcleo a partir do próprio modelo do <see cref="AppDbContext"/> (spec 037), no lugar
/// das migrações do EF. Só toca no que é do núcleo: tabelas dos plug-ins e o <c>__EFMigrationsHistory</c> antigo ficam
/// como estão.
/// </summary>
public static class EsquemaNucleo
{
    /// <summary>
    /// Cria as tabelas e os índices que faltam e acrescenta as colunas novas do modelo em tabelas que já existem.
    /// Repetir não muda nada. Remover ou trocar o tipo de uma coluna não é automático (ver <c>DEPLOY.md</c>).
    /// </summary>
    public static void Garantir(DbContext db)
    {
        db.Database.OpenConnection();
        try
        {
            var conexao = db.Database.GetDbConnection();
            // IMMEDIATE: dois processos subindo juntos no mesmo arquivo não enxergam o esquema pela metade.
            Executar(conexao, "BEGIN IMMEDIATE");
            try
            {
                foreach (var comando in Comandos(db))
                    Executar(conexao, comando);
                AcrescentarColunas(db, conexao);
                Executar(conexao, "COMMIT");
            }
            catch
            {
                Executar(conexao, "ROLLBACK");
                throw;
            }
        }
        finally { db.Database.CloseConnection(); }
    }

    /// <summary>Os comandos do script de criação do modelo, cada um com <c>IF NOT EXISTS</c>.</summary>
    public static IEnumerable<string> Comandos(DbContext db) =>
        db.Database.GenerateCreateScript()
            .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(c => c
                .Replace("CREATE TABLE \"", "CREATE TABLE IF NOT EXISTS \"")
                .Replace("CREATE UNIQUE INDEX \"", "CREATE UNIQUE INDEX IF NOT EXISTS \"")
                .Replace("CREATE INDEX \"", "CREATE INDEX IF NOT EXISTS \""));

    private static void AcrescentarColunas(DbContext db, DbConnection conexao)
    {
        foreach (var tabela in db.Model.GetRelationalModel().Tables)
        {
            var existentes = ColunasDe(conexao, tabela.Name);
            foreach (var coluna in tabela.Columns)
            {
                if (existentes.Contains(coluna.Name)) continue;
                Executar(conexao, $"ALTER TABLE \"{tabela.Name}\" ADD COLUMN {DefinicaoDe(coluna)}");
            }
        }
    }

    private static HashSet<string> ColunasDe(DbConnection conexao, string tabela)
    {
        var nomes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        using var cmd = conexao.CreateCommand();
        cmd.CommandText = $"PRAGMA table_info(\"{tabela}\")";
        using var leitor = cmd.ExecuteReader();
        while (leitor.Read()) nomes.Add(leitor.GetString(1));
        return nomes;
    }

    private static string DefinicaoDe(IColumn coluna)
    {
        var sql = $"\"{coluna.Name}\" {coluna.StoreType}";
        if (coluna.IsNullable) return sql;
        // SQLite só aceita coluna NOT NULL nova com um valor padrão para as linhas que já existem.
        var padrao = coluna.DefaultValueSql
            ?? (coluna.StoreType.ToUpperInvariant() switch
            {
                "INTEGER" or "REAL" or "NUMERIC" => "0",
                "BLOB" => "X''",
                _ => "''",
            });
        return $"{sql} NOT NULL DEFAULT ({padrao})";
    }

    private static void Executar(DbConnection c, string sql)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }
}
