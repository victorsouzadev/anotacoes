namespace Notas.Api.Dtos;

public record RegisterRequest(string Email, string Password);
public record LoginRequest(string Email, string Password);
public record RefreshRequest(string RefreshToken);
public record AuthResponse(string AccessToken, string RefreshToken, UserDto User);
public record UserDto(string Id, string Email);

public record NoteMetaDto(string Id, string? FolderId, string Title,
    DateTime CreatedAt, DateTime UpdatedAt);

public record NoteDto(string Id, string? FolderId, string Title, string Elements,
    DateTime CreatedAt, DateTime UpdatedAt, DateTime? DeletedAt);

public record NoteUpsertRequest(string Id, string? FolderId, string Title, string Elements,
    DateTime CreatedAt, DateTime UpdatedAt, DateTime? DeletedAt);

public record FolderDto(string Id, string Name, DateTime CreatedAt);
public record FolderUpsertRequest(string Name);
