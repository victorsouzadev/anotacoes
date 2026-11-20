using System.Net.Mail;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Auth;
using Notas.Api.Data;
using Notas.Api.Dtos;

namespace Notas.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        // Chaves públicas do núcleo (spec 030): plug-ins validam os tokens por aqui, sem segredo nenhum.
        app.MapGet("/.well-known/jwks.json", (ChavesDeAssinatura chaves, HttpContext ctx) =>
        {
            ctx.Response.Headers.CacheControl = "public, max-age=300";
            return Results.Json(chaves.Jwks());
        });

        var group = app.MapGroup("/api/auth").RequireRateLimiting("auth");

        // Troca do token do hub por um token com aud=<plug-in> (spec 030), só para plug-in registrado (029).
        group.MapPost("/token-plugin", async (TokenPluginRequest req, ClaimsPrincipal quem, AppDbContext db, TokenService tokens) =>
        {
            var id = req.Plugin?.Trim() ?? "";
            if (!await db.PluginsEstado.AnyAsync(p => p.Id == id))
                return Results.NotFound(new { error = "Plug-in não registrado." });
            var sub = quem.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub) ?? quem.FindFirstValue(ClaimTypes.NameIdentifier);
            var email = quem.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Email) ?? quem.FindFirstValue(ClaimTypes.Email);
            if (sub is null || email is null) return Results.Unauthorized();
            return Results.Ok(new
            {
                access_token = tokens.CreateAccessToken(sub, email, id),
                expires_in = (int)TokenService.AccessTokenLifetime.TotalSeconds,
            });
        }).RequireAuthorization();

        group.MapPost("/register", async (RegisterRequest req, AppDbContext db, TokenService tokens) =>
        {
            var email = req.Email?.Trim().ToLowerInvariant() ?? "";
            if (!IsValidEmail(email))
                return Results.BadRequest(new { error = "E-mail inválido." });
            if (string.IsNullOrEmpty(req.Password) || req.Password.Length < 8)
                return Results.BadRequest(new { error = "A senha deve ter pelo menos 8 caracteres." });
            if (await db.Users.AnyAsync(u => u.Email == email))
                return Results.Conflict(new { error = "E-mail já cadastrado." });

            var user = new User
            {
                Email = email,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password, workFactor: 11),
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            return Results.Created($"/api/users/{user.Id}", await IssueTokens(user, db, tokens));
        });

        group.MapPost("/login", async (LoginRequest req, AppDbContext db, TokenService tokens, ChavesDeAssinatura chaves) =>
        {
            var email = req.Email?.Trim().ToLowerInvariant() ?? "";
            var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
            // Sem selo do núcleo a linha foi gravada por fora (spec 030): mesma resposta de senha errada.
            if (user is null || !Selo.Confere(chaves, user) || !BCrypt.Net.BCrypt.Verify(req.Password ?? "", user.PasswordHash))
                return Results.Json(new { error = "E-mail ou senha incorretos." }, statusCode: 401);
            return Results.Ok(await IssueTokens(user, db, tokens));
        });

        group.MapPost("/refresh", async (RefreshRequest req, AppDbContext db, TokenService tokens, ChavesDeAssinatura chaves) =>
        {
            var hash = TokenService.HashToken(req.RefreshToken ?? "");
            var stored = await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash);
            if (stored is null || !Selo.Confere(chaves, stored))
                return Results.Json(new { error = "Sessão inválida." }, statusCode: 401);

            if (stored.RevokedAt is not null)
            {
                // Reuso de token já rotacionado: possível vazamento — revoga todas as sessões do usuário.
                await db.RefreshTokens
                    .Where(t => t.UserId == stored.UserId && t.RevokedAt == null)
                    .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, DateTime.UtcNow));
                return Results.Json(new { error = "Sessão inválida." }, statusCode: 401);
            }

            if (stored.ExpiresAt < DateTime.UtcNow)
                return Results.Json(new { error = "Sessão expirada." }, statusCode: 401);

            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == stored.UserId);
            if (user is null || !Selo.Confere(chaves, user))
                return Results.Json(new { error = "Sessão inválida." }, statusCode: 401);
            var response = await IssueTokens(user, db, tokens, saveNow: false);
            stored.RevokedAt = DateTime.UtcNow;
            stored.ReplacedBy = TokenService.HashToken(response.RefreshToken);
            await db.SaveChangesAsync();
            return Results.Ok(response);
        });

        group.MapPost("/logout", async (RefreshRequest req, AppDbContext db) =>
        {
            var hash = TokenService.HashToken(req.RefreshToken ?? "");
            await db.RefreshTokens
                .Where(t => t.TokenHash == hash && t.RevokedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, DateTime.UtcNow));
            return Results.NoContent();
        });
    }

    internal static async Task<AuthResponse> IssueTokens(
        User user, AppDbContext db, TokenService tokens, bool saveNow = true)
    {
        var refresh = TokenService.GenerateRefreshToken();
        db.RefreshTokens.Add(new RefreshToken
        {
            UserId = user.Id,
            TokenHash = TokenService.HashToken(refresh),
            ExpiresAt = DateTime.UtcNow.Add(TokenService.RefreshTokenLifetime),
        });
        if (saveNow) await db.SaveChangesAsync();
        return new AuthResponse(
            tokens.CreateAccessToken(user.Id, user.Email),
            refresh,
            new UserDto(user.Id, user.Email));
    }

    private static bool IsValidEmail(string email)
    {
        if (email.Length is < 3 or > 254) return false;
        try { _ = new MailAddress(email); return true; }
        catch { return false; }
    }
}

public record TokenPluginRequest(string? Plugin);
