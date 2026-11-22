using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>
/// Sobe a API inteira (Program.cs) num host in-memory, contra um banco exclusivo desta instância — mesmo caminho de
/// código de produção, sem mocks. Por padrão é um arquivo SQLite temporário; com <c>HUB_PG_TESTE</c> (spec 038) é um
/// banco novo nesse Postgres, apagado no fim.
/// </summary>
public class TasksApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    public static readonly string? Postgres = Environment.GetEnvironmentVariable("HUB_PG_TESTE");
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"notas-tests-{Guid.NewGuid():N}.db");
    private readonly string _pgBanco = $"t_{Guid.NewGuid():N}";
    private bool _pgCriado;

    /// <summary>A connection string que a API recebe.</summary>
    public string Conexao => string.IsNullOrEmpty(Postgres)
        ? $"Data Source={_dbPath}"
        : new NpgsqlConnectionStringBuilder(Postgres) { Database = _pgBanco, Pooling = false }.ConnectionString;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        if (!string.IsNullOrEmpty(Postgres) && !_pgCriado)
        {
            ComoAdmin($"CREATE DATABASE \"{_pgBanco}\"");
            _pgCriado = true;
        }
        builder.UseSetting("JWT_SECRET", "test-secret-key-for-integration-tests-only-0123456789");
        builder.UseSetting("ConnectionStrings:Db", Conexao);
        builder.UseSetting("Chaves:Chaves", _dbPath + ".chaves");
    }

    private static void ComoAdmin(string sql)
    {
        using var c = new NpgsqlConnection(Postgres);
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public new Task DisposeAsync()
    {
        base.Dispose();
        if (_pgCriado) ComoAdmin($"DROP DATABASE IF EXISTS \"{_pgBanco}\" WITH (FORCE)");
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            var f = _dbPath + suffix;
            if (File.Exists(f)) File.Delete(f);
        }
        if (Directory.Exists(_dbPath + ".chaves")) Directory.Delete(_dbPath + ".chaves", true);
        return Task.CompletedTask;
    }
}
