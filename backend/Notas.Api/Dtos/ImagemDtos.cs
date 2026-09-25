namespace Notas.Api.Dtos;

public record ImageProjectMetaDto(string Id, string Name, DateTime CreatedAt, DateTime UpdatedAt);

public record ImageProjectDto(string Id, string Name, string Data,
    DateTime CreatedAt, DateTime UpdatedAt, DateTime? DeletedAt);

public record ImageProjectUpsertRequest(string Id, string Name, string Data,
    DateTime CreatedAt, DateTime UpdatedAt, DateTime? DeletedAt);

/// <summary>Ampliação por IA está ligada? E até que tamanho de foto o modelo aceita?</summary>
/// <summary>Ampliação por IA está ligada? Até que tamanho? E a luz por IA (fica
/// de fora na versão desktop, que roda sem internet)?</summary>
public record UpscaleStatusDto(bool Disponivel, int MaxPixelsEntrada, bool Luz = true);

/// <summary>Foto a ampliar, em data URL, e quantas vezes.</summary>
public record UpscaleRequest(string? Imagem, int Escala);

public record UpscaleResponse(string Imagem);

/// <summary>Foto a reiluminar e de onde a luz deve vir.</summary>
public record RelightRequest(string? Imagem, string? Direcao);

public record RemoveBgRequest(string? Imagem);

/// <summary>Miniaturas dos elementos, na ordem em que estão na lista do editor.</summary>
public record NomearElementosRequest(List<string>? Imagens);

/// <summary>Nomes sugeridos; vazio com <c>UsouIa=false</c> quando não deu, e aí
/// <c>Motivo</c> diz o porquê pra tela poder contar em vez de falhar calada.</summary>
public record NomearElementosResponse(IReadOnlyList<string> Nomes, bool UsouIa, string? Motivo);

public record ImageLibraryMetaDto(string Id, string Name, string Origin, string Thumb, double WidthMm, DateTime CreatedAt);

public record ImageLibraryItemDto(string Id, string Name, string Origin, string Data, double WidthMm, DateTime CreatedAt);

public record ImageLibraryUpsertRequest(string? Name, string? Origin, string? Data, string? Thumb, double WidthMm);

public record ImagePreferencesRequest(string? Data);
