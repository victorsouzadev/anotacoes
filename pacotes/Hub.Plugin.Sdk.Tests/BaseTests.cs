using Hub.Plugin;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Xunit;

namespace Hub.Plugin.Sdk.Tests;

public class ItemDaBase
{
    public int Id { get; set; }
    public string Nome { get; set; } = "";
}

public sealed class ContextoDaBase(DbContextOptions<ContextoDaBase> o) : DbContext(o)
{
    public DbSet<ItemDaBase> Itens => Set<ItemDaBase>();
    protected override void OnModelCreating(ModelBuilder b) => b.Entity<ItemDaBase>().ToTable("exemplo_itens");
}

/// <summary>Como o <c>dotnet ef migrations add Base</c> gera, com a classe base trocada e o Up/Down apagados.</summary>
[DbContext(typeof(ContextoDaBase))]
[Migration("20260101000000_Base")]
public sealed class Base : MigracaoDeBase
{
    protected override void BuildTargetModel(ModelBuilder b) =>
        b.Entity("Hub.Plugin.Sdk.Tests.ItemDaBase", e =>
        {
            e.Property<int>("Id").ValueGeneratedOnAdd().HasColumnType("INTEGER");
            e.Property<string>("Nome").IsRequired().HasColumnType("TEXT");
            e.HasKey("Id");
            e.ToTable("exemplo_itens");
        });
}

/// <summary>Spec 031 (T004): a base só é registrada se o modelo dela bater com as tabelas que já existem.</summary>
public sealed class BaseTests : IDisposable
{
    private readonly string _banco = Path.Combine(Path.GetTempPath(), "base-" + Guid.NewGuid().ToString("N") + ".db");

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try { File.Delete(_banco); } catch (IOException) { }
    }

    private void Sql(string sql)
    {
        using var c = new SqliteConnection($"Data Source={_banco}");
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    private ContextoDaBase Db() =>
        new((DbContextOptions<ContextoDaBase>)new DbContextOptionsBuilder<ContextoDaBase>()
            .UsarBancoDoHub(new OpcoesDoHub { Id = "exemplo", Banco = _banco }).Options);

    [Fact]
    public void Base_que_bate_e_registrada_sem_mexer_nos_dados()
    {
        Sql("CREATE TABLE exemplo_itens (Id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, Nome TEXT NOT NULL); INSERT INTO exemplo_itens (Nome) VALUES ('antigo');");
        using (var db = Db()) db.MigrarComBase();
        using (var db = Db())
        {
            Assert.Equal(["20260101000000_Base"], db.Database.GetAppliedMigrations());
            Assert.Equal("antigo", db.Itens.Single().Nome);
            db.MigrarComBase(); // segunda subida: nada a conferir nem a aplicar
        }
    }

    [Theory]
    [InlineData("CREATE TABLE exemplo_itens (Id INTEGER PRIMARY KEY)", "coluna exemplo_itens.Nome não existe")]
    [InlineData("CREATE TABLE exemplo_itens (Id INTEGER PRIMARY KEY, Nome BLOB)", "BLOB no banco")]
    [InlineData("CREATE TABLE outra (Id INTEGER)", "tabela exemplo_itens não existe")]
    public void Base_que_nao_bate_nao_sobe(string ddl, string esperado)
    {
        Sql(ddl);
        using var db = Db();
        var e = Assert.Throws<InvalidOperationException>(db.MigrarComBase);
        Assert.Contains(esperado, e.Message);
        Assert.Empty(db.Database.GetAppliedMigrations());
    }

    [Theory]
    [InlineData("VARCHAR(20)", "TEXT")]
    [InlineData("BIGINT", "INTEGER")]
    [InlineData("DOUBLE", "REAL")]
    [InlineData("DECIMAL(10,2)", "NUMERIC")]
    [InlineData("", "BLOB")]
    public void Afinidade_do_sqlite(string tipo, string afinidade) => Assert.Equal(afinidade, BaseDoPlugin.Afinidade(tipo));
}

/// <summary>Spec 031 (T010): SQLITE_BUSY que passa do busy_timeout é contado.</summary>
public sealed class OcupadoTests : IDisposable
{
    private readonly string _banco = Path.Combine(Path.GetTempPath(), "ocupado-" + Guid.NewGuid().ToString("N") + ".db");

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try { File.Delete(_banco); } catch (IOException) { }
    }

    [Fact]
    public void Escrita_travada_por_outro_processo_conta_um_busy()
    {
        using (var c = new SqliteConnection($"Data Source={_banco}"))
        {
            c.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = "PRAGMA journal_mode=WAL; CREATE TABLE exemplo_itens (Id INTEGER PRIMARY KEY AUTOINCREMENT, Nome TEXT NOT NULL);";
            cmd.ExecuteNonQuery();
        }
        using var trava = new SqliteConnection($"Data Source={_banco};Pooling=False");
        trava.Open();
        using (var t = trava.CreateCommand()) { t.CommandText = "BEGIN IMMEDIATE"; t.ExecuteNonQuery(); }

        var opcoes = new DbContextOptionsBuilder<ContextoDaBase>()
            .UsarBancoDoHub(new OpcoesDoHub { Id = "exemplo", Banco = _banco }).Options;
        var antes = Dados.Ocupado;
        using var db = new ContextoDaBase((DbContextOptions<ContextoDaBase>)opcoes);
        db.Database.ExecuteSqlRaw("PRAGMA busy_timeout=50");
        Assert.ThrowsAny<Exception>(() => db.Database.ExecuteSqlRaw("INSERT INTO exemplo_itens (Nome) VALUES ('x')"));
        Assert.True(Dados.Ocupado > antes);
        Assert.True(Dados.EhOcupado(new SqliteException("locked", 5)));
        Assert.False(Dados.EhOcupado(new SqliteException("outro", 1)));
    }
}
