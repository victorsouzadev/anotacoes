using System.Security.Cryptography;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Notas.Api.Services.Sites;

public class ProvisionamentoPostgresException(string message) : Exception(message);

/// <summary>
/// Cria e remove o banco Postgres de cada site no servidor compartilhado. Cada site
/// ganha um banco e um usuário com o mesmo nome (site_&lt;slug&gt;), dono só do próprio
/// banco, sem conseguir conectar nos dos outros.
/// </summary>
public interface IPostgresProvisionador
{
    /// <summary>Cria (ou recria, se sumiu) o usuário e o banco. Idempotente.</summary>
    Task CriarAsync(string nome, string senha, CancellationToken ct);
    Task TrocarSenhaAsync(string nome, string senha, CancellationToken ct);
    /// <summary>Apaga o banco (derrubando as conexões abertas) e o usuário.</summary>
    Task RemoverAsync(string nome, CancellationToken ct);
    /// <summary>Apaga e recria o banco vazio (o usuário fica), para receber um pg_restore.</summary>
    Task RecriarBancoAsync(string nome, CancellationToken ct);
}

public static class PostgresNomes
{
    /// <summary>site_&lt;slug&gt; com _ no lugar de -: identificador válido sem precisar de aspas.</summary>
    public static string DoSlug(string slug) => "site_" + slug.Replace('-', '_');

    /// <summary>64 caracteres hexadecimais: forte e sem nada que precise de escape em SQL ou URL.</summary>
    public static string NovaSenha() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();

    public static string ConnectionString(SitesOptions opt, string nome, string senha) =>
        new NpgsqlConnectionStringBuilder
        {
            Host = opt.PostgresHost,
            Port = opt.PostgresPorta,
            Database = nome,
            Username = nome,
            Password = senha,
            MaxPoolSize = opt.PostgresLimiteConexoes,
        }.ConnectionString;

    /// <summary>Variáveis que o container do app recebe: a connection string do .NET e as do libpq.</summary>
    public static Dictionary<string, string> Variaveis(SitesOptions opt, string nome, string senha) => new()
    {
        ["ConnectionStrings__Postgres"] = ConnectionString(opt, nome, senha),
        ["PGHOST"] = opt.PostgresHost,
        ["PGPORT"] = opt.PostgresPorta.ToString(),
        ["PGDATABASE"] = nome,
        ["PGUSER"] = nome,
        ["PGPASSWORD"] = senha,
    };
}

public class PostgresProvisionador(IOptions<SitesOptions> options) : IPostgresProvisionador
{
    private readonly SitesOptions _opt = options.Value;

    // Nome e senha são gerados aqui (DoSlug de um slug já validado, NovaSenha em hex), mas
    // DDL não aceita parâmetro: confere de novo antes de montar o SQL.
    private static void Validar(string nome, string? senha = null)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(nome, "^site_[a-z0-9_]{3,40}$"))
            throw new ProvisionamentoPostgresException("Nome de banco inválido.");
        if (senha is not null && !System.Text.RegularExpressions.Regex.IsMatch(senha, "^[a-f0-9]{32,128}$"))
            throw new ProvisionamentoPostgresException("Senha em formato inesperado.");
    }

    private async Task<NpgsqlConnection> AbrirAsync(CancellationToken ct)
    {
        if (!_opt.PostgresHabilitado)
            throw new ProvisionamentoPostgresException("Postgres não configurado no servidor (defina POSTGRES_SENHA).");
        var conexao = new NpgsqlConnection(_opt.ConexaoAdmin);
        try { await conexao.OpenAsync(ct); }
        catch (Exception e) when (e is NpgsqlException or System.Net.Sockets.SocketException or TimeoutException)
        {
            await conexao.DisposeAsync();
            throw new ProvisionamentoPostgresException($"Postgres inacessível: {e.Message}");
        }
        return conexao;
    }

    private static async Task<T?> Escalar<T>(NpgsqlConnection c, string sql, string nome, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(sql, c);
        cmd.Parameters.AddWithValue("n", nome);
        return (T?)await cmd.ExecuteScalarAsync(ct);
    }

    private static async Task Executar(NpgsqlConnection c, string sql, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(sql, c);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task CriarAsync(string nome, string senha, CancellationToken ct)
    {
        Validar(nome, senha);
        await using var c = await AbrirAsync(ct);
        try
        {
            // Os bancos do sistema aceitam conexão de qualquer usuário por padrão: fecha,
            // para um app não enxergar nem a lista de bancos pelo "postgres".
            await Executar(c, "REVOKE CONNECT ON DATABASE postgres FROM PUBLIC; REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;", ct);

            var existeUsuario = await Escalar<int?>(c, "SELECT 1 FROM pg_roles WHERE rolname = @n", nome, ct) is not null;
            var atributos = $"LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION CONNECTION LIMIT {_opt.PostgresLimiteConexoes} PASSWORD '{senha}'";
            await Executar(c, existeUsuario ? $"ALTER ROLE {nome} WITH {atributos}" : $"CREATE ROLE {nome} WITH {atributos}", ct);

            // CREATE DATABASE não roda dentro de transação — por isso um comando por vez.
            var existeBanco = await Escalar<int?>(c, "SELECT 1 FROM pg_database WHERE datname = @n", nome, ct) is not null;
            if (!existeBanco)
                await Executar(c, $"CREATE DATABASE {nome} OWNER {nome} ENCODING 'UTF8' TEMPLATE template0", ct);
            await Executar(c, $"REVOKE ALL ON DATABASE {nome} FROM PUBLIC", ct);
            await Executar(c, $"GRANT ALL ON DATABASE {nome} TO {nome}", ct);
        }
        catch (ProvisionamentoPostgresException) { throw; }
        catch (NpgsqlException e) { throw new ProvisionamentoPostgresException($"Postgres recusou: {e.Message}"); }
    }

    public async Task TrocarSenhaAsync(string nome, string senha, CancellationToken ct)
    {
        Validar(nome, senha);
        await using var c = await AbrirAsync(ct);
        try { await Executar(c, $"ALTER ROLE {nome} WITH PASSWORD '{senha}'", ct); }
        catch (NpgsqlException e) { throw new ProvisionamentoPostgresException($"Postgres recusou: {e.Message}"); }
    }

    public async Task RecriarBancoAsync(string nome, CancellationToken ct)
    {
        Validar(nome);
        await using var c = await AbrirAsync(ct);
        try
        {
            // Recriar em vez de pg_restore --clean: tabelas que a versão nova criou (e que
            // não estão no dump) também somem.
            await Executar(c, $"DROP DATABASE IF EXISTS {nome} WITH (FORCE)", ct);
            await Executar(c, $"CREATE DATABASE {nome} OWNER {nome} ENCODING 'UTF8' TEMPLATE template0", ct);
            await Executar(c, $"REVOKE ALL ON DATABASE {nome} FROM PUBLIC", ct);
            await Executar(c, $"GRANT ALL ON DATABASE {nome} TO {nome}", ct);
        }
        catch (NpgsqlException e) { throw new ProvisionamentoPostgresException($"Postgres recusou: {e.Message}"); }
    }

    public async Task RemoverAsync(string nome, CancellationToken ct)
    {
        Validar(nome);
        await using var c = await AbrirAsync(ct);
        try
        {
            await Executar(c, $"DROP DATABASE IF EXISTS {nome} WITH (FORCE)", ct);
            await Executar(c, $"DROP ROLE IF EXISTS {nome}", ct);
        }
        catch (NpgsqlException e) { throw new ProvisionamentoPostgresException($"Postgres recusou: {e.Message}"); }
    }
}
