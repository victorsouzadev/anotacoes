using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>
/// Sobe a API inteira (Program.cs) num host in-memory, contra um arquivo SQLite temporário
/// exclusivo desta instância — mesmo caminho de código de produção, sem mocks.
/// </summary>
public class TasksApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"notas-tests-{Guid.NewGuid():N}.db");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("JWT_SECRET", "test-secret-key-for-integration-tests-only-0123456789");
        builder.UseSetting("ConnectionStrings:Db", $"Data Source={_dbPath}");
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public new Task DisposeAsync()
    {
        base.Dispose();
        if (File.Exists(_dbPath)) File.Delete(_dbPath);
        foreach (var suffix in new[] { "-wal", "-shm" })
        {
            var f = _dbPath + suffix;
            if (File.Exists(f)) File.Delete(f);
        }
        return Task.CompletedTask;
    }
}
