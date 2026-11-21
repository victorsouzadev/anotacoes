using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Hub.Plugin;

/// <summary>
/// MCP do plug-in (spec 030/032): só o OAuth do núcleo com <c>aud=&lt;id&gt;</c> ou um token MCP estático
/// ("hub_…", Configurações → Conexões). O token de login do hub (<c>aud=notas-vps</c>) não abre o MCP.
/// </summary>
public static class McpDoPlugin
{
    public const string Politica = "mcp-do-plugin";

    /// <summary>Endereço da metadata do recurso, que o núcleo serve (o cliente MCP descobre o OAuth por ela).</summary>
    public static string MetadataDoRecurso(HttpRequest r, Manifesto m)
    {
        var proto = (r.Headers["X-Forwarded-Proto"].FirstOrDefault() ?? "").Split(',')[0].Trim().ToLowerInvariant();
        if (proto is not ("http" or "https")) proto = r.Scheme;
        return $"{proto}://{r.Host}/.well-known/oauth-protected-resource{m.Mcp ?? m.Rota + "/mcp"}";
    }

    /// <summary>Exige a política do MCP no endpoint (ex.: <c>app.MapMcp("/dieta/mcp").ExigirMcpDoPlugin()</c>).</summary>
    public static TBuilder ExigirMcpDoPlugin<TBuilder>(this TBuilder b) where TBuilder : IEndpointConventionBuilder =>
        b.RequireAuthorization(Politica);

    internal static bool Permite(System.Security.Claims.ClaimsPrincipal u, string id) =>
        u.Identity?.IsAuthenticated == true
        && (u.Identity.AuthenticationType == TokenMcpHandler.Esquema || u.FindAll(JwtRegisteredClaimNames.Aud).Any(a => a.Value == id));
}
