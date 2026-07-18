using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Dtos;

namespace Notas.Api.Endpoints;

public static class NotesEndpoints
{
    private const int MaxElementsBytes = 8 * 1024 * 1024;

    public static void MapNotesEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/notes").RequireAuthorization();

        // Sem "since": só metadados de notas vivas (tela de lista).
        // Com "since": delta completo para sync, incluindo tombstones e elements.
        group.MapGet("/", async (ClaimsPrincipal user, AppDbContext db, DateTime? since) =>
        {
            var userId = user.UserId();
            if (since is DateTime s)
            {
                var delta = await db.Notes.AsNoTracking()
                    .Where(n => n.UserId == userId && n.UpdatedAt > s)
                    .OrderBy(n => n.UpdatedAt)
                    .Select(n => new NoteDto(n.Id, n.FolderId, n.Title, n.Elements,
                        n.CreatedAt, n.UpdatedAt, n.DeletedAt))
                    .ToListAsync();
                return Results.Ok(delta);
            }
            var metas = await db.Notes.AsNoTracking()
                .Where(n => n.UserId == userId && n.DeletedAt == null)
                .OrderByDescending(n => n.UpdatedAt)
                .Select(n => new NoteMetaDto(n.Id, n.FolderId, n.Title, n.CreatedAt, n.UpdatedAt))
                .ToListAsync();
            return Results.Ok(metas);
        });

        group.MapGet("/{id}", async (string id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var note = await db.Notes.AsNoTracking()
                .FirstOrDefaultAsync(n => n.Id == id && n.UserId == user.UserId());
            return note is null || note.DeletedAt is not null
                ? Results.NotFound()
                : Results.Ok(ToDto(note));
        });

        group.MapPost("/", (NoteUpsertRequest req, ClaimsPrincipal user, AppDbContext db) =>
            Upsert(req, user, db));

        group.MapPut("/{id}", (string id, NoteUpsertRequest req, ClaimsPrincipal user, AppDbContext db) =>
            Upsert(req with { Id = id }, user, db));

        group.MapDelete("/{id}", async (string id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id && n.UserId == user.UserId());
            if (note is null) return Results.NotFound();
            note.DeletedAt = DateTime.UtcNow;
            note.UpdatedAt = DateTime.UtcNow;
            note.Elements = "[]";
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    // Upsert idempotente com last-write-wins por UpdatedAt: se a cópia do servidor for
    // mais recente, nada é gravado e a versão do servidor volta para o cliente aplicar.
    private static async Task<IResult> Upsert(NoteUpsertRequest req, ClaimsPrincipal user, AppDbContext db)
    {
        if (string.IsNullOrWhiteSpace(req.Id) || req.Id.Length > 64)
            return Results.BadRequest(new { error = "Id inválido." });
        if ((req.Title?.Length ?? 0) > 300)
            return Results.BadRequest(new { error = "Título muito longo." });
        if ((req.Elements?.Length ?? 0) > MaxElementsBytes)
            return Results.Json(new { error = "Nota muito grande." }, statusCode: 413);

        var userId = user.UserId();

        var folderId = req.FolderId;
        if (folderId is not null &&
            !await db.Folders.AnyAsync(f => f.Id == folderId && f.UserId == userId))
            folderId = null;

        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == req.Id && n.UserId == userId);
        var isNew = note is null;
        if (note is null)
        {
            if (await db.Notes.AnyAsync(n => n.Id == req.Id))
                return Results.Conflict(new { error = "Id em uso." });
            note = new Note
            {
                Id = req.Id,
                UserId = userId,
                CreatedAt = req.CreatedAt == default ? DateTime.UtcNow : req.CreatedAt,
            };
            db.Notes.Add(note);
        }
        else if (note.UpdatedAt >= req.UpdatedAt)
        {
            return Results.Ok(ToDto(note));
        }

        note.FolderId = folderId;
        note.Title = req.Title ?? "";
        note.Elements = req.Elements ?? "[]";
        note.UpdatedAt = req.UpdatedAt == default ? DateTime.UtcNow : req.UpdatedAt;
        note.DeletedAt = req.DeletedAt;
        if (note.DeletedAt is not null) note.Elements = "[]";

        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException) when (isNew)
        {
            // Duas requisições de sync concorrentes (autosave + retry) podem tentar criar
            // a MESMA nota nova ao mesmo tempo — a perdedora da corrida cai aqui. Em vez
            // de propagar 500, trata como se a nota já existisse e aplica como update.
            db.Entry(note).State = EntityState.Detached;
            var existing = await db.Notes.FirstOrDefaultAsync(n => n.Id == req.Id && n.UserId == userId);
            if (existing is null) throw;
            if (existing.UpdatedAt < req.UpdatedAt)
            {
                existing.FolderId = folderId;
                existing.Title = req.Title ?? "";
                existing.Elements = req.Elements ?? "[]";
                existing.UpdatedAt = req.UpdatedAt == default ? DateTime.UtcNow : req.UpdatedAt;
                existing.DeletedAt = req.DeletedAt;
                if (existing.DeletedAt is not null) existing.Elements = "[]";
                await db.SaveChangesAsync();
            }
            note = existing;
        }
        return Results.Ok(ToDto(note));
    }

    private static NoteDto ToDto(Note n) =>
        new(n.Id, n.FolderId, n.Title, n.Elements, n.CreatedAt, n.UpdatedAt, n.DeletedAt);

    public static string UserId(this ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? user.FindFirstValue("sub")
        ?? throw new InvalidOperationException("Token sem sub");
}
