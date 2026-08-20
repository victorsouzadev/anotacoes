using System.Security.Claims;
using System.Text.Json;
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
            var userId = user.UserId();
            var category = await db.TaskCategories.FirstOrDefaultAsync(c => c.Id == id && c.UserId == userId);
            if (category is null) return Results.NotFound();
            db.TaskCategories.Remove(category);

            // CategoryIds é um blob JSON opaco, sem FK — precisa tirar o id apagado manualmente das
            // tarefas que o referenciam (antes era um ON DELETE SET NULL do banco).
            var affected = await db.TaskItems.Where(t => t.UserId == userId && t.CategoryIds.Contains(id)).ToListAsync();
            foreach (var task in affected)
            {
                var ids = ParseCategoryIds(task.CategoryIds);
                if (ids.Remove(id))
                    task.CategoryIds = JsonSerializer.Serialize(ids);
            }

            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        var lanes = app.MapGroup("/api/tasks/kanban-lanes").RequireAuthorization();

        lanes.MapGet("/", async (ClaimsPrincipal user, AppDbContext db) =>
            await db.KanbanLanes.AsNoTracking()
                .Where(l => l.UserId == user.UserId())
                .OrderBy(l => l.Position)
                .Select(l => ToDto(l))
                .ToListAsync());

        lanes.MapPut("/{id}", async (string id, KanbanLaneUpsertRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var name = req.Name?.Trim() ?? "";
            if (name.Length is 0 or > 100)
                return Results.BadRequest(new { error = "Nome inválido." });

            var userId = user.UserId();
            var lane = await db.KanbanLanes.FirstOrDefaultAsync(l => l.Id == id && l.UserId == userId);
            if (lane is null)
            {
                if (await db.KanbanLanes.AnyAsync(l => l.Id == id))
                    return Results.Conflict(new { error = "Id em uso." });
                lane = new KanbanLane { Id = id, UserId = userId };
                db.KanbanLanes.Add(lane);
            }
            else if (lane.UpdatedAt >= req.UpdatedAt)
            {
                return Results.Ok(ToDto(lane));
            }

            lane.Name = name;
            lane.ColorHex = req.ColorHex;
            lane.Position = req.Position;
            lane.UpdatedAt = req.UpdatedAt == default ? DateTime.UtcNow : req.UpdatedAt;

            await db.SaveChangesAsync();
            return Results.Ok(ToDto(lane));
        });

        lanes.MapDelete("/{id}", async (string id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var lane = await db.KanbanLanes.FirstOrDefaultAsync(l => l.Id == id && l.UserId == user.UserId());
            if (lane is null) return Results.NotFound();
            db.KanbanLanes.Remove(lane);
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

        var comments = app.MapGroup("/api/tasks/items/{taskId}/comments").RequireAuthorization();

        comments.MapGet("/", async (string taskId, ClaimsPrincipal user, AppDbContext db) =>
        {
            var userId = user.UserId();
            if (!await db.TaskItems.AnyAsync(t => t.Id == taskId && t.UserId == userId))
                return Results.NotFound();
            var list = await db.TaskComments.AsNoTracking()
                .Where(c => c.TaskId == taskId && c.UserId == userId)
                .OrderBy(c => c.CreatedAt)
                .Select(c => ToDto(c))
                .ToListAsync();
            return Results.Ok(list);
        });

        comments.MapPost("/", async (string taskId, TaskCommentUpsertRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var text = req.Text?.Trim() ?? "";
            if (text.Length is 0 or > 2000)
                return Results.BadRequest(new { error = "Comentário inválido." });

            var userId = user.UserId();
            if (!await db.TaskItems.AnyAsync(t => t.Id == taskId && t.UserId == userId))
                return Results.NotFound();

            var now = DateTime.UtcNow;
            var comment = new TaskComment
            {
                Id = Guid.NewGuid().ToString(),
                UserId = userId,
                TaskId = taskId,
                Text = text,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.TaskComments.Add(comment);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(comment));
        });

        comments.MapDelete("/{commentId}", async (string taskId, string commentId, ClaimsPrincipal user, AppDbContext db) =>
        {
            var userId = user.UserId();
            var comment = await db.TaskComments.FirstOrDefaultAsync(c => c.Id == commentId && c.TaskId == taskId && c.UserId == userId);
            if (comment is null) return Results.NotFound();
            db.TaskComments.Remove(comment);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        var attachments = app.MapGroup("/api/tasks/items/{taskId}/attachments").RequireAuthorization();
        const int maxAttachmentBytes = 5 * 1024 * 1024;

        attachments.MapGet("/", async (string taskId, ClaimsPrincipal user, AppDbContext db) =>
        {
            var userId = user.UserId();
            if (!await db.TaskItems.AnyAsync(t => t.Id == taskId && t.UserId == userId))
                return Results.NotFound();
            var list = await db.TaskAttachments.AsNoTracking()
                .Where(a => a.TaskId == taskId && a.UserId == userId)
                .OrderBy(a => a.CreatedAt)
                .Select(a => ToDto(a))
                .ToListAsync();
            return Results.Ok(list);
        });

        attachments.MapPost("/", async (string taskId, TaskAttachmentUploadRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var fileName = req.FileName?.Trim() ?? "";
            if (fileName.Length is 0 or > 255)
                return Results.BadRequest(new { error = "Nome de arquivo inválido." });
            if (string.IsNullOrWhiteSpace(req.DataBase64))
                return Results.BadRequest(new { error = "Arquivo vazio." });

            byte[] bytes;
            try
            {
                bytes = Convert.FromBase64String(req.DataBase64);
            }
            catch (FormatException)
            {
                return Results.BadRequest(new { error = "Conteúdo inválido." });
            }
            if (bytes.Length == 0 || bytes.Length > maxAttachmentBytes)
                return Results.BadRequest(new { error = "Arquivo deve ter até 5MB." });

            var userId = user.UserId();
            if (!await db.TaskItems.AnyAsync(t => t.Id == taskId && t.UserId == userId))
                return Results.NotFound();

            var attachment = new TaskAttachment
            {
                Id = Guid.NewGuid().ToString(),
                UserId = userId,
                TaskId = taskId,
                FileName = fileName,
                ContentType = string.IsNullOrWhiteSpace(req.ContentType) ? "application/octet-stream" : req.ContentType,
                SizeBytes = bytes.Length,
                DataBase64 = req.DataBase64,
                CreatedAt = DateTime.UtcNow,
            };
            db.TaskAttachments.Add(attachment);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(attachment));
        });

        attachments.MapGet("/{attachmentId}/content", async (string taskId, string attachmentId, ClaimsPrincipal user, AppDbContext db) =>
        {
            var userId = user.UserId();
            var attachment = await db.TaskAttachments.AsNoTracking()
                .FirstOrDefaultAsync(a => a.Id == attachmentId && a.TaskId == taskId && a.UserId == userId);
            if (attachment is null) return Results.NotFound();
            return Results.File(Convert.FromBase64String(attachment.DataBase64), attachment.ContentType, attachment.FileName);
        });

        attachments.MapDelete("/{attachmentId}", async (string taskId, string attachmentId, ClaimsPrincipal user, AppDbContext db) =>
        {
            var userId = user.UserId();
            var attachment = await db.TaskAttachments.FirstOrDefaultAsync(a => a.Id == attachmentId && a.TaskId == taskId && a.UserId == userId);
            if (attachment is null) return Results.NotFound();
            db.TaskAttachments.Remove(attachment);
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

        // Filtra a lista pedida pra só as categorias que existem e pertencem ao usuário — igual ao
        // tratamento de categoryId único de antes, agora aplicado item a item.
        var requestedCategoryIds = (req.CategoryIds ?? []).Distinct().ToList();
        var categoryIds = requestedCategoryIds.Count == 0
            ? new List<string>()
            : await db.TaskCategories
                .Where(c => c.UserId == userId && requestedCategoryIds.Contains(c.Id))
                .Select(c => c.Id)
                .ToListAsync();

        var kanbanLaneId = req.KanbanLaneId;
        if (kanbanLaneId is not null &&
            !await db.KanbanLanes.AnyAsync(l => l.Id == kanbanLaneId && l.UserId == userId))
            kanbanLaneId = null;

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

        Apply(task, req, categoryIds, kanbanLaneId);

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
                Apply(existing, req, categoryIds, kanbanLaneId);
                await db.SaveChangesAsync();
            }
            task = existing;
        }
        return Results.Ok(ToDto(task));
    }

    private static void Apply(TaskItem task, TaskItemUpsertRequest req, List<string> categoryIds, string? kanbanLaneId)
    {
        task.Title = req.Title.Trim();
        task.Description = req.Description;
        task.DueDate = req.DueDate;
        task.Priority = req.Priority;
        task.CategoryIds = JsonSerializer.Serialize(categoryIds);
        task.KanbanLaneId = kanbanLaneId;
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

    private static KanbanLaneDto ToDto(KanbanLane l) => new(l.Id, l.Name, l.ColorHex, l.Position, l.UpdatedAt);

    private static TaskItemDto ToDto(TaskItem t) => new(
        t.Id, t.Title, t.Description, t.DueDate, t.Priority, ParseCategoryIds(t.CategoryIds), t.KanbanLaneId, t.IsRecurring, t.RecurrenceRule,
        t.IsCompleted, t.CreatedAt, t.CompletedAt, t.DeletedAt, t.CompletedPomodoros, t.Position,
        t.LocationLat, t.LocationLng, t.LocationRadiusMeters, t.LocationLabel, t.Subtasks, t.UpdatedAt);

    private static List<string> ParseCategoryIds(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static TaskCommentDto ToDto(TaskComment c) => new(c.Id, c.TaskId, c.Text, c.CreatedAt, c.UpdatedAt);

    private static TaskAttachmentDto ToDto(TaskAttachment a) => new(a.Id, a.TaskId, a.FileName, a.ContentType, a.SizeBytes, a.CreatedAt);
}
