using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Auth;
using Notas.Api.Data;

namespace Notas.Api.Endpoints;

/// <summary>
/// Login da versão desktop: um usuário só, no banco local, sem senha. Só existe
/// quando a API é hospedada pelo programa desktop (que escuta apenas em
/// 127.0.0.1) e exige a chave que o programa passa pra janela a cada abertura —
/// outro processo da máquina não entra só por achar a porta.
/// </summary>
public static class DesktopAuthEndpoints
{
    public const string LocalEmail = "local@editor.desktop";
    public const string KeyHeader = "X-Desktop-Key";

    public static void MapDesktopAuthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/auth/local", async (HttpContext ctx, AppDbContext db, TokenService tokens, IConfiguration config) =>
        {
            if (!ChaveConfere(ctx, config)) return Results.Json(new { error = "Chave do desktop inválida." }, statusCode: 401);
            var user = await db.Users.FirstOrDefaultAsync(u => u.Email == LocalEmail);
            if (user is null)
            {
                user = new User
                {
                    Email = LocalEmail,
                    // Ninguém digita essa senha: o acesso é sempre pela chave do desktop.
                    PasswordHash = BCrypt.Net.BCrypt.HashPassword(Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)), workFactor: 4),
                };
                db.Users.Add(user);
                await db.SaveChangesAsync();
            }
            return Results.Ok(await AuthEndpoints.IssueTokens(user, db, tokens));
        });
    }

    /// <summary>Compara em tempo constante com Desktop:Key da configuração.</summary>
    public static bool ChaveConfere(HttpContext ctx, IConfiguration config)
    {
        var esperada = config["Desktop:Key"];
        var recebida = ctx.Request.Headers[KeyHeader].ToString();
        if (string.IsNullOrEmpty(esperada) || string.IsNullOrEmpty(recebida)) return false;
        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(esperada), Encoding.UTF8.GetBytes(recebida));
    }
}
