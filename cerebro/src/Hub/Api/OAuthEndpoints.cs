using System.Security.Claims;
using System.Text.Json.Serialization;
using Hub.Core;
using Microsoft.Extensions.Options;

namespace Hub.Api;

public sealed record OAuthRegistroDto(
    [property: JsonPropertyName("client_name")] string? ClientName,
    [property: JsonPropertyName("redirect_uris")] List<string>? RedirectUris);

public sealed record OAuthConsentimentoDto(string Pedido, bool Aprovar);

/// <summary>
/// OAuth 2.1 do MCP do Cérebro (spec 028), seguindo a autorização do MCP: metadata do recurso
/// (RFC 9728) e do servidor (RFC 8414), registro dinâmico (RFC 7591), código com PKCE S256 e
/// revogação (RFC 7009). O consentimento é a página /autorizar do hub, com o login único e só para
/// os e-mails de CEREBRO_USUARIOS. O token estático do MCP continua valendo.
/// </summary>
public static class OAuthEndpoints
{
    public const string Escopo = "cerebro";

    /// <summary>Endereço público visto pelo cliente (o Caddy repassa o Host; o HTTPS vem do proxy).</summary>
    public static string Base(HttpRequest r)
    {
        var proto = r.Headers["X-Forwarded-Proto"].FirstOrDefault() ?? r.Scheme;
        return $"{proto}://{r.Host}";
    }

    public static string Recurso(HttpRequest r) => Base(r) + "/cerebro/mcp";
    public static string MetadataDoRecurso(HttpRequest r) => Base(r) + "/.well-known/oauth-protected-resource/cerebro/mcp";

    public static void MapOAuth(this WebApplication app, WebOptions web)
    {
        // Metadata: atendidas com e sem o sufixo, porque clientes diferentes procuram em lugares diferentes.
        IResult Recurso_(HttpRequest r) => Results.Json(new
        {
            resource = Recurso(r),
            authorization_servers = new[] { Base(r) + "/cerebro" },
            bearer_methods_supported = new[] { "header" },
            scopes_supported = new[] { Escopo },
        });
        IResult Servidor(HttpRequest r)
        {
            var b = Base(r) + "/cerebro";
            return Results.Json(new
            {
                issuer = b,
                authorization_endpoint = b + "/oauth/authorize",
                token_endpoint = b + "/oauth/token",
                registration_endpoint = b + "/oauth/register",
                revocation_endpoint = b + "/oauth/revoke",
                response_types_supported = new[] { "code" },
                grant_types_supported = new[] { "authorization_code", "refresh_token" },
                code_challenge_methods_supported = new[] { "S256" },
                token_endpoint_auth_methods_supported = new[] { "none" },
                scopes_supported = new[] { Escopo },
            });
        }
        app.MapGet("/.well-known/oauth-protected-resource", Recurso_);
        app.MapGet("/.well-known/oauth-protected-resource/cerebro/mcp", Recurso_);
        app.MapGet("/.well-known/oauth-authorization-server", Servidor);
        app.MapGet("/.well-known/oauth-authorization-server/cerebro", Servidor);

        var oauth = app.MapGroup("/oauth").RequireRateLimiting("api");

        oauth.MapPost("/register", (OAuthRegistroDto dto, OAuthStore store) =>
        {
            var uris = (dto.RedirectUris ?? []).Select(u => u.Trim()).Where(u => u.Length > 0).Distinct().ToList();
            if (uris.Count is 0 or > 5 || !uris.All(OAuthStore.RedirectValido))
                return Results.Json(new { error = "invalid_redirect_uri", error_description = "redirect_uris precisam ser https (ou http em localhost)." }, statusCode: 400);
            var nome = string.IsNullOrWhiteSpace(dto.ClientName) ? "Cliente MCP" : dto.ClientName.Trim();
            if (nome.Length > 100) nome = nome[..100];
            var c = store.Registrar(nome, uris);
            return Results.Json(new
            {
                client_id = c.Id,
                client_name = c.Nome,
                redirect_uris = c.RedirectUris,
                grant_types = new[] { "authorization_code", "refresh_token" },
                response_types = new[] { "code" },
                token_endpoint_auth_method = "none",
            }, statusCode: 201);
        });

        oauth.MapGet("/authorize", (HttpRequest r, OAuthStore store) =>
        {
            var q = r.Query;
            var clientId = q["client_id"].FirstOrDefault() ?? "";
            var redirect = q["redirect_uri"].FirstOrDefault() ?? "";
            var cliente = store.Cliente(clientId);
            // Cliente ou redirect desconhecidos: não redireciona para lugar nenhum (evita open redirect).
            if (cliente is null) return Results.BadRequest("Cliente OAuth desconhecido. Remova e adicione o conector de novo.");
            if (!cliente.RedirectUris.Contains(redirect)) return Results.BadRequest("redirect_uri diferente do registrado.");

            var state = q["state"].FirstOrDefault();
            string Erro(string codigo, string descricao) =>
                QueryString(redirect, ("error", codigo), ("error_description", descricao), ("state", state));
            if (q["response_type"].FirstOrDefault() != "code") return Results.Redirect(Erro("unsupported_response_type", "Só response_type=code."));
            var challenge = q["code_challenge"].FirstOrDefault() ?? "";
            if (q["code_challenge_method"].FirstOrDefault() != "S256" || challenge.Length is < 43 or > 128)
                return Results.Redirect(Erro("invalid_request", "PKCE S256 obrigatório."));
            var pedido = store.CriarPedido(clientId, redirect, challenge, state, q["scope"].FirstOrDefault());
            return Results.Redirect($"{Base(r)}/autorizar?pedido={Uri.EscapeDataString(pedido.Id)}");
        });

        oauth.MapPost("/token", async (HttpRequest r, OAuthStore store) =>
        {
            if (!r.HasFormContentType) return Erro("invalid_request", "Use application/x-www-form-urlencoded.");
            var f = await r.ReadFormAsync();
            var clientId = f["client_id"].FirstOrDefault() ?? "";
            OAuthTokens? t = f["grant_type"].FirstOrDefault() switch
            {
                "authorization_code" => store.TrocarCodigo(f["code"].FirstOrDefault() ?? "", clientId,
                    f["redirect_uri"].FirstOrDefault() ?? "", f["code_verifier"].FirstOrDefault() ?? ""),
                "refresh_token" => store.Atualizar(f["refresh_token"].FirstOrDefault() ?? "", clientId),
                _ => null,
            };
            if (t is null) return Erro("invalid_grant", "Código ou token inválido, vencido ou já usado.");
            r.HttpContext.Response.Headers.CacheControl = "no-store";
            return Results.Json(new
            {
                access_token = t.AccessToken,
                token_type = "Bearer",
                expires_in = t.ExpiresIn,
                refresh_token = t.RefreshToken,
                scope = Escopo,
            });
        });

        oauth.MapPost("/revoke", async (HttpRequest r, OAuthStore store) =>
        {
            if (r.HasFormContentType && (await r.ReadFormAsync())["token"].FirstOrDefault() is { Length: > 0 } token)
                store.RevogarToken(token);
            return Results.Ok();
        });

        // Tela do hub (login único): a página /autorizar e "Aplicativos autorizados" em Conectar.
        var tela = app.MapGroup("/api/v1/web/oauth").RequireAuthorization(WebEndpoints.Policy);

        tela.MapGet("/pedido/{id}", (string id, OAuthStore store) =>
        {
            var p = store.Pedido(id);
            var c = p is null ? null : store.Cliente(p.ClientId);
            if (p is null || c is null) return Results.NotFound(new { error = "Pedido de autorização vencido. Volte ao aplicativo e tente de novo." });
            return Results.Ok(new { cliente = c.Nome, redirect_host = new Uri(p.RedirectUri).Host });
        });

        tela.MapPost("/consentir", (OAuthConsentimentoDto dto, ClaimsPrincipal user, OAuthStore store) =>
        {
            var p = store.Pedido(dto.Pedido);
            var email = user.FindFirst("email")?.Value;
            if (p is null || email is null) return Results.NotFound(new { error = "Pedido de autorização vencido. Volte ao aplicativo e tente de novo." });
            var codigo = store.Concluir(p.Id, dto.Aprovar, email);
            if (codigo is null) return Results.NotFound(new { error = "Pedido já usado." });
            var redirect = dto.Aprovar
                ? QueryString(p.RedirectUri, ("code", codigo), ("state", p.State))
                : QueryString(p.RedirectUri, ("error", "access_denied"), ("error_description", "Acesso recusado."), ("state", p.State));
            return Results.Ok(new { redirect });
        });

        tela.MapGet("/clientes", (OAuthStore store) => Results.Ok(store.Autorizados().Select(c => new
        {
            id = c.Id, nome = c.Nome, criado_em = c.CriadoEm, ultimo_uso = c.UltimoUso,
            redirect = c.RedirectUris.Select(u => new Uri(u).Host).Distinct(),
        })));

        tela.MapDelete("/clientes/{id}", (string id, OAuthStore store) =>
            store.Revogar(id) ? Results.NoContent() : Results.NotFound());
    }

    private static IResult Erro(string codigo, string descricao) =>
        Results.Json(new { error = codigo, error_description = descricao }, statusCode: 400);

    private static string QueryString(string uri, params (string Nome, string? Valor)[] pares)
    {
        var partes = pares.Where(p => p.Valor is not null).Select(p => $"{p.Nome}={Uri.EscapeDataString(p.Valor!)}");
        return uri + (uri.Contains('?') ? "&" : "?") + string.Join('&', partes);
    }
}
