using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;

namespace Hub.Plugin;

/// <summary>
/// Cria e atualiza as tabelas de um <see cref="DbContext"/> a partir do próprio modelo, sem migrações (specs 037 e 038),
/// no SQLite e no Postgres. Só toca no que está no modelo: tabelas de fora e históricos de migração antigos ficam como
/// estão. Tabelas marcadas com <c>ExcludeFromMigrations</c> (como o <c>users</c> de <see cref="Dados.ReferenciarUsuarios"/>)
/// também ficam de fora.
/// </summary>
public static class Esquema
{
    /// <summary>
    /// Cria as tabelas e os índices que faltam e acrescenta as colunas novas do modelo em tabelas que já existem.
    /// Repetir não muda nada. Remover ou trocar o tipo de uma coluna não é automático.
    /// </summary>
    public static void Garantir(DbContext db)
    {
        var postgres = EhPostgres(db);
        db.Database.OpenConnection();
        try
        {
            var conexao = db.Database.GetDbConnection();
            // Dois processos subindo juntos não enxergam o esquema pela metade: no SQLite o IMMEDIATE trava o arquivo,
            // no Postgres a trava de sessão vale até o fim da transação.
            Executar(conexao, postgres ? "BEGIN; SELECT pg_advisory_xact_lock(hashtext(current_schema()))" : "BEGIN IMMEDIATE");
            try
            {
                foreach (var comando in Comandos(db))
                    Executar(conexao, comando);
                AcrescentarColunas(db, conexao, postgres);
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
            .Where(c => c.Length > 0 && !c.StartsWith("--"))
            .Select(c => c
                .Replace("CREATE TABLE \"", "CREATE TABLE IF NOT EXISTS \"")
                .Replace("CREATE UNIQUE INDEX \"", "CREATE UNIQUE INDEX IF NOT EXISTS \"")
                .Replace("CREATE INDEX \"", "CREATE INDEX IF NOT EXISTS \""));

    internal static bool EhPostgres(DbContext db) =>
        db.Database.ProviderName?.Contains("Npgsql", StringComparison.OrdinalIgnoreCase) == true;

    private static void AcrescentarColunas(DbContext db, DbConnection conexao, bool postgres)
    {
        // O modelo de tempo de execução não guarda o ExcludeFromMigrations; o de design guarda.
        var modelo = db.GetService<Microsoft.EntityFrameworkCore.Metadata.IDesignTimeModel>().Model;
        foreach (var tabela in modelo.GetRelationalModel().Tables)
        {
            if (tabela.IsExcludedFromMigrations) continue;
            var existentes = ColunasDe(conexao, tabela.Name, postgres);
            foreach (var coluna in tabela.Columns)
            {
                if (existentes.Contains(coluna.Name)) continue;
                Executar(conexao, $"ALTER TABLE \"{tabela.Name}\" ADD COLUMN {DefinicaoDe(coluna)}");
            }
        }
    }

    private static HashSet<string> ColunasDe(DbConnection conexao, string tabela, bool postgres)
    {
        var nomes = new HashSet<string>(postgres ? StringComparer.Ordinal : StringComparer.OrdinalIgnoreCase);
        using var cmd = conexao.CreateCommand();
        if (postgres)
        {
            cmd.CommandText = "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = @t";
            var p = cmd.CreateParameter();
            p.ParameterName = "t";
            p.Value = tabela;
            cmd.Parameters.Add(p);
        }
        else cmd.CommandText = $"SELECT name FROM pragma_table_info('{tabela.Replace("'", "''")}')";
        using var leitor = cmd.ExecuteReader();
        while (leitor.Read()) nomes.Add(leitor.GetString(0));
        return nomes;
    }

    private static string DefinicaoDe(IColumn coluna)
    {
        var sql = $"\"{coluna.Name}\" {coluna.StoreType}";
        if (coluna.IsNullable) return sql;
        // Coluna NOT NULL nova precisa de um valor padrão para as linhas que já existem: o vazio do tipo do modelo
        // (0, false, data mínima, texto vazio), escrito pelo próprio provedor.
        return $"{sql} NOT NULL DEFAULT ({coluna.DefaultValueSql ?? PadraoDe(coluna)})";
    }

    private static string PadraoDe(IColumn coluna)
    {
        var mapa = coluna.StoreTypeMapping;
        var tipo = mapa.Converter?.ProviderClrType ?? mapa.ClrType;
        tipo = Nullable.GetUnderlyingType(tipo) ?? tipo;
        object valor = tipo == typeof(string) ? ""
            : tipo == typeof(byte[]) ? Array.Empty<byte>()
            : tipo.IsValueType ? Activator.CreateInstance(tipo)!
            : "";
        return mapa.GenerateSqlLiteral(valor);
    }

    private static void Executar(DbConnection c, string sql)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }
}
