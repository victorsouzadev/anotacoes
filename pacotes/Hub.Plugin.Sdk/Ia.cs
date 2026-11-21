using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Http;

namespace Hub.Plugin;

/// <summary>Provedor, modelo e chave de IA do usuário, guardados no núcleo (Configurações → Inteligência artificial).</summary>
public sealed record ConfiguracaoIa(string? Provedor, string? Modelo, string? Chave)
{
    public bool Configurada => !string.IsNullOrWhiteSpace(Provedor) && !string.IsNullOrWhiteSpace(Chave);
}

/// <summary>
/// IA do hub (spec 032): lê <c>/api/core/ia</c> repassando o token do usuário da requisição (<c>aud=&lt;id&gt;</c>).
/// Só vale para plug-ins com <c>usaIa</c> no manifesto, e nunca com o token de serviço: cada usuário, a chave dele.
/// Guarda a resposta em memória por 10 min, por usuário.
/// </summary>
public sealed class IaDoHub(OpcoesDoHub o, HttpClient? http = null)
{
    private readonly HttpClient _http = http ?? new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
    private readonly Dictionary<string, (ConfiguracaoIa Config, DateTime Ate)> _cache = [];
    private readonly Lock _trava = new();

    public static readonly TimeSpan Validade = TimeSpan.FromMinutes(10);

    /// <summary>Null quando o núcleo recusa (token sem <c>aud</c> do plug-in, plug-in sem <c>usaIa</c>) ou está fora do ar.</summary>
    public async Task<ConfiguracaoIa?> ObterConfiguracao(HttpContext ctx, CancellationToken ct = default)
    {
        var h = ctx.Request.Headers.Authorization.ToString();
        if (!h.StartsWith("Bearer ey") || ctx.UsuarioId() is not { } usuario) return null;
        lock (_trava)
            if (_cache.TryGetValue(usuario, out var c) && c.Ate > DateTime.UtcNow) return c.Config;

        using var req = new HttpRequestMessage(HttpMethod.Get, o.Nucleo.TrimEnd('/') + "/api/core/ia");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", h[7..]);
        try
        {
            using var r = await _http.SendAsync(req, ct);
            if (r.StatusCode != HttpStatusCode.OK) return null;
            var config = await r.Content.ReadFromJsonAsync<ConfiguracaoIa>(ct);
            if (config is null) return null;
            lock (_trava) _cache[usuario] = (config, DateTime.UtcNow + Validade);
            return config;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException) { return null; }
    }
}
