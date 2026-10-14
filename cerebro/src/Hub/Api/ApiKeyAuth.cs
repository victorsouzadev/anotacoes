using System.Security.Cryptography;
using System.Text;
using Hub.Core;
using Microsoft.Extensions.Options;

namespace Hub.Api;

/// <summary>
/// API keys por fonte. Em memória ficam só os hashes; a comparação é em tempo constante.
/// </summary>
public sealed class ApiKeyAuth
{
    private readonly List<(string Name, byte[] Hash)> _keys;
    private readonly byte[]? _mcpHash;

    public ApiKeyAuth(IOptions<HubOptions> options)
    {
        _keys = options.Value.ApiKeys
            .Where(kv => !string.IsNullOrWhiteSpace(kv.Value))
            .Select(kv => (kv.Key, Hash(kv.Value)))
            .ToList();
        _mcpHash = string.IsNullOrWhiteSpace(options.Value.McpToken) ? null : Hash(options.Value.McpToken);
    }

    public bool HasKeys => _keys.Count > 0;
    public bool McpEnabled => _mcpHash is not null;

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
        foreach (var (name, expected) in _keys)
            if (CryptographicOperations.FixedTimeEquals(hash, expected)) found = name;
        return found;
    }

    public bool AuthenticateMcp(HttpContext http)
    {
        if (_mcpHash is null) return false;
        var auth = http.Request.Headers.Authorization.FirstOrDefault();
        string? token = auth?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true ? auth[7..].Trim() : null;
        token ??= http.Request.Query["key"].FirstOrDefault();
        return !string.IsNullOrEmpty(token) && CryptographicOperations.FixedTimeEquals(Hash(token), _mcpHash);
    }

    private static byte[] Hash(string value) => SHA256.HashData(Encoding.UTF8.GetBytes(value));
}
