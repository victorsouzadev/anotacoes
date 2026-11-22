using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>Specs 037 e 038: o núcleo cria as próprias tabelas pelo modelo, sem migrações, e não toca no que não é dele.</summary>
public class EsquemaNucleoTests : IDisposable
{
    private readonly string _arquivo = Path.Combine(Path.GetTempPath(), $"esquema_{Guid.NewGuid():N}.db");

    private AppDbContext Contexto() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={_arquivo};Pooling=False").Options);

    private object? Escalar(string sql)
    {
        using var c = new SqliteConnection($"Data Source={_arquivo};Pooling=False");
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        return cmd.ExecuteScalar();
    }

    private List<string> Tabelas()
    {
        using var c = new SqliteConnection($"Data Source={_arquivo};Pooling=False");
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY name";
        using var r = cmd.ExecuteReader();
        var nomes = new List<string>();
        while (r.Read()) nomes.Add(r.GetString(0));
        return nomes;
    }

    [Fact]
    public void Banco_vazio_ganha_todas_as_tabelas_do_modelo()
    {
        using var db = Contexto();
        Hub.Plugin.Esquema.Garantir(db);
        var tabelas = Tabelas();
        foreach (var t in db.Model.GetRelationalModel().Tables)
            Assert.Contains(t.Name, tabelas);
        Assert.DoesNotContain("__EFMigrationsHistory", tabelas);
    }

    [Fact]
    public void Subir_duas_vezes_nao_muda_nada()
    {
        using (var db = Contexto()) Hub.Plugin.Esquema.Garantir(db);
        var antes = Tabelas();
        Escalar("INSERT INTO users (Id, Email, PasswordHash, CreatedAt) VALUES ('u1', 'a@example.com', 'x', '2026-01-01')");
        using (var db = Contexto()) Hub.Plugin.Esquema.Garantir(db);
        Assert.Equal(antes, Tabelas());
        Assert.Equal(1L, Escalar("SELECT count(*) FROM users"));
    }

    [Fact]
    public void Tabela_existente_ganha_a_coluna_que_falta_sem_perder_linhas()
    {
        Escalar("CREATE TABLE core_plugins_estado (Id TEXT NOT NULL PRIMARY KEY)");
        Escalar("INSERT INTO core_plugins_estado (Id) VALUES ('notas')");
        using (var db = Contexto()) Hub.Plugin.Esquema.Garantir(db);
        Assert.Equal(1L, Escalar("SELECT count(*) FROM core_plugins_estado"));
        using var db2 = Contexto();
        var colunas = db2.Model.GetRelationalModel().Tables.Single(t => t.Name == "core_plugins_estado").Columns.Count();
        Assert.Equal((long)colunas, Escalar("SELECT count(*) FROM pragma_table_info('core_plugins_estado')"));
    }

    [Fact]
    public void Tabelas_dos_plugins_e_o_historico_antigo_ficam_intactos()
    {
        Escalar("CREATE TABLE notes (Id TEXT, Titulo TEXT)");
        Escalar("INSERT INTO notes VALUES ('n1', 'x')");
        Escalar("CREATE TABLE \"__EFMigrationsHistory\" (MigrationId TEXT, ProductVersion TEXT)");
        Escalar("INSERT INTO \"__EFMigrationsHistory\" VALUES ('20261121185722_ExtracaoNotas', '9')");
        using (var db = Contexto()) Hub.Plugin.Esquema.Garantir(db);
        Assert.Equal(2L, Escalar("SELECT count(*) FROM pragma_table_info('notes')"));
        Assert.Equal(1L, Escalar("SELECT count(*) FROM notes"));
        Assert.Equal(1L, Escalar("SELECT count(*) FROM \"__EFMigrationsHistory\""));
    }

    [Fact]
    public void Script_nao_apaga_nem_altera_nada()
    {
        using var db = Contexto();
        Assert.All(Hub.Plugin.Esquema.Comandos(db), c =>
        {
            Assert.DoesNotContain("DROP ", c, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("IF NOT EXISTS", c);
        });
    }

    public void Dispose()
    {
        foreach (var f in new[] { _arquivo, _arquivo + "-wal", _arquivo + "-shm" })
            if (File.Exists(f)) File.Delete(f);
    }
}
