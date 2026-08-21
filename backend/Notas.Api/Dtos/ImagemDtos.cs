namespace Notas.Api.Dtos;

public record ImageProjectMetaDto(string Id, string Name, DateTime CreatedAt, DateTime UpdatedAt);

public record ImageProjectDto(string Id, string Name, string Data,
    DateTime CreatedAt, DateTime UpdatedAt, DateTime? DeletedAt);

public record ImageProjectUpsertRequest(string Id, string Name, string Data,
    DateTime CreatedAt, DateTime UpdatedAt, DateTime? DeletedAt);
