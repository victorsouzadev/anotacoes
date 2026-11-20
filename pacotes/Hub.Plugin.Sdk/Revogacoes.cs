using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Hub.Plugin;

/// <summary>
/// Revogações do núcleo (spec 030): <c>jti</c> de acessos OAuth revogados ainda válidos e os tokens MCP estáticos
/// ativos deste plug-in (só hashes). Lidas de <c>/api/core/revogados</c> a cada 60 s com o segredo de serviço.
/// </summary>
public sealed class RevogacoesDoNucleo(OpcoesDoHub o, HttpClient? http = null)
{
    private readonly HttpClient _http = http ?? new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
    private volatile HashSet<string> _jtis = [];
    private volatile Dictionary<string, (string Usuario, string Email)> _mcp = [];

    public DateTime? AtualizadoEm { get; private set; }

    public bool Revogado(string? jti) => jti is not null && _jtis.Contains(jti);

    /// <summary>Dono do token MCP estático, se ele estiver ativo para este plug-in.</summary>
    public (string Usuario, string Email)? DonoDoTokenMcp(string token)
    {
        var h = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();
        return _mcp.TryGetValue(h, out var d) ? d : null;
    }

    private sealed record Resposta(List<string> Jtis, List<ItemMcp> Mcp);
    private sealed record ItemMcp(string Hash, string Usuario, string Email);

    public async Task Atualizar(CancellationToken ct)
    {
        var segredo = Environment.GetEnvironmentVariable("HUB_SEGREDO_SERVICO");
        if (string.IsNullOrEmpty(segredo)) return;
        using var req = new HttpRequestMessage(HttpMethod.Get, o.Nucleo.TrimEnd('/') + "/api/core/revogados");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", segredo);
        using var r = await _http.SendAsync(req, ct);
        if (!r.IsSuccessStatusCode) return;
        var c = await JsonSerializer.DeserializeAsync<Resposta>(await r.Content.ReadAsStreamAsync(ct),
            new JsonSerializerOptions(JsonSerializerDefaults.Web), ct);
        if (c?.Jtis is null || c.Mcp is null) return;
        _jtis = [.. c.Jtis];
        _mcp = c.Mcp.Where(m => m.Hash is not null).ToDictionary(m => m.Hash, m => (m.Usuario, m.Email));
        AtualizadoEm = DateTime.UtcNow;
    }
}

internal sealed class VigiaDasRevogacoes(RevogacoesDoNucleo r, ILogger<VigiaDasRevogacoes> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try { await r.Atualizar(ct); }
            // Nunca derruba o plug-in: sem a lista nova, valem as revogações que já tinha.
            catch (Exception e) when (e is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                log.LogWarning("Revogações do núcleo indisponíveis: {Erro}", e.Message);
            }
            await Task.Delay(TimeSpan.FromSeconds(60), ct);
        }
    }
}

/// <summary>Esquema "McpDoHub": aceita o token MCP estático (não JWT) gerado em Configurações → Conexões.</summary>
public sealed class TokenMcpHandler(IOptionsMonitor<AuthenticationSchemeOptions> op, ILoggerFactory l, UrlEncoder e,
    RevogacoesDoNucleo revogacoes) : AuthenticationHandler<AuthenticationSchemeOptions>(op, l, e)
{
    public const string Esquema = "McpDoHub";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var h = Request.Headers.Authorization.ToString();
        if (!h.StartsWith("Bearer hub_")) return Task.FromResult(AuthenticateResult.NoResult());
        if (revogacoes.DonoDoTokenMcp(h[7..]) is not { } dono) return Task.FromResult(AuthenticateResult.Fail("token MCP inválido"));
        var id = new ClaimsIdentity([new Claim("sub", dono.Usuario), new Claim("email", dono.Email)], Esquema, "email", null);
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(id), Esquema)));
    }
}
