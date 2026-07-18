using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Dtos;

namespace Notas.Api.Endpoints;

public static class FoldersEndpoints
{
    public static void MapFoldersEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/folders").RequireAuthorization();

        group.MapGet("/", async (ClaimsPrincipal user, AppDbContext db) =>
            await db.Folders.AsNoTracking()
                .Where(f => f.UserId == user.UserId())
                .OrderBy(f => f.Name)
                .Select(f => new FolderDto(f.Id, f.Name, f.CreatedAt))
                .ToListAsync());

        group.MapPost("/", async (FolderUpsertRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var name = req.Name?.Trim() ?? "";
            if (name.Length is 0 or > 100)
                return Results.BadRequest(new { error = "Nome inválido." });
            var folder = new Folder { UserId = user.UserId(), Name = name };
            db.Folders.Add(folder);
            await db.SaveChangesAsync();
            return Results.Created($"/api/folders/{folder.Id}",
                new FolderDto(folder.Id, folder.Name, folder.CreatedAt));
        });

        group.MapPut("/{id}", async (string id, FolderUpsertRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var name = req.Name?.Trim() ?? "";
            if (name.Length is 0 or > 100)
                return Results.BadRequest(new { error = "Nome inválido." });
            var folder = await db.Folders.FirstOrDefaultAsync(f => f.Id == id && f.UserId == user.UserId());
            if (folder is null) return Results.NotFound();
            folder.Name = name;
            await db.SaveChangesAsync();
            return Results.Ok(new FolderDto(folder.Id, folder.Name, folder.CreatedAt));
        });

        group.MapDelete("/{id}", async (string id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var folder = await db.Folders.FirstOrDefaultAsync(f => f.Id == id && f.UserId == user.UserId());
            if (folder is null) return Results.NotFound();

            // Notas da pasta voltam para "sem pasta" e precisam sincronizar essa mudança.
            await db.Notes
                .Where(n => n.FolderId == id)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(n => n.FolderId, (string?)null)
                    .SetProperty(n => n.UpdatedAt, DateTime.UtcNow));

            db.Folders.Remove(folder);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }
}
