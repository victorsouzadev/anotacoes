using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Hub.Core;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Options;

namespace Hub.Api;

public sealed record OAuthCliente(string Id, string Nome, IReadOnlyList<string> RedirectUris, DateTimeOffset CriadoEm, DateTimeOffset? UltimoUso);

public sealed record OAuthPedido(string Id, string ClientId, string RedirectUri, string CodeChallenge, string? State, string? Scope);

public sealed record OAuthTokens(string AccessToken, string RefreshToken, int ExpiresIn);

/// <summary>
/// Servidor de autorização mínimo do MCP do Cérebro (spec 028), no hub.db. Só hashes SHA-256 de
/// códigos e tokens vão para o banco. Códigos valem 60 s e uma vez; tokens de acesso 1 h; tokens de
/// atualização 30 dias, trocados a cada uso — reusar um já trocado revoga a família inteira.
/// </summary>
public sealed class OAuthStore
{
    public static readonly TimeSpan VidaCodigo = TimeSpan.FromSeconds(60);
    public static readonly TimeSpan VidaPedido = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan VidaAcesso = TimeSpan.FromHours(1);
    public static readonly TimeSpan VidaAtualizacao = TimeSpan.FromDays(30);
    public static readonly TimeSpan ClienteSemUso = TimeSpan.FromHours(24);

    private readonly string _connectionString;
    private readonly TimeProvider _relogio;

    public OAuthStore(IOptions<HubOptions> options, TimeProvider? relogio = null)
    {
        _relogio = relogio ?? TimeProvider.System;
        var dataPath = Path.GetFullPath(options.Value.DataPath);
        Directory.CreateDirectory(dataPath);
        _connectionString = new SqliteConnectionStringBuilder { DataSource = Path.Combine(dataPath, "hub.db"), DefaultTimeout = 30 }.ToString();
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS oauth_clients(id TEXT PRIMARY KEY, nome TEXT NOT NULL, redirect_uris TEXT NOT NULL,
                criado_em TEXT NOT NULL, ultimo_uso TEXT NULL);
            CREATE TABLE IF NOT EXISTS oauth_pedidos(id TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
                code_challenge TEXT NOT NULL, state TEXT NULL, scope TEXT NULL, expira_em TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS oauth_codes(hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, email TEXT NOT NULL,
                code_challenge TEXT NOT NULL, redirect_uri TEXT NOT NULL, expira_em TEXT NOT NULL, usado_em TEXT NULL);
            CREATE TABLE IF NOT EXISTS oauth_tokens(hash TEXT PRIMARY KEY, tipo TEXT NOT NULL, client_id TEXT NOT NULL,
                email TEXT NOT NULL, familia TEXT NOT NULL, expira_em TEXT NOT NULL, revogado_em TEXT NULL, usado_em TEXT NULL);
            CREATE INDEX IF NOT EXISTS ix_oauth_tokens_familia ON oauth_tokens(familia);
            CREATE INDEX IF NOT EXISTS ix_oauth_tokens_client ON oauth_tokens(client_id);
            """;
        cmd.ExecuteNonQuery();
    }

    private DateTimeOffset Agora => _relogio.GetUtcNow();

    private SqliteConnection Open()
    {
        var c = new SqliteConnection(_connectionString);
        c.Open();
        return c;
    }

    public static string Hash(string valor) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(valor))).ToLowerInvariant();

    private static string Aleatorio() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static string Data(DateTimeOffset d) => d.UtcDateTime.ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset LerData(string s) => DateTimeOffset.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);

    /// <summary>
    /// Redirects aceitos: https (qualquer host) ou http só em localhost/127.0.0.1 (clientes nativos).
    /// Sem fragmento, sem esquema estranho.
    /// </summary>
    public static bool RedirectValido(string uri) =>
        Uri.TryCreate(uri, UriKind.Absolute, out var u) && string.IsNullOrEmpty(u.Fragment)
        && (u.Scheme == Uri.UriSchemeHttps || (u.Scheme == Uri.UriSchemeHttp && (u.IsLoopback || u.Host == "localhost")));

    // ---------------------------------------------------------------- clientes

    public OAuthCliente Registrar(string nome, IReadOnlyList<string> redirectUris)
    {
        LimparClientesSemUso();
        var cliente = new OAuthCliente("mcp-" + Aleatorio()[..22], nome, redirectUris, Agora, null);
        using var c = Open();
        Exec(c, null, "INSERT INTO oauth_clients(id, nome, redirect_uris, criado_em) VALUES ($i, $n, $r, $c)",
            ("$i", cliente.Id), ("$n", nome), ("$r", JsonSerializer.Serialize(redirectUris)), ("$c", Data(Agora)));
        return cliente;
    }

    public OAuthCliente? Cliente(string id)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id, nome, redirect_uris, criado_em, ultimo_uso FROM oauth_clients WHERE id = $i";
        cmd.Parameters.AddWithValue("$i", id);
        using var r = cmd.ExecuteReader();
        return r.Read() ? LerCliente(r) : null;
    }

    /// <summary>Clientes que já receberam tokens (os "aplicativos autorizados" da tela).</summary>
    public IReadOnlyList<OAuthCliente> Autorizados()
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            SELECT id, nome, redirect_uris, criado_em, ultimo_uso FROM oauth_clients
            WHERE id IN (SELECT client_id FROM oauth_tokens WHERE revogado_em IS NULL)
            ORDER BY COALESCE(ultimo_uso, criado_em) DESC
            """;
        var lista = new List<OAuthCliente>();
        using var r = cmd.ExecuteReader();
        while (r.Read()) lista.Add(LerCliente(r));
        return lista;
    }

    private static OAuthCliente LerCliente(SqliteDataReader r) => new(
        r.GetString(0), r.GetString(1), JsonSerializer.Deserialize<List<string>>(r.GetString(2)) ?? [],
        LerData(r.GetString(3)), r.IsDBNull(4) ? null : LerData(r.GetString(4)));

    /// <summary>Revoga todos os tokens do cliente e o apaga. Vale na hora (a checagem consulta o banco).</summary>
    public bool Revogar(string clientId)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        Exec(c, tx, "UPDATE oauth_tokens SET revogado_em = $a WHERE client_id = $i AND revogado_em IS NULL", ("$a", Data(Agora)), ("$i", clientId));
        var n = Exec(c, tx, "DELETE FROM oauth_clients WHERE id = $i", ("$i", clientId));
        tx.Commit();
        return n > 0;
    }

    private void LimparClientesSemUso()
    {
        using var c = Open();
        Exec(c, null, """
            DELETE FROM oauth_clients WHERE ultimo_uso IS NULL AND criado_em < $limite
              AND id NOT IN (SELECT client_id FROM oauth_tokens)
            """, ("$limite", Data(Agora - ClienteSemUso)));
        Exec(c, null, "DELETE FROM oauth_pedidos WHERE expira_em < $a", ("$a", Data(Agora)));
        Exec(c, null, "DELETE FROM oauth_codes WHERE expira_em < $a", ("$a", Data(Agora - TimeSpan.FromDays(1))));
    }

    // ---------------------------------------------------------------- autorização

    public OAuthPedido CriarPedido(string clientId, string redirectUri, string codeChallenge, string? state, string? scope)
    {
        var pedido = new OAuthPedido(Aleatorio(), clientId, redirectUri, codeChallenge, state, scope);
        using var c = Open();
        Exec(c, null, """
            INSERT INTO oauth_pedidos(id, client_id, redirect_uri, code_challenge, state, scope, expira_em)
            VALUES ($i, $c, $r, $cc, $s, $sc, $e)
            """, ("$i", pedido.Id), ("$c", clientId), ("$r", redirectUri), ("$cc", codeChallenge),
            ("$s", (object?)state ?? DBNull.Value), ("$sc", (object?)scope ?? DBNull.Value), ("$e", Data(Agora + VidaPedido)));
        return pedido;
    }

    public OAuthPedido? Pedido(string id)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id, client_id, redirect_uri, code_challenge, state, scope FROM oauth_pedidos WHERE id = $i AND expira_em > $a";
        cmd.Parameters.AddWithValue("$i", id);
        cmd.Parameters.AddWithValue("$a", Data(Agora));
        using var r = cmd.ExecuteReader();
        return r.Read()
            ? new(r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3), r.IsDBNull(4) ? null : r.GetString(4), r.IsDBNull(5) ? null : r.GetString(5))
            : null;
    }

    /// <summary>Consome o pedido (uma vez só) e, se aprovado, devolve o código de autorização.</summary>
    public string? Concluir(string pedidoId, bool aprovado, string email)
    {
        var pedido = Pedido(pedidoId);
        if (pedido is null) return null;
        using var c = Open();
        using var tx = c.BeginTransaction();
        if (Exec(c, tx, "DELETE FROM oauth_pedidos WHERE id = $i", ("$i", pedidoId)) == 0) return null;
        string? codigo = null;
        if (aprovado)
        {
            codigo = Aleatorio();
            Exec(c, tx, """
                INSERT INTO oauth_codes(hash, client_id, email, code_challenge, redirect_uri, expira_em)
                VALUES ($h, $c, $e, $cc, $r, $x)
                """, ("$h", Hash(codigo)), ("$c", pedido.ClientId), ("$e", email), ("$cc", pedido.CodeChallenge),
                ("$r", pedido.RedirectUri), ("$x", Data(Agora + VidaCodigo)));
        }
        tx.Commit();
        return codigo ?? "";
    }

    /// <summary>PKCE S256: BASE64URL(SHA256(verifier)) precisa ser igual ao challenge.</summary>
    public static bool PkceValido(string verifier, string challenge)
    {
        if (verifier.Length is < 43 or > 128) return false;
        var calculado = Convert.ToBase64String(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(calculado), Encoding.ASCII.GetBytes(challenge));
    }

    /// <summary>Troca o código por tokens. Código inválido, vencido, já usado, de outro cliente ou com
    /// redirect/verifier diferentes: null (e, se já usado, revoga o que ele gerou).</summary>
    public OAuthTokens? TrocarCodigo(string codigo, string clientId, string redirectUri, string verifier)
    {
        var hash = Hash(codigo);
        using var c = Open();
        using var tx = c.BeginTransaction();
        string email, challenge, redirect, cliente;
        DateTimeOffset expira;
        string? usado;
        using (var cmd = c.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "SELECT client_id, email, code_challenge, redirect_uri, expira_em, usado_em FROM oauth_codes WHERE hash = $h";
            cmd.Parameters.AddWithValue("$h", hash);
            using var r = cmd.ExecuteReader();
            if (!r.Read()) return null;
            (cliente, email, challenge, redirect, expira, usado) =
                (r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3), LerData(r.GetString(4)), r.IsDBNull(5) ? null : r.GetString(5));
        }
        if (usado is not null)
        {
            // Código reapresentado: alguém o interceptou. Revoga a família criada com ele.
            Exec(c, tx, "UPDATE oauth_tokens SET revogado_em = $a WHERE familia = $f AND revogado_em IS NULL", ("$a", Data(Agora)), ("$f", hash));
            tx.Commit();
            return null;
        }
        Exec(c, tx, "UPDATE oauth_codes SET usado_em = $a WHERE hash = $h", ("$a", Data(Agora)), ("$h", hash));
        if (expira < Agora || cliente != clientId || redirect != redirectUri || !PkceValido(verifier, challenge))
        {
            tx.Commit();
            return null;
        }
        var tokens = Emitir(c, tx, clientId, email, familia: hash);
        tx.Commit();
        return tokens;
    }

    /// <summary>Troca o token de atualização por um par novo. Reuso de um já trocado revoga a família.</summary>
    public OAuthTokens? Atualizar(string refreshToken, string clientId)
    {
        var hash = Hash(refreshToken);
        using var c = Open();
        using var tx = c.BeginTransaction();
        string cliente, email, familia;
        DateTimeOffset expira;
        string? revogado, usado;
        using (var cmd = c.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "SELECT client_id, email, familia, expira_em, revogado_em, usado_em FROM oauth_tokens WHERE hash = $h AND tipo = 'refresh'";
            cmd.Parameters.AddWithValue("$h", hash);
            using var r = cmd.ExecuteReader();
            if (!r.Read()) return null;
            (cliente, email, familia, expira, revogado, usado) = (r.GetString(0), r.GetString(1), r.GetString(2), LerData(r.GetString(3)),
                r.IsDBNull(4) ? null : r.GetString(4), r.IsDBNull(5) ? null : r.GetString(5));
        }
        if (usado is not null && revogado is null)
        {
            Exec(c, tx, "UPDATE oauth_tokens SET revogado_em = $a WHERE familia = $f AND revogado_em IS NULL", ("$a", Data(Agora)), ("$f", familia));
            tx.Commit();
            return null;
        }
        if (revogado is not null || usado is not null || expira < Agora || cliente != clientId) return null;
        Exec(c, tx, "UPDATE oauth_tokens SET usado_em = $a WHERE hash = $h", ("$a", Data(Agora)), ("$h", hash));
        var tokens = Emitir(c, tx, clientId, email, familia);
        tx.Commit();
        return tokens;
    }

    private OAuthTokens Emitir(SqliteConnection c, SqliteTransaction tx, string clientId, string email, string familia)
    {
        var acesso = Aleatorio();
        var atualizacao = Aleatorio();
        Exec(c, tx, "INSERT INTO oauth_tokens(hash, tipo, client_id, email, familia, expira_em) VALUES ($h, 'access', $c, $e, $f, $x)",
            ("$h", Hash(acesso)), ("$c", clientId), ("$e", email), ("$f", familia), ("$x", Data(Agora + VidaAcesso)));
        Exec(c, tx, "INSERT INTO oauth_tokens(hash, tipo, client_id, email, familia, expira_em) VALUES ($h, 'refresh', $c, $e, $f, $x)",
            ("$h", Hash(atualizacao)), ("$c", clientId), ("$e", email), ("$f", familia), ("$x", Data(Agora + VidaAtualizacao)));
        Exec(c, tx, "UPDATE oauth_clients SET ultimo_uso = $a WHERE id = $i", ("$a", Data(Agora)), ("$i", clientId));
        return new(acesso, atualizacao, (int)VidaAcesso.TotalSeconds);
    }

    /// <summary>E-mail de quem autorizou, se o token de acesso for válido agora.</summary>
    public string? Validar(string accessToken)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            SELECT email, client_id FROM oauth_tokens
            WHERE hash = $h AND tipo = 'access' AND revogado_em IS NULL AND expira_em > $a
            """;
        cmd.Parameters.AddWithValue("$h", Hash(accessToken));
        cmd.Parameters.AddWithValue("$a", Data(Agora));
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return null;
        var email = r.GetString(0);
        var cliente = r.GetString(1);
        r.Close();
        Exec(c, null, "UPDATE oauth_clients SET ultimo_uso = $a WHERE id = $i", ("$a", Data(Agora)), ("$i", cliente));
        return email;
    }

    /// <summary>RFC 7009: revoga o token (de acesso ou de atualização) e o resto da família.</summary>
    public void RevogarToken(string token)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT familia FROM oauth_tokens WHERE hash = $h";
        cmd.Parameters.AddWithValue("$h", Hash(token));
        if (cmd.ExecuteScalar() is string familia)
            Exec(c, null, "UPDATE oauth_tokens SET revogado_em = $a WHERE familia = $f AND revogado_em IS NULL", ("$a", Data(Agora)), ("$f", familia));
    }

    private static int Exec(SqliteConnection c, SqliteTransaction? tx, string sql, params (string Name, object Value)[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        foreach (var (name, value) in args) cmd.Parameters.AddWithValue(name, value);
        return cmd.ExecuteNonQuery();
    }
}
