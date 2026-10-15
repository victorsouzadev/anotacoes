using System.Security.Cryptography;
using System.Text;

namespace Hub.Api;

/// <summary>
/// Autentica API keys, o token do MCP e o login do WebDAV contra o <see cref="AccessStore"/>
/// (tela + .env). A comparação é por hash e em tempo constante.
/// </summary>
public sealed class ApiKeyAuth
{
    private readonly AccessStore _access;

    public ApiKeyAuth(AccessStore access) => _access = access;

    public bool HasKeys => _access.ApiKeys().Count > 0;
    public bool McpEnabled => _access.McpToken is not null;

    /// <summary>Nome da chave (ex.: "celular") se a chave for válida.</summary>
    public string? Authenticate(HttpContext http)
    {
        var provided = http.Request.Headers["X-Api-Key"].FirstOrDefault();
        if (string.IsNullOrEmpty(provided))
        {
            var auth = http.Request.Headers.Authorization.FirstOrDefault();
            if (auth?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true) provided = auth[7..].Trim();
        }
        return Match(provided);
    }

    /// <summary>Para o bookmarklet, que só consegue mandar a chave na URL.</summary>
    public string? AuthenticateQuery(string? key) => Match(key);

    private string? Match(string? provided)
    {
        if (string.IsNullOrEmpty(provided)) return null;
        var hash = Hash(provided);
        string? found = null;
        foreach (var (name, value, _) in _access.ApiKeys())
            if (CryptographicOperations.FixedTimeEquals(hash, Hash(value))) found = name;
        return found;
    }

    public bool AuthenticateMcp(HttpContext http)
    {
        if (_access.McpToken is not { } expected) return false;
        var auth = http.Request.Headers.Authorization.FirstOrDefault();
        string? token = auth?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true ? auth[7..].Trim() : null;
        token ??= http.Request.Query["key"].FirstOrDefault();
        return !string.IsNullOrEmpty(token) && CryptographicOperations.FixedTimeEquals(Hash(token), Hash(expected));
    }

    /// <summary>Basic auth do WebDAV (o Caddy pergunta aqui antes de repassar ao rclone).</summary>
    public bool AuthenticateWebdav(HttpContext http)
    {
        if (_access.Webdav is not { } creds) return false;
        var auth = http.Request.Headers.Authorization.FirstOrDefault();
        if (auth?.StartsWith("Basic ", StringComparison.OrdinalIgnoreCase) != true) return false;
        string decoded;
        try { decoded = Encoding.UTF8.GetString(Convert.FromBase64String(auth[6..].Trim())); }
        catch (FormatException) { return false; }
        var sep = decoded.IndexOf(':');
        if (sep < 0) return false;
        var userOk = CryptographicOperations.FixedTimeEquals(Hash(decoded[..sep]), Hash(creds.User));
        var passOk = CryptographicOperations.FixedTimeEquals(Hash(decoded[(sep + 1)..]), Hash(creds.Pass));
        return userOk & passOk;
    }

    private static byte[] Hash(string value) => SHA256.HashData(Encoding.UTF8.GetBytes(value));
}
