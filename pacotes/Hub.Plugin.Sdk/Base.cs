using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Hub.Plugin;

/// <summary>
/// Migração de base de um plug-in extraído (spec 031): as tabelas já existem no <c>notas.db</c>, então ela só
/// registra o ponto de partida em <c>__EFMigrationsHistory_&lt;id&gt;</c>. Gere com
/// <c>dotnet ef migrations add Base</c> e troque a classe base para <see cref="MigracaoDeBase"/>: o <c>Up</c> e o
/// <c>Down</c> gerados deixam de compilar (são <c>sealed</c> aqui), e é só apagá-los.
/// </summary>
public abstract class MigracaoDeBase : Migration
{
    protected sealed override void Up(MigrationBuilder migrationBuilder) { }
    protected sealed override void Down(MigrationBuilder migrationBuilder) { }
}

public static class BaseDoPlugin
{
    /// <summary>
    /// Diferenças entre o modelo da migração de base e as tabelas do banco: tabela que falta, coluna que falta ou
    /// coluna com outro tipo. Vazio = a base descreve o banco e pode ser registrada.
    /// </summary>
    public static IReadOnlyList<string> ConferirEsquema(IModel modeloDaBase, DbContext db)
    {
        var problemas = new List<string>();
        var conexao = db.Database.GetDbConnection();
        var abriu = conexao.State != System.Data.ConnectionState.Open;
        if (abriu) db.Database.OpenConnection();
        try
        {
            foreach (var t in modeloDaBase.GetEntityTypes())
            {
                if (t.GetTableName() is not { } tabela || t.IsTableExcludedFromMigrations()) continue;
                var colunas = Colunas(conexao, tabela);
                if (colunas.Count == 0) { problemas.Add($"tabela {tabela} não existe no banco"); continue; }
                var id = StoreObjectIdentifier.Table(tabela, t.GetSchema());
                foreach (var p in t.GetProperties())
                {
                    if (p.GetColumnName(id) is not { } coluna) continue;
                    if (!colunas.TryGetValue(coluna, out var tipoNoBanco)) { problemas.Add($"coluna {tabela}.{coluna} não existe no banco"); continue; }
                    var tipo = p.GetColumnType(id);
                    if (tipo is not null && Afinidade(tipo) != Afinidade(tipoNoBanco))
                        problemas.Add($"coluna {tabela}.{coluna}: {tipoNoBanco} no banco, {tipo} no modelo");
                }
            }
        }
        finally { if (abriu) db.Database.CloseConnection(); }
        return problemas;
    }

    /// <summary>
    /// <c>Migrate()</c> do plug-in com a conferência antes da primeira vez: se o histórico do plug-in está vazio e a
    /// primeira migração é uma <see cref="MigracaoDeBase"/>, confere o modelo dela com o banco e recusa subir se não
    /// bater (o deployer então mantém a versão anterior).
    /// </summary>
    public static void MigrarComBase(this DbContext db)
    {
        var assembly = db.GetService<IMigrationsAssembly>();
        var primeira = assembly.Migrations.OrderBy(m => m.Key).Select(m => m.Value).FirstOrDefault();
        if (primeira is not null && typeof(MigracaoDeBase).IsAssignableFrom(primeira.AsType())
            && !db.Database.GetAppliedMigrations().Any()
            && assembly.CreateMigration(primeira, db.Database.ProviderName!).TargetModel is { } modelo)
        {
            var inicializado = db.GetService<IModelRuntimeInitializer>().Initialize(modelo, designTime: true, validationLogger: null);
            if (ConferirEsquema(inicializado, db) is { Count: > 0 } p)
                throw new InvalidOperationException("A migração de base não bate com o banco: " + string.Join("; ", p));
        }
        db.Database.Migrate();
    }

    private static Dictionary<string, string> Colunas(System.Data.Common.DbConnection c, string tabela)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT name, type FROM pragma_table_info($t)";
        var p = cmd.CreateParameter();
        p.ParameterName = "$t";
        p.Value = tabela;
        cmd.Parameters.Add(p);
        var r = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        using var leitor = cmd.ExecuteReader();
        while (leitor.Read()) r[leitor.GetString(0)] = leitor.GetString(1);
        return r;
    }

    /// <summary>Afinidade de tipo do SQLite (seção 3.1 da documentação), que é o que importa para os dados.</summary>
    internal static string Afinidade(string tipo)
    {
        var t = tipo.ToUpperInvariant();
        if (t.Contains("INT")) return "INTEGER";
        if (t.Contains("CHAR") || t.Contains("CLOB") || t.Contains("TEXT")) return "TEXT";
        if (t.Length == 0 || t.Contains("BLOB")) return "BLOB";
        if (t.Contains("REAL") || t.Contains("FLOA") || t.Contains("DOUB")) return "REAL";
        return "NUMERIC";
    }
}
