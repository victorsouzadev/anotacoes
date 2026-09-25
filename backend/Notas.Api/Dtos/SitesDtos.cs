namespace Notas.Api.Dtos;

public record CriarSiteRequest(string? Nome, string? Slug);

public record AtivarVersaoRequest(bool RestaurarBanco);

public record VariavelDto(string Chave, string Valor);

public record DeploymentDto(
    string Id,
    int Versao,
    string Tipo,
    string Status,
    bool TemWeb,
    string? RuntimeVersao,
    string? Entrada,
    long TamanhoBytes,
    bool TemBackupBanco,
    DateTime CriadoEm,
    DateTime? TerminadoEm,
    string Log);

public record SiteDto(
    string Id,
    string Slug,
    string Nome,
    string Url,
    bool Parado,
    DateTime CriadoEm,
    DeploymentDto? Atual,
    DeploymentDto? Ultimo);

public record SiteDetalheDto(
    string Id,
    string Slug,
    string Nome,
    string Url,
    bool Parado,
    DateTime CriadoEm,
    string? CurrentDeploymentId,
    List<DeploymentDto> Versoes);
