namespace Notas.Api.Dtos;

public record ImageProjectMetaDto(string Id, string Name, DateTime CreatedAt, DateTime UpdatedAt);

public record ImageProjectDto(string Id, string Name, string Data,
    DateTime CreatedAt, DateTime UpdatedAt, DateTime? DeletedAt);

public record ImageProjectUpsertRequest(string Id, string Name, string Data,
    DateTime CreatedAt, DateTime UpdatedAt, DateTime? DeletedAt);

/// <summary>Ampliação por IA está ligada neste servidor?</summary>
public record UpscaleStatusDto(bool Disponivel);

/// <summary>Foto a ampliar, em data URL, e quantas vezes.</summary>
public record UpscaleRequest(string? Imagem, int Escala);

public record UpscaleResponse(string Imagem);
