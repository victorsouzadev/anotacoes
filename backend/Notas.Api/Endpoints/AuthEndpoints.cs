using System.Net.Mail;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Auth;
using Notas.Api.Data;
using Notas.Api.Dtos;

namespace Notas.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").RequireRateLimiting("auth");

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

        group.MapPost("/login", async (LoginRequest req, AppDbContext db, TokenService tokens) =>
        {
            var email = req.Email?.Trim().ToLowerInvariant() ?? "";
            var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
            if (user is null || !BCrypt.Net.BCrypt.Verify(req.Password ?? "", user.PasswordHash))
                return Results.Json(new { error = "E-mail ou senha incorretos." }, statusCode: 401);
            return Results.Ok(await IssueTokens(user, db, tokens));
        });

        group.MapPost("/refresh", async (RefreshRequest req, AppDbContext db, TokenService tokens) =>
        {
            var hash = TokenService.HashToken(req.RefreshToken ?? "");
            var stored = await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash);
            if (stored is null)
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

            var user = await db.Users.FirstAsync(u => u.Id == stored.UserId);
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

    private static async Task<AuthResponse> IssueTokens(
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
