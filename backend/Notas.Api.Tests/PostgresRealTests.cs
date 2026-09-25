using Microsoft.Extensions.Options;
using Notas.Api.Services.Sites;
using Npgsql;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>Só roda com um Postgres de verdade: TEST_POSTGRES_ADMIN="Host=...;Username=postgres;Password=...".</summary>
public sealed class PostgresFactAttribute : FactAttribute
{
    public PostgresFactAttribute()
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("TEST_POSTGRES_ADMIN")))
            Skip = "Defina TEST_POSTGRES_ADMIN para testar contra um Postgres real.";
    }
}

public class PostgresRealTests
{
    private static readonly string Admin = Environment.GetEnvironmentVariable("TEST_POSTGRES_ADMIN") ?? "";

    private static (PostgresProvisionador Prov, SitesOptions Opt) Criar()
    {
        var host = new NpgsqlConnectionStringBuilder(Admin);
        var opt = new SitesOptions { PostgresAdmin = Admin, PostgresHost = host.Host!, PostgresPorta = host.Port };
        return (new PostgresProvisionador(Options.Create(opt)), opt);
    }

    private static async Task<object?> Escalar(string conexao, string sql)
    {
        await using var c = new NpgsqlConnection(conexao + ";Pooling=false");
        await c.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, c);
        return await cmd.ExecuteScalarAsync();
    }

    [PostgresFact]
    public async Task Cada_site_tem_banco_e_usuario_isolados()
    {
        var (prov, opt) = Criar();
        var a = PostgresNomes.DoSlug("teste-" + Guid.NewGuid().ToString("N")[..8]);
        var b = PostgresNomes.DoSlug("teste-" + Guid.NewGuid().ToString("N")[..8]);
        var senhaA = PostgresNomes.NovaSenha();
        var senhaB = PostgresNomes.NovaSenha();
        try
        {
            await prov.CriarAsync(a, senhaA, default);
            await prov.CriarAsync(b, senhaB, default);
            await prov.CriarAsync(a, senhaA, default); // idempotente

            var connA = PostgresNomes.ConnectionString(opt, a, senhaA);
            await Escalar(connA, "CREATE TABLE recados(id int); INSERT INTO recados VALUES (1);");
            Assert.Equal(1L, await Escalar(connA, "SELECT count(*) FROM recados"));

            // A não entra no banco de B, nem no "postgres".
            var connAnoB = new NpgsqlConnectionStringBuilder(connA) { Database = b }.ConnectionString;
            var negado = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => Escalar(connAnoB, "SELECT 1"));
            Assert.Equal("42501", negado.SqlState);
            var connAnoPostgres = new NpgsqlConnectionStringBuilder(connA) { Database = "postgres" }.ConnectionString;
            Assert.Equal("42501", (await Assert.ThrowsAsync<Npgsql.PostgresException>(() => Escalar(connAnoPostgres, "SELECT 1"))).SqlState);

            // Não é superusuário nem cria banco.
            Assert.Equal(false, await Escalar(connA, "SELECT rolsuper OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname = current_user"));

            // Recriar deixa o banco vazio, mas o usuário e a senha continuam valendo.
            await prov.RecriarBancoAsync(a, default);
            Assert.Equal(0L, await Escalar(connA, "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"));
            await Escalar(connA, "CREATE TABLE recados(id int); INSERT INTO recados VALUES (1);");

            // Trocar a senha invalida a antiga.
            var nova = PostgresNomes.NovaSenha();
            await prov.TrocarSenhaAsync(a, nova, default);
            await Assert.ThrowsAsync<Npgsql.PostgresException>(() => Escalar(connA, "SELECT 1"));
            Assert.Equal(1L, await Escalar(PostgresNomes.ConnectionString(opt, a, nova), "SELECT count(*) FROM recados"));
        }
        finally
        {
            await prov.RemoverAsync(a, default);
            await prov.RemoverAsync(b, default);
        }
        Assert.Null(await Escalar(Admin, $"SELECT 1 FROM pg_database WHERE datname = '{a}'"));
        Assert.Null(await Escalar(Admin, $"SELECT 1 FROM pg_roles WHERE rolname = '{a}'"));
    }
}
