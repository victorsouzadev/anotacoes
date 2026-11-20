using Microsoft.IdentityModel.Tokens;

namespace Hub.Plugin;

/// <summary>
/// Chaves públicas ES256 do núcleo, lidas do JWKS e guardadas por 5 min. Um <c>kid</c> desconhecido (rotação)
/// força nova leitura, no máximo a cada 30 s. Se o núcleo sair do ar, segue com as chaves que já tinha.
/// </summary>
public sealed class JwksDoNucleo(string url, HttpClient? http = null)
{
    private readonly HttpClient _http = http ?? new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
    private readonly object _trava = new();
    private IReadOnlyList<SecurityKey> _chaves = [];
    private DateTime _lidoEm = DateTime.MinValue;

    public IReadOnlyList<SecurityKey> Chaves(string? kid)
    {
        var agora = DateTime.UtcNow;
        lock (_trava)
        {
            var conhece = kid is null || _chaves.Any(k => k.KeyId == kid);
            if (agora - _lidoEm > TimeSpan.FromMinutes(5) || (!conhece && agora - _lidoEm > TimeSpan.FromSeconds(30)))
            {
                try
                {
                    var json = _http.GetStringAsync(url).GetAwaiter().GetResult();
                    _chaves = new JsonWebKeySet(json).GetSigningKeys().ToList();
                }
                catch (Exception e) when (e is HttpRequestException or TaskCanceledException or ArgumentException) { }
                _lidoEm = agora;
            }
            return _chaves;
        }
    }
}
