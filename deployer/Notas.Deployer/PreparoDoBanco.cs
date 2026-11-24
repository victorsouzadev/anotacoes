using Npgsql;

namespace Notas.Deployer;

/// <summary>O que já existe do banco de um plug-in (spec 040). Sem senha nem conexão: só sim, não e o dono do schema.</summary>
/// <param name="Conecta">Nulo enquanto faltar o papel ou o arquivo de conexão.</param>
public record PreparoConferido(bool Papel, bool Schema, string? DonoDoSchema, bool Conexao, bool Permissoes, bool? Conecta);

/// <summary>Conferência só de leitura do banco de um plug-in (spec 040, R2 e R3).</summary>
public class PreparoDoBanco(ConfiguracaoPlugins cfg, string containerPostgres, Func<List<string>, TimeSpan, Task<Resultado>> docker,
    Func<string, CancellationToken, Task<bool>> conectar)
{
    public static List<string> ComandoPsql(string container, string banco, string sql) =>
        ["exec", container, "psql", "-U", "postgres", "-d", banco, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql];

    /// <summary>Só recebe id que passou em <see cref="RegrasDoManifesto.IdPermitido"/>: sem aspas nem barra no literal.</summary>
    public static string SqlConferir(string id) => $"""
        SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{id}'),
               coalesce((SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = '{id}'), ''),
               CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{id}') AND to_regclass('nucleo.users') IS NOT NULL
                    THEN has_schema_privilege('{id}', 'nucleo', 'USAGE') AND has_column_privilege('{id}', 'nucleo.users', 'Id', 'REFERENCES')
                    ELSE false END
        """;

    /// <summary>Nulo quando o Postgres não respondeu.</summary>
    public async Task<PreparoConferido?> Conferir(string id, CancellationToken ct)
    {
        if (!RegrasDoManifesto.IdPermitido(id)) throw new ArgumentException("id inválido", nameof(id));
        var r = await docker(ComandoPsql(containerPostgres, "hub", SqlConferir(id)), TimeSpan.FromSeconds(8));
        var c = r.Saida.Trim().Split('|');
        if (r.Codigo != 0 || c.Length != 3) return null;
        var papel = c[0] == "t";
        var dono = c[1].Length > 0 ? c[1] : null;
        var conexao = LerConexao(id);
        bool? conecta = papel && conexao is not null ? await Conecta(id, conexao, ct) : null;
        return new PreparoConferido(papel, dono is not null, dono, conexao is not null, c[2] == "t", conecta);
    }

    private string? LerConexao(string id)
    {
        try { return File.Exists(cfg.ArquivoBanco(id)) && File.ReadAllText(cfg.ArquivoBanco(id)).Trim() is { Length: > 0 } t ? t : null; }
        catch (IOException) { return null; }
    }

    private async Task<bool> Conecta(string id, string conexao, CancellationToken ct)
    {
        try
        {
            // Conexão de outro papel não vale para este plug-in.
            var b = new NpgsqlConnectionStringBuilder(conexao) { Pooling = false, Timeout = 4, CommandTimeout = 4 };
            return b.Username == id && await conectar(b.ConnectionString, ct);
        }
        catch (ArgumentException) { return false; }
    }

    /// <summary>Por TCP, porque o socket local do Postgres não confere senha.</summary>
    public static async Task<bool> ConectarPorTcp(string conexao, CancellationToken ct)
    {
        try
        {
            await using var c = new NpgsqlConnection(conexao);
            await c.OpenAsync(ct);
            return true;
        }
        catch (Exception e) when (e is NpgsqlException or TimeoutException or System.Net.Sockets.SocketException) { return false; }
    }
}
