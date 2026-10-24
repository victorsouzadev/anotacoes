using System.Text.Json.Nodes;

namespace Notas.Api.Dtos;

// GET/PUT /api/estudio/config
// As chaves seguem a regra das de IA: null mantém a salva, vazio remove; nunca voltam ao cliente.
public record EstudioConfigRequest(string? ChaveFal, string? ChaveWorldLabs, int? LimiteMensalCentavos, bool? SemLimite, int? ConfirmarAcimaCentavos);

public record EstudioConfigResponse(
    bool FalConfigurada,
    string? FalMascarada,
    bool FalDoServidor,
    bool WorldLabsConfigurada,
    string? WorldLabsMascarada,
    bool WorldLabsDoServidor,
    int? LimiteMensalCentavos,
    int ConfirmarAcimaCentavos,
    double GastoMesCentavos,
    int GeracoesNoMes,
    bool FfmpegDisponivel);

public record MidiaDto(
    string Id, string Tipo, string Nome, string ContentType, string Url, string? Thumb, long Tamanho,
    int? Largura, int? Altura, double? DuracaoSeg, string Origem, string? JobId, string? ModeloId,
    string? Prompt, string? Pasta, bool Favorito, DateTime CriadoEm);

// POST /api/estudio/midias (JSON): data URL ou endereço https. O upload de arquivo vai por multipart.
public record MidiaImportarRequest(string? Nome, string? DataUrl, string? Url, string? Pasta, string? Origem);

public record MidiaAtualizarRequest(string? Nome, string? Pasta, bool? Favorito, string? Thumb);

public record GeracaoRequest(
    string Modelo,
    string Operacao,
    JsonObject? Parametros,
    Dictionary<string, List<string>>? Entradas,
    string? App,
    string? Pipeline);

public record LocalRequest(string Operacao, JsonObject? Parametros, Dictionary<string, List<string>>? Entradas, string? App);

public record JobDto(
    string Id, string App, string ModeloId, string? ModeloNome, string Operacao, string Provedor, string Status,
    string? Mensagem, string? Erro, int? PosicaoFila, double CustoEstimadoCentavos, string? LinkExterno,
    JsonObject Parametros, Dictionary<string, List<string>> Entradas, List<MidiaDto> Resultado,
    DateTime CriadoEm, DateTime? ConcluidoEm);

public record EstimativaResponse(double CustoCentavos, double GastoMesCentavos, int? LimiteMensalCentavos, bool PassaDoLimite);

public record QuadroResumoDto(string Id, string Tipo, string Nome, string? Thumb, DateTime CreatedAt, DateTime UpdatedAt);

public record QuadroDto(string Id, string Tipo, string Nome, string Data, string? Thumb, DateTime CreatedAt, DateTime UpdatedAt);

public record QuadroUpsertRequest(string Tipo, string Nome, string Data, string? Thumb);
