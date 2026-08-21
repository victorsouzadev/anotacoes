using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Dtos;

namespace Notas.Api.Endpoints;

/// <summary>
/// Projetos do Editor de Imagens. Mesma estratégia das notas: Id vindo do cliente,
/// PUT idempotente com last-write-wins por UpdatedAt e exclusão lógica — o payload
/// é um blob JSON opaco (artes em data URL + parâmetros de contorno e folha).
/// </summary>
public static class ImagemEndpoints
{
    // As artes vão embutidas no JSON, então o teto é maior que o de uma nota,
    // mas ainda abaixo do limite de corpo de requisição do Kestrel (10 MB).
    private const int MaxDataBytes = 9 * 1024 * 1024;

    public static void MapImagemEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/imagens/projetos").RequireAuthorization();

        group.MapGet("/", async (ClaimsPrincipal user, AppDbContext db) =>
        {
            var metas = await db.ImageProjects.AsNoTracking()
                .Where(p => p.UserId == user.UserId() && p.DeletedAt == null)
                .OrderByDescending(p => p.UpdatedAt)
                .Select(p => new ImageProjectMetaDto(p.Id, p.Name, p.CreatedAt, p.UpdatedAt))
                .ToListAsync();
            return Results.Ok(metas);
        });

        group.MapGet("/{id}", async (string id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var project = await db.ImageProjects.AsNoTracking()
                .FirstOrDefaultAsync(p => p.Id == id && p.UserId == user.UserId());
            return project is null || project.DeletedAt is not null
                ? Results.NotFound()
                : Results.Ok(ToDto(project));
        });

        group.MapPut("/{id}", (string id, ImageProjectUpsertRequest req, ClaimsPrincipal user, AppDbContext db) =>
            Upsert(req with { Id = id }, user, db));

        group.MapDelete("/{id}", async (string id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var project = await db.ImageProjects.FirstOrDefaultAsync(p => p.Id == id && p.UserId == user.UserId());
            if (project is null) return Results.NotFound();
            project.DeletedAt = DateTime.UtcNow;
            project.UpdatedAt = DateTime.UtcNow;
            project.Data = "{}"; // libera o espaço das artes já na exclusão
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    private static async Task<IResult> Upsert(ImageProjectUpsertRequest req, ClaimsPrincipal user, AppDbContext db)
    {
        if (string.IsNullOrWhiteSpace(req.Id) || req.Id.Length > 64)
            return Results.BadRequest(new { error = "Id inválido." });
        if ((req.Name?.Length ?? 0) > 300)
            return Results.BadRequest(new { error = "Nome muito longo." });
        if ((req.Data?.Length ?? 0) > MaxDataBytes)
            return Results.Json(new { error = "Projeto muito grande." }, statusCode: 413);

        var userId = user.UserId();
        var project = await db.ImageProjects.FirstOrDefaultAsync(p => p.Id == req.Id && p.UserId == userId);
        var isNew = project is null;
        if (project is null)
        {
            if (await db.ImageProjects.AnyAsync(p => p.Id == req.Id))
                return Results.Conflict(new { error = "Id em uso." });
            project = new ImageProject
            {
                Id = req.Id,
                UserId = userId,
                CreatedAt = req.CreatedAt == default ? DateTime.UtcNow : req.CreatedAt,
            };
            db.ImageProjects.Add(project);
        }
        else if (project.UpdatedAt >= req.UpdatedAt)
        {
            return Results.Ok(ToDto(project));
        }

        Apply(project, req);

        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException) when (isNew)
        {
            // Dois salvamentos concorrentes do mesmo projeto novo: a requisição perdedora
            // cai aqui. Em vez de 500, trata como update do que já foi gravado.
            db.Entry(project).State = EntityState.Detached;
            var existing = await db.ImageProjects.FirstOrDefaultAsync(p => p.Id == req.Id && p.UserId == userId);
            if (existing is null) throw;
            if (existing.UpdatedAt < req.UpdatedAt)
            {
                Apply(existing, req);
                await db.SaveChangesAsync();
            }
            project = existing;
        }
        return Results.Ok(ToDto(project));
    }

    private static void Apply(ImageProject project, ImageProjectUpsertRequest req)
    {
        project.Name = req.Name ?? "";
        project.Data = req.Data ?? "{}";
        project.UpdatedAt = req.UpdatedAt == default ? DateTime.UtcNow : req.UpdatedAt;
        project.DeletedAt = req.DeletedAt;
        if (project.DeletedAt is not null) project.Data = "{}";
    }

    private static ImageProjectDto ToDto(ImageProject p) =>
        new(p.Id, p.Name, p.Data, p.CreatedAt, p.UpdatedAt, p.DeletedAt);
}
