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
    /// SQLite do hub com <c>__EFMigrationsHistory_&lt;id&gt;</c>, WAL e <c>busy_timeout=5000</c> em cada conexão,
    /// sem pool de conexões e com nova tentativa quando o banco responde ocupado (<see cref="RetentativaDoHub"/>).
    /// Com a retentativa, uma transação explícita do EF (<c>BeginTransaction</c>) tem de rodar dentro de
    /// <c>db.Database.CreateExecutionStrategy().ExecuteAsync(...)</c>.
    /// </summary>
    public static DbContextOptionsBuilder UsarBancoDoHub(this DbContextOptionsBuilder o, OpcoesDoHub hub) =>
        o.UseSqlite($"Data Source={hub.Banco};Default Timeout=5;Pooling=False", s => s
                .MigrationsHistoryTable("__EFMigrationsHistory_" + hub.Id)
                .ExecutionStrategy(d => new RetentativaDoHub(d)))
            .AddInterceptors(new ConexaoDoHub(), new OcupadoDoHub());

    /// <summary>
    /// Quantas vezes o banco respondeu <c>SQLITE_BUSY</c>/<c>SQLITE_LOCKED</c> mesmo depois do <c>busy_timeout</c>
    /// (spec 031, SC-003). Cada ocorrência também vai para o log com "SQLITE_BUSY", para contar com grep.
    /// </summary>
    public static long Ocupado => Interlocked.Read(ref _ocupado);
    private static long _ocupado;

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

    /// <summary>
    /// Tenta de novo (até 5 vezes, no máximo 500 ms entre elas) quando o SQLite responde <c>SQLITE_BUSY</c>/<c>LOCKED</c>
    /// fora do alcance do <c>busy_timeout</c>, como ao abrir ou devolver a conexão. Nas Tarefas (spec 035) isso dava 500
    /// em 1 de cada 6 aberturas da tela, que faz cinco leituras em paralelo.
    /// </summary>
    public sealed class RetentativaDoHub(Microsoft.EntityFrameworkCore.Storage.ExecutionStrategyDependencies d)
        : Microsoft.EntityFrameworkCore.Storage.ExecutionStrategy(d, maxRetryCount: 5, maxRetryDelay: TimeSpan.FromMilliseconds(500))
    {
        protected override bool ShouldRetryOn(Exception e) => EhOcupado(e);
    }

    internal static bool EhOcupado(Exception e) =>
        e is Microsoft.Data.Sqlite.SqliteException { SqliteErrorCode: 5 or 6 }
        || e.InnerException is { } i && EhOcupado(i);

    private sealed class OcupadoDoHub : DbCommandInterceptor
    {
        public override void CommandFailed(DbCommand c, CommandErrorEventData e) => Contar(e.Exception);

        public override Task CommandFailedAsync(DbCommand c, CommandErrorEventData e, CancellationToken ct = default)
        {
            Contar(e.Exception);
            return Task.CompletedTask;
        }

        private static void Contar(Exception e)
        {
            if (!EhOcupado(e)) return;
            var n = Interlocked.Increment(ref _ocupado);
            Console.Error.WriteLine($"warn: Hub.Plugin.Dados[0] SQLITE_BUSY: banco do hub ocupado depois de 5 s (ocorrência {n} desde a subida)");
        }
    }

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
            // O EF abre conexões só de leitura (Mode=ReadOnly) para saber se o banco existe: nelas não dá para
            // trocar o journal_mode, e o banco do hub já está em WAL.
            var soLeitura = c.ConnectionString.Contains("Mode=ReadOnly", StringComparison.OrdinalIgnoreCase);
            cmd.CommandText = (soLeitura ? "" : "PRAGMA journal_mode=WAL; ") + "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;";
            cmd.ExecuteNonQuery();
        }
    }
}
