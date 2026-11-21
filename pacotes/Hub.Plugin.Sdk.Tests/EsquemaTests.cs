using System.Data.Common;
using Hub.Plugin;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace Hub.Plugin.Sdk.Tests;

/// <summary>
/// Specs 037 e 038: o esquema sai do modelo, sem migrações, no SQLite e no Postgres. O Postgres só roda com
/// <c>HUB_PG_TESTE</c> (uma connection string), como na CI; cada teste usa um schema próprio e o apaga no fim.
/// </summary>
public abstract class EsquemaTestes : IDisposable
{
    public class Nota
    {
        public string Id { get; set; } = "";
        public string UserId { get; set; } = "";
        public string Titulo { get; set; } = "";
        public bool Fixada { get; set; }
        public DateTime CriadaEm { get; set; }
        public int Ordem { get; set; }
    }

    public sealed class Ctx(DbContextOptions<Ctx> o) : DbContext(o)
    {
        protected override void OnModelCreating(ModelBuilder b)
        {
            b.ReferenciarUsuarios();
            b.Entity<Nota>(e =>
            {
                e.ToTable("ex_notas");
                e.HasIndex(n => n.UserId);
                e.HasOne<UsuarioRef>().WithMany().HasForeignKey(n => n.UserId);
            });
        }
    }

    protected abstract Ctx Contexto();
    protected abstract DbConnection Conexao();
    protected abstract string ContarColunas(string tabela);
    protected abstract string ListarTabelas { get; }
    public abstract void Dispose();
    protected virtual bool Disponivel => true;
    private void Exigir() => Skip.IfNot(Disponivel, "HUB_PG_TESTE não definida");

    protected object? Escalar(string sql)
    {
        using var c = Conexao();
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        return cmd.ExecuteScalar();
    }

    protected List<string> Tabelas()
    {
        using var c = Conexao();
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = ListarTabelas;
        using var r = cmd.ExecuteReader();
        var nomes = new List<string>();
        while (r.Read()) nomes.Add(r.GetString(0));
        return nomes;
    }

    protected void CriarUsers() => Escalar("CREATE TABLE users (\"Id\" TEXT NOT NULL PRIMARY KEY, \"Email\" TEXT)");

    [SkippableFact]
    public void Banco_vazio_ganha_as_tabelas_do_modelo_menos_users()
    {
        Exigir();
        CriarUsers();
        using var db = Contexto();
        Esquema.Garantir(db);
        Assert.Contains("ex_notas", Tabelas());
        Assert.Equal(2L, Convert.ToInt64(Escalar(ContarColunas("users"))));
        Assert.DoesNotContain(Tabelas(), t => t.StartsWith("__EFMigrationsHistory"));
    }

    [SkippableFact]
    public void Subir_duas_vezes_nao_muda_nada()
    {
        Exigir();
        CriarUsers();
        using (var db = Contexto()) Esquema.Garantir(db);
        var antes = Tabelas();
        Escalar("INSERT INTO users (\"Id\") VALUES ('u1')");
        using (var db = Contexto())
        {
            db.Add(new Nota { Id = "n1", UserId = "u1", Titulo = "a", CriadaEm = DateTime.UtcNow });
            db.SaveChanges();
        }
        using (var db = Contexto()) Esquema.Garantir(db);
        Assert.Equal(antes, Tabelas());
        Assert.Equal(1L, Convert.ToInt64(Escalar("SELECT count(*) FROM ex_notas")));
    }

    [SkippableFact]
    public void Tabela_existente_ganha_as_colunas_que_faltam_sem_perder_linhas()
    {
        Exigir();
        CriarUsers();
        Escalar("CREATE TABLE ex_notas (\"Id\" TEXT NOT NULL PRIMARY KEY, \"UserId\" TEXT NOT NULL)");
        Escalar("INSERT INTO ex_notas (\"Id\", \"UserId\") VALUES ('n1', 'u1')");
        using (var db = Contexto()) Esquema.Garantir(db);
        Assert.Equal(1L, Convert.ToInt64(Escalar("SELECT count(*) FROM ex_notas")));
        Assert.Equal(6L, Convert.ToInt64(Escalar(ContarColunas("ex_notas"))));
        using var db2 = Contexto();
        var n = db2.Set<Nota>().Single();
        Assert.False(n.Fixada);
        Assert.Equal(0, n.Ordem);
    }

    [SkippableFact]
    public void Tabelas_de_fora_e_historicos_antigos_ficam_intactos()
    {
        Exigir();
        CriarUsers();
        Escalar("CREATE TABLE outra (\"Id\" TEXT, \"X\" TEXT)");
        Escalar("INSERT INTO outra VALUES ('o1', 'x')");
        Escalar("CREATE TABLE \"__EFMigrationsHistory_ex\" (\"MigrationId\" TEXT, \"ProductVersion\" TEXT)");
        Escalar("INSERT INTO \"__EFMigrationsHistory_ex\" VALUES ('1_Inicial', '9')");
        using (var db = Contexto()) Esquema.Garantir(db);
        Assert.Equal(2L, Convert.ToInt64(Escalar(ContarColunas("outra"))));
        Assert.Equal(1L, Convert.ToInt64(Escalar("SELECT count(*) FROM outra")));
        Assert.Equal(1L, Convert.ToInt64(Escalar("SELECT count(*) FROM \"__EFMigrationsHistory_ex\"")));
    }

    [SkippableFact]
    public void Script_nao_apaga_nem_altera_nada()
    {
        Exigir();
        using var db = Contexto();
        var comandos = Esquema.Comandos(db).ToList();
        Assert.NotEmpty(comandos);
        Assert.All(comandos, c =>
        {
            Assert.DoesNotContain("DROP ", c, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("IF NOT EXISTS", c);
        });
    }
}

public sealed class EsquemaSqliteTests : EsquemaTestes
{
    private readonly string _arquivo = Path.Combine(Path.GetTempPath(), $"esquema_{Guid.NewGuid():N}.db");
    private string Cs => $"Data Source={_arquivo};Pooling=False";

    protected override Ctx Contexto() => new(new DbContextOptionsBuilder<Ctx>().UseSqlite(Cs).Options);
    protected override DbConnection Conexao() => new SqliteConnection(Cs);
    protected override string ContarColunas(string t) => $"SELECT count(*) FROM pragma_table_info('{t}')";
    protected override string ListarTabelas =>
        "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY name";

    public override void Dispose()
    {
        SqliteConnection.ClearAllPools();
        foreach (var f in new[] { _arquivo, _arquivo + "-wal", _arquivo + "-shm" })
            try { if (File.Exists(f)) File.Delete(f); } catch (IOException) { }
    }
}

public sealed class EsquemaPostgresTests : EsquemaTestes
{
    private static readonly string? Base = Environment.GetEnvironmentVariable("HUB_PG_TESTE");
    private readonly string _schema = $"t_{Guid.NewGuid():N}";
    protected override bool Disponivel => !string.IsNullOrEmpty(Base);
    private string Cs => new NpgsqlConnectionStringBuilder(Base) { SearchPath = _schema, Pooling = false }.ConnectionString;

    public EsquemaPostgresTests()
    {
        if (string.IsNullOrEmpty(Base)) return;
        using var c = new NpgsqlConnection(Base);
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = $"CREATE SCHEMA \"{_schema}\"";
        cmd.ExecuteNonQuery();
    }

    protected override Ctx Contexto() => new(new DbContextOptionsBuilder<Ctx>().UseNpgsql(Cs).Options);
    protected override DbConnection Conexao() => new NpgsqlConnection(Cs);
    protected override string ContarColunas(string t) =>
        $"SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '{t}'";
    protected override string ListarTabelas =>
        "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() UNION ALL " +
        "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() ORDER BY 1";

    public override void Dispose()
    {
        if (string.IsNullOrEmpty(Base)) return;
        using var c = new NpgsqlConnection(Base);
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = $"DROP SCHEMA IF EXISTS \"{_schema}\" CASCADE";
        cmd.ExecuteNonQuery();
    }
}

public class ProvedorDoHubTests
{
    private sealed class C(DbContextOptions<C> o) : DbContext(o);

    [Theory]
    [InlineData("/data/db/notas.db", "Microsoft.EntityFrameworkCore.Sqlite")]
    [InlineData("Host=postgres;Database=hub;Username=notas", "Npgsql.EntityFrameworkCore.PostgreSQL")]
    public void Escolhe_o_provedor_pelo_HUB_BANCO(string banco, string provedor)
    {
        var o = new DbContextOptionsBuilder<C>().UsarBancoDoHub(new OpcoesDoHub { Id = "ex", Banco = banco });
        using var db = new C((DbContextOptions<C>)o.Options);
        Assert.Equal(provedor, db.Database.ProviderName);
    }
}
