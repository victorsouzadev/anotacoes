using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Services.Auth;

namespace Notas.Api.Endpoints;

public sealed record RegistroOAuthDto(
    [property: JsonPropertyName("client_name")] string? ClientName,
    [property: JsonPropertyName("redirect_uris")] List<string>? RedirectUris);

public sealed record ConsentimentoDto(string Pedido, bool Aprovar);

public sealed record NovoMcpTokenDto(string Plugin);

/// <summary>
/// OAuth do núcleo para os MCPs dos plug-ins (spec 030). As metadata ficam em <c>/.well-known/oauth-*</c> e os
/// endpoints em <c>/api/core/oauth/*</c>. Enquanto o Cérebro não for extraído (spec 033), o Caddy continua
/// mandando <c>/.well-known/oauth-*</c> e <c>/cerebro/oauth/*</c> para o servidor dele: a virada é na 033.
/// </summary>
public static class OAuthNucleoEndpoints
{
    public static string Base(HttpRequest r)
    {
        var proto = (r.Headers["X-Forwarded-Proto"].FirstOrDefault() ?? "").Split(',')[0].Trim().ToLowerInvariant();
        if (proto is not ("http" or "https")) proto = r.Scheme;
        return $"{proto}://{r.Host}";
    }

    /// <summary><c>&lt;base&gt;/&lt;id&gt;/mcp</c> → id, se for de um plug-in registrado.</summary>
    private static async Task<string?> PluginDoRecurso(string? recurso, HttpRequest r, AppDbContext db)
    {
        var prefixo = Base(r) + "/";
        if (recurso is null || !recurso.StartsWith(prefixo) || !recurso.EndsWith("/mcp")) return null;
        var id = recurso[prefixo.Length..^"/mcp".Length];
        return await db.PluginsEstado.AnyAsync(p => p.Id == id) ? id : null;
    }

    public static void MapOAuthNucleoEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/.well-known/oauth-protected-resource/{id}/mcp", async (string id, HttpRequest r, AppDbContext db) =>
            await db.PluginsEstado.AnyAsync(p => p.Id == id)
                ? Results.Json(new
                {
                    resource = $"{Base(r)}/{id}/mcp",
                    authorization_servers = new[] { Base(r) },
                    bearer_methods_supported = new[] { "header" },
                    scopes_supported = new[] { id },
                })
                : Results.NotFound());

        app.MapGet("/.well-known/oauth-authorization-server", (HttpRequest r) =>
        {
            var b = Base(r);
            return Results.Json(new
            {
                issuer = b,
                authorization_endpoint = b + "/api/core/oauth/authorize",
                token_endpoint = b + "/api/core/oauth/token",
                registration_endpoint = b + "/api/core/oauth/register",
                revocation_endpoint = b + "/api/core/oauth/revoke",
                response_types_supported = new[] { "code" },
                grant_types_supported = new[] { "authorization_code", "refresh_token" },
                code_challenge_methods_supported = new[] { "S256" },
                token_endpoint_auth_methods_supported = new[] { "none" },
            });
        });

        var oauth = app.MapGroup("/api/core/oauth").RequireRateLimiting("publico");

        oauth.MapPost("/register", async (RegistroOAuthDto dto, OAuthDoNucleo s) =>
        {
            var uris = (dto.RedirectUris ?? []).Select(u => u.Trim()).Where(u => u.Length > 0).Distinct().ToList();
            if (uris.Count is 0 or > 5 || !uris.All(OAuthDoNucleo.RedirectValido))
                return Results.Json(new { error = "invalid_redirect_uri", error_description = "redirect_uris precisam ser https (ou http em localhost)." }, statusCode: 400);
            var nome = string.IsNullOrWhiteSpace(dto.ClientName) ? "Cliente MCP" : dto.ClientName.Trim();
            var c = await s.Registrar(nome.Length > 100 ? nome[..100] : nome, uris);
            return Results.Json(new
            {
                client_id = c.Id, client_name = c.Nome, redirect_uris = c.Uris(),
                grant_types = new[] { "authorization_code", "refresh_token" }, response_types = new[] { "code" },
                token_endpoint_auth_method = "none",
            }, statusCode: 201);
        });

        oauth.MapGet("/authorize", async (HttpRequest r, OAuthDoNucleo s, AppDbContext db) =>
        {
            var q = r.Query;
            var cliente = await s.Cliente(q["client_id"].FirstOrDefault() ?? "");
            var redirect = q["redirect_uri"].FirstOrDefault() ?? "";
            if (cliente is null) return Results.BadRequest("Cliente OAuth desconhecido. Remova e adicione o conector de novo.");
            if (!cliente.Uris().Contains(redirect)) return Results.BadRequest("redirect_uri diferente do registrado.");
            var state = q["state"].FirstOrDefault();
            string Erro(string codigo, string desc) => Montar(redirect, ("error", codigo), ("error_description", desc), ("state", state));
            if (q["response_type"].FirstOrDefault() != "code") return Results.Redirect(Erro("unsupported_response_type", "Só response_type=code."));
            var challenge = q["code_challenge"].FirstOrDefault() ?? "";
            if (q["code_challenge_method"].FirstOrDefault() != "S256" || challenge.Length is < 43 or > 128)
                return Results.Redirect(Erro("invalid_request", "PKCE S256 obrigatório."));
            if (await PluginDoRecurso(q["resource"].FirstOrDefault(), r, db) is not { } plugin)
                return Results.Redirect(Erro("invalid_target", "resource precisa ser <hub>/<plug-in>/mcp de um plug-in instalado."));
            var p = await s.CriarPedido(cliente.Id, plugin, redirect, challenge, state);
            return Results.Redirect($"{Base(r)}/autorizar?pedido={Uri.EscapeDataString(p.Id)}");
        });

        oauth.MapPost("/token", async (HttpRequest r, OAuthDoNucleo s) =>
        {
            if (!r.HasFormContentType) return ErroJson("invalid_request", "Use application/x-www-form-urlencoded.");
            var f = await r.ReadFormAsync();
            var clientId = f["client_id"].FirstOrDefault() ?? "";
            var t = f["grant_type"].FirstOrDefault() switch
            {
                "authorization_code" => await s.TrocarCodigo(f["code"].FirstOrDefault() ?? "", clientId,
                    f["redirect_uri"].FirstOrDefault() ?? "", f["code_verifier"].FirstOrDefault() ?? ""),
                "refresh_token" => await s.Atualizar(f["refresh_token"].FirstOrDefault() ?? "", clientId),
                _ => null,
            };
            if (t is null) return ErroJson("invalid_grant", "Código ou token inválido, vencido ou já usado.");
            r.HttpContext.Response.Headers.CacheControl = "no-store";
            return Results.Json(new { access_token = t.AccessToken, token_type = "Bearer", expires_in = t.ExpiresIn, refresh_token = t.RefreshToken });
        });

        oauth.MapPost("/revoke", async (HttpRequest r, OAuthDoNucleo s) =>
        {
            if (r.HasFormContentType && (await r.ReadFormAsync())["token"].FirstOrDefault() is { Length: > 0 } token) await s.RevogarToken(token);
            return Results.Ok();
        });

        // Tela do hub: /autorizar e Configurações → Conexões (login do hub).
        var tela = app.MapGroup("/api/core/oauth").RequireAuthorization();
        tela.MapGet("/pedido/{id}", async (string id, OAuthDoNucleo s) =>
        {
            var p = await s.Pedido(id);
            var c = p is null ? null : await s.Cliente(p.ClienteId);
            return p is null || c is null
                ? Results.NotFound(new { error = "Pedido de autorização vencido. Volte ao aplicativo e tente de novo." })
                : Results.Ok(new { cliente = c.Nome, plugin = p.Plugin, redirect_host = new Uri(p.RedirectUri).Host });
        });
        tela.MapPost("/consentir", async (ConsentimentoDto dto, ClaimsPrincipal u, OAuthDoNucleo s) =>
        {
            var p = await s.Pedido(dto.Pedido);
            var (id, email) = (UsuarioId(u), Email(u));
            if (p is null || id is null || email is null) return Results.NotFound(new { error = "Pedido de autorização vencido. Volte ao aplicativo e tente de novo." });
            var codigo = await s.Concluir(p.Id, dto.Aprovar, id, email);
            if (codigo is null) return Results.NotFound(new { error = "Pedido já usado." });
            return Results.Ok(new
            {
                redirect = dto.Aprovar
                    ? Montar(p.RedirectUri, ("code", codigo), ("state", p.State))
                    : Montar(p.RedirectUri, ("error", "access_denied"), ("error_description", "Acesso recusado."), ("state", p.State)),
            });
        });
        tela.MapGet("/clientes", async (ClaimsPrincipal u, OAuthDoNucleo s) => Results.Ok(await s.Autorizados(UsuarioId(u)!)));
        tela.MapDelete("/clientes/{id}", async (string id, ClaimsPrincipal u, OAuthDoNucleo s) =>
        {
            await s.RevogarCliente(id, UsuarioId(u)!);
            return Results.NoContent();
        });

        // Tokens estáticos de MCP por plug-in: o valor aparece uma vez só.
        var mcp = app.MapGroup("/api/core/mcp-tokens").RequireAuthorization();
        mcp.MapGet("", async (ClaimsPrincipal u, AppDbContext db) =>
        {
            var id = UsuarioId(u);
            return Results.Ok(await db.McpTokens.Where(t => t.UsuarioId == id && t.RevogadoEm == null)
                .Select(t => new { t.Id, t.Plugin, t.CriadoEm, t.UltimoUso }).ToListAsync());
        });
        mcp.MapPost("", async (NovoMcpTokenDto dto, ClaimsPrincipal u, AppDbContext db, OAuthDoNucleo s) =>
        {
            if (!await db.PluginsEstado.AnyAsync(p => p.Id == dto.Plugin)) return Results.NotFound(new { error = "Plug-in não registrado." });
            var (linha, token) = await s.CriarMcpToken(dto.Plugin, UsuarioId(u)!, Email(u)!);
            return Results.Ok(new { linha.Id, linha.Plugin, token });
        });
        mcp.MapDelete("/{id}", async (string id, ClaimsPrincipal u, AppDbContext db) =>
        {
            var uid = UsuarioId(u);
            var n = await db.McpTokens.Where(t => t.Id == id && t.UsuarioId == uid && t.RevogadoEm == null)
                .ExecuteUpdateAsync(x => x.SetProperty(t => t.RevogadoEm, DateTime.UtcNow));
            return n > 0 ? Results.NoContent() : Results.NotFound();
        });

        // Plug-ins, a cada 60 s, com o segredo de serviço que o deployer deu a cada um.
        app.MapGet("/api/core/revogados", async (HttpRequest r, AppDbContext db, OAuthDoNucleo s) =>
            await PluginDoServico(r, db) is { } plugin ? Results.Ok(await s.Revogados(plugin)) : Results.Unauthorized());
    }

    /// <summary>Plug-in dono do <c>Authorization: Bearer &lt;HUB_SEGREDO_SERVICO&gt;</c>, comparado pelo hash.</summary>
    public static async Task<string?> PluginDoServico(HttpRequest r, AppDbContext db)
    {
        var h = r.Headers.Authorization.ToString();
        if (!h.StartsWith("Bearer ") || h.Length < 40) return null;
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(h[7..]))).ToLowerInvariant();
        return await db.PluginsEstado.Where(p => p.SegredoServicoHash == hash).Select(p => p.Id).FirstOrDefaultAsync();
    }

    private static string? UsuarioId(ClaimsPrincipal u) =>
        u.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub) ?? u.FindFirstValue(ClaimTypes.NameIdentifier);

    private static string? Email(ClaimsPrincipal u) =>
        u.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Email) ?? u.FindFirstValue(ClaimTypes.Email);

    private static IResult ErroJson(string codigo, string desc) => Results.Json(new { error = codigo, error_description = desc }, statusCode: 400);

    private static string Montar(string uri, params (string Nome, string? Valor)[] pares)
    {
        var partes = pares.Where(p => p.Valor is not null).Select(p => $"{p.Nome}={Uri.EscapeDataString(p.Valor!)}");
        return uri + (uri.Contains('?') ? "&" : "?") + string.Join('&', partes);
    }
}
