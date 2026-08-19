using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Dtos;

namespace Notas.Api.Endpoints;

public static class TasksEndpoints
{
    public static void MapTasksEndpoints(this IEndpointRouteBuilder app)
    {
        var categories = app.MapGroup("/api/tasks/categories").RequireAuthorization();

        // Sempre devolve tudo (sem paginação/since) — escala pessoal, e o cliente (app Android)
        // faz sync completo a cada rodada, não incremental.
        categories.MapGet("/", async (ClaimsPrincipal user, AppDbContext db) =>
            await db.TaskCategories.AsNoTracking()
                .Where(c => c.UserId == user.UserId())
                .OrderBy(c => c.Name)
                .Select(c => ToDto(c))
                .ToListAsync());

        categories.MapPut("/{id}", async (string id, TaskCategoryUpsertRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var name = req.Name?.Trim() ?? "";
            if (name.Length is 0 or > 100)
                return Results.BadRequest(new { error = "Nome inválido." });

            var userId = user.UserId();
            var category = await db.TaskCategories.FirstOrDefaultAsync(c => c.Id == id && c.UserId == userId);
            if (category is null)
            {
                if (await db.TaskCategories.AnyAsync(c => c.Id == id))
                    return Results.Conflict(new { error = "Id em uso." });
                category = new TaskCategory { Id = id, UserId = userId };
                db.TaskCategories.Add(category);
            }
            else if (category.UpdatedAt >= req.UpdatedAt)
            {
                return Results.Ok(ToDto(category));
            }

            category.Name = name;
            category.ColorHex = req.ColorHex;
            category.UpdatedAt = req.UpdatedAt == default ? DateTime.UtcNow : req.UpdatedAt;

            await db.SaveChangesAsync();
            return Results.Ok(ToDto(category));
        });

        categories.MapDelete("/{id}", async (string id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var category = await db.TaskCategories.FirstOrDefaultAsync(c => c.Id == id && c.UserId == user.UserId());
            if (category is null) return Results.NotFound();
            db.TaskCategories.Remove(category);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        var items = app.MapGroup("/api/tasks/items").RequireAuthorization();

        items.MapGet("/", async (ClaimsPrincipal user, AppDbContext db) =>
            await db.TaskItems.AsNoTracking()
                .Where(t => t.UserId == user.UserId())
                .OrderByDescending(t => t.UpdatedAt)
                .Select(t => ToDto(t))
                .ToListAsync());

        items.MapPut("/{id}", async (string id, TaskItemUpsertRequest req, ClaimsPrincipal user, AppDbContext db) =>
            await Upsert(id, req, user, db));

        items.MapDelete("/{id}", async (string id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var task = await db.TaskItems.FirstOrDefaultAsync(t => t.Id == id && t.UserId == user.UserId());
            if (task is null) return Results.NotFound();
            db.TaskItems.Remove(task);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    // Upsert idempotente com last-write-wins por UpdatedAt — mesmo padrão de NotesEndpoints.Upsert.
    // "Mover pra lixeira"/"restaurar" também passam por aqui (o cliente manda DeletedAt setado/nulo).
    private static async Task<IResult> Upsert(string id, TaskItemUpsertRequest req, ClaimsPrincipal user, AppDbContext db)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 64)
            return Results.BadRequest(new { error = "Id inválido." });
        if (string.IsNullOrWhiteSpace(req.Title) || req.Title.Length > 300)
            return Results.BadRequest(new { error = "Título inválido." });

        var userId = user.UserId();

        var categoryId = req.CategoryId;
        if (categoryId is not null &&
            !await db.TaskCategories.AnyAsync(c => c.Id == categoryId && c.UserId == userId))
            categoryId = null;

        var task = await db.TaskItems.FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId);
        var isNew = task is null;
        if (task is null)
        {
            if (await db.TaskItems.AnyAsync(t => t.Id == id))
                return Results.Conflict(new { error = "Id em uso." });
            task = new TaskItem { Id = id, UserId = userId, CreatedAt = req.CreatedAt == default ? DateTime.UtcNow : req.CreatedAt };
            db.TaskItems.Add(task);
        }
        else if (task.UpdatedAt >= req.UpdatedAt)
        {
            return Results.Ok(ToDto(task));
        }

        Apply(task, req, categoryId);

        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException) when (isNew)
        {
            // Duas requisições de sync concorrentes (ex.: retry) tentando criar a MESMA tarefa
            // nova ao mesmo tempo — a perdedora da corrida cai aqui e aplica como update.
            db.Entry(task).State = EntityState.Detached;
            var existing = await db.TaskItems.FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId);
            if (existing is null) throw;
            if (existing.UpdatedAt < req.UpdatedAt)
            {
                Apply(existing, req, categoryId);
                await db.SaveChangesAsync();
            }
            task = existing;
        }
        return Results.Ok(ToDto(task));
    }

    private static void Apply(TaskItem task, TaskItemUpsertRequest req, string? categoryId)
    {
        task.Title = req.Title.Trim();
        task.Description = req.Description;
        task.DueDate = req.DueDate;
        task.Priority = req.Priority;
        task.CategoryId = categoryId;
        task.IsRecurring = req.IsRecurring;
        task.RecurrenceRule = req.RecurrenceRule;
        task.IsCompleted = req.IsCompleted;
        task.CompletedAt = req.CompletedAt;
        task.DeletedAt = req.DeletedAt;
        task.CompletedPomodoros = req.CompletedPomodoros;
        task.Position = req.Position;
        task.LocationLat = req.LocationLat;
        task.LocationLng = req.LocationLng;
        task.LocationRadiusMeters = req.LocationRadiusMeters;
        task.LocationLabel = req.LocationLabel;
        task.Subtasks = req.Subtasks ?? "[]";
        task.UpdatedAt = req.UpdatedAt == default ? DateTime.UtcNow : req.UpdatedAt;
    }

    private static TaskCategoryDto ToDto(TaskCategory c) => new(c.Id, c.Name, c.ColorHex, c.UpdatedAt);

    private static TaskItemDto ToDto(TaskItem t) => new(
        t.Id, t.Title, t.Description, t.DueDate, t.Priority, t.CategoryId, t.IsRecurring, t.RecurrenceRule,
        t.IsCompleted, t.CreatedAt, t.CompletedAt, t.DeletedAt, t.CompletedPomodoros, t.Position,
        t.LocationLat, t.LocationLng, t.LocationRadiusMeters, t.LocationLabel, t.Subtasks, t.UpdatedAt);
}
