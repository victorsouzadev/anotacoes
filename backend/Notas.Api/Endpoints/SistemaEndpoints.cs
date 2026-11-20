using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Notas.Api.Data;
using Notas.Api.Services.Sistema;
using Notas.Api.Services.Sites;

namespace Notas.Api.Endpoints;

/// <summary>Estado do servidor para quem o opera (os e-mails de PUBLICADORES).</summary>
public static class SistemaEndpoints
{
    public static void MapSistemaEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/sistema/backup", async (ClaimsPrincipal user, AppDbContext db, IOptions<SitesOptions> sites,
            IOptions<SistemaOptions> sistema) =>
        {
            var id = user.UserId();
            var email = await db.Users.AsNoTracking().Where(u => u.Id == id).Select(u => u.Email).FirstOrDefaultAsync();
            if (!sites.Value.PodePublicar(email)) return Results.Forbid();
            return Results.Ok(BackupStatus.LerCompleto(sistema.Value, DateTime.UtcNow));
        }).RequireAuthorization();
    }
}
