namespace Notas.Api.Dtos;

public record ImageProjectMetaDto(string Id, string Name, DateTime CreatedAt, DateTime UpdatedAt);

public record ImageProjectDto(string Id, string Name, string Data,
    DateTime CreatedAt, DateTime UpdatedAt, DateTime? DeletedAt);

public record ImageProjectUpsertRequest(string Id, string Name, string Data,
    DateTime CreatedAt, DateTime UpdatedAt, DateTime? DeletedAt);

/// <summary>Ampliação por IA está ligada? E até que tamanho de foto o modelo aceita?</summary>
public record UpscaleStatusDto(bool Disponivel, int MaxPixelsEntrada);

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
