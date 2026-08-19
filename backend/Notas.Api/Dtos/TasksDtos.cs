using Notas.Api.Data;

namespace Notas.Api.Dtos;

public record TaskCategoryDto(string Id, string Name, string ColorHex, DateTime UpdatedAt);

public record TaskCategoryUpsertRequest(string Name, string ColorHex, DateTime UpdatedAt);

public record TaskItemDto(
    string Id, string Title, string? Description, DateTime? DueDate, TaskPriority Priority,
    string? CategoryId, bool IsRecurring, string? RecurrenceRule, bool IsCompleted,
    DateTime CreatedAt, DateTime? CompletedAt, DateTime? DeletedAt, int CompletedPomodoros,
    int Position, double? LocationLat, double? LocationLng, float? LocationRadiusMeters,
    string? LocationLabel, string Subtasks, DateTime UpdatedAt);

public record TaskItemUpsertRequest(
    string Title, string? Description, DateTime? DueDate, TaskPriority Priority,
    string? CategoryId, bool IsRecurring, string? RecurrenceRule, bool IsCompleted,
    DateTime CreatedAt, DateTime? CompletedAt, DateTime? DeletedAt, int CompletedPomodoros,
    int Position, double? LocationLat, double? LocationLng, float? LocationRadiusMeters,
    string? LocationLabel, string? Subtasks, DateTime UpdatedAt);

public record TaskCommentDto(string Id, string TaskId, string Text, DateTime CreatedAt, DateTime UpdatedAt);

public record TaskCommentUpsertRequest(string Text);

public record TaskAttachmentDto(
    string Id, string TaskId, string FileName, string ContentType, int SizeBytes, DateTime CreatedAt);

public record TaskAttachmentUploadRequest(string FileName, string ContentType, string DataBase64);
