namespace Notas.Api.Dtos;

/// <summary>Uma entidade marcada no relato. Inicio e Fim são índices de string do
/// JavaScript (UTF-16); o serviço converte para os índices do Python ao gravar.</summary>
public record EntidadeAnotacaoDto(string Tipo, int Inicio, int Fim, string Texto);

/// <summary>A ferramenta só liga quando o servidor aponta para uma pasta de run local.</summary>
public record EstadoAnotacaoResponse(bool Habilitado, int Pendentes, int Aprovadas);

public record DocumentoAnotacaoResponse(
    string RowId,
    string Texto,
    List<EntidadeAnotacaoDto> Entidades,
    string? Modelo,
    int Pendentes,
    int Aprovadas);

public record DecisaoAnotacaoRequest(List<EntidadeAnotacaoDto>? Entidades, string? Observacao);
