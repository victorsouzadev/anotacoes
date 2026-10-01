namespace Notas.Api.Dtos;

/// <summary>Um campo do gerador de moldes, como a tela o descreve: a IA só
/// pode devolver valores para estas chaves.</summary>
public record CampoMoldeDto(string? Chave, string? Rotulo, string? Unidade, double? Min, double? Max, List<string>? Opcoes);

/// <summary>Um tipo de molde que o gerador sabe fazer.</summary>
public record TipoMoldeDto(string? Id, string? Nome, string? Descricao, List<CampoMoldeDto>? Campos);

/// <summary>Uma medida que a pessoa conhece de verdade (ex.: altura = 12 cm):
/// é o que dá escala à foto.</summary>
public record MedidaConhecidaDto(string? Chave, double Valor);

public record AnalisarEmbalagemRequest(string? Imagem, List<TipoMoldeDto>? Tipos, MedidaConhecidaDto? MedidaConhecida);

/// <summary>Tipo reconhecido e valores para os campos dele. Sem IA (ou sem
/// resposta útil), <c>UsouIa=false</c> e <c>Motivo</c> diz por quê.</summary>
public record AnalisarEmbalagemResponse(
    bool UsouIa,
    string? Motivo,
    string? Tipo,
    string? Confianca,
    Dictionary<string, object>? Valores,
    string? Explicacao);
