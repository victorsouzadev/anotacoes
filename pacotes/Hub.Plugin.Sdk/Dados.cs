using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Metadata;

namespace Hub.Plugin;

/// <summary>Só o <c>Id</c> de <c>users</c>, para as chaves estrangeiras: o plug-in não lê e-mail nem senha.</summary>
public class UsuarioRef
{
    public string Id { get; set; } = "";
}

/// <summary>Banco compartilhado do hub (spec 031): o mesmo <c>notas.db</c>, histórico de migração próprio.</summary>
public static class Dados
{
    /// <summary>
    /// SQLite do hub com <c>__EFMigrationsHistory_&lt;id&gt;</c>, WAL e <c>busy_timeout=5000</c> em cada conexão.
    /// </summary>
    public static DbContextOptionsBuilder UsarBancoDoHub(this DbContextOptionsBuilder o, OpcoesDoHub hub) =>
        o.UseSqlite($"Data Source={hub.Banco};Default Timeout=5", s => s.MigrationsHistoryTable("__EFMigrationsHistory_" + hub.Id))
            .AddInterceptors(new ConexaoDoHub());

    /// <summary>Mapeia <c>users</c> só com o Id, fora das migrações do plug-in.</summary>
    public static void ReferenciarUsuarios(this ModelBuilder b) =>
        b.Entity<UsuarioRef>(e =>
        {
            e.ToTable("users", t => t.ExcludeFromMigrations());
            e.HasKey(u => u.Id);
        });

    /// <summary>
    /// Tabelas do modelo fora do prefixo e das legadas do manifesto (a de usuários fica de fora). Use num teste do
    /// plug-in: a lista tem de ser vazia, senão o deployer recusa a versão (spec 031).
    /// </summary>
    public static IReadOnlyList<string> TabelasForaDoDono(IModel modelo, Manifesto m) =>
        modelo.GetEntityTypes()
            .Where(t => t.ClrType != typeof(UsuarioRef) && t.GetTableName() is not null)
            .Select(t => t.GetTableName()!)
            .Where(n => !n.StartsWith(m.Tabelas.Prefixo, StringComparison.OrdinalIgnoreCase)
                        && !(m.Tabelas.Legadas ?? []).Contains(n, StringComparer.OrdinalIgnoreCase))
            .Distinct().Order().ToList();

    private sealed class ConexaoDoHub : DbConnectionInterceptor
    {
        public override void ConnectionOpened(DbConnection c, ConnectionEndEventData e) => Pragmas(c);

        public override Task ConnectionOpenedAsync(DbConnection c, ConnectionEndEventData e, CancellationToken ct = default)
        {
            Pragmas(c);
            return Task.CompletedTask;
        }

        private static void Pragmas(DbConnection c)
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;";
            cmd.ExecuteNonQuery();
        }
    }
}
