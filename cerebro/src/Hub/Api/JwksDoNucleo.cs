using Microsoft.IdentityModel.Tokens;

namespace Hub.Api;

/// <summary>
/// Chaves públicas ES256 do núcleo (spec 030), lidas de <c>/.well-known/jwks.json</c> e guardadas por 5 min.
/// Um <c>kid</c> desconhecido força nova leitura (rotação), no máximo uma vez a cada 30 s.
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
            var velho = agora - _lidoEm > TimeSpan.FromMinutes(5);
            var podeRelerKid = agora - _lidoEm > TimeSpan.FromSeconds(30);
            if (velho || (!conhece && podeRelerKid))
            {
                try
                {
                    var json = _http.GetStringAsync(url).GetAwaiter().GetResult();
                    _chaves = new JsonWebKeySet(json).GetSigningKeys().ToList();
                }
                catch (Exception e) when (e is HttpRequestException or TaskCanceledException or ArgumentException)
                {
                    // Núcleo fora do ar: segue com as chaves que já tinha.
                }
                _lidoEm = agora;
            }
            return _chaves;
        }
    }
}
