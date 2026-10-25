namespace Notas.Api.Data;

/// <summary>
/// Configuração do Estúdio de um usuário: chaves do fal.ai e da World Labs (cifradas, como as
/// de IA — ver IProtetorDeSegredos) e o teto de gasto. Uma linha por usuário.
/// </summary>
public class EstudioConfig
{
    public string UserId { get; set; } = "";
    public string? ChaveFalCifrada { get; set; }
    public string? ChaveFalSufixo { get; set; }
    public string? ChaveWorldLabsCifrada { get; set; }
    public string? ChaveWorldLabsSufixo { get; set; }
    /// <summary>Teto de gasto estimado por mês, em centavos de dólar. Null = sem teto.</summary>
    public int? LimiteMensalCentavos { get; set; }
    /// <summary>Acima disso (centavos), o MCP pede confirmação antes de gerar.</summary>
    public int ConfirmarAcimaCentavos { get; set; } = 100;
    public DateTime AtualizadoEm { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Arquivo do Estúdio: o que o usuário enviou e o que as gerações devolveram. O conteúdo fica
/// em disco (Estudio:Raiz), não no banco — vídeo e modelo 3D não cabem num campo de texto.
/// </summary>
public class EstudioMidia
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    /// <summary>imagem, video, audio, modelo3d, mundo ou outro.</summary>
    public string Tipo { get; set; } = "";
    public string Nome { get; set; } = "";
    public string ContentType { get; set; } = "";
    /// <summary>Caminho relativo à raiz do Estúdio.</summary>
    public string Arquivo { get; set; } = "";
    public long Tamanho { get; set; }
    public int? Largura { get; set; }
    public int? Altura { get; set; }
    public double? DuracaoSeg { get; set; }
    /// <summary>upload, geracao, quadro, montagem, editor…</summary>
    public string Origem { get; set; } = "";
    public string? JobId { get; set; }
    public string? ModeloId { get; set; }
    public string? Prompt { get; set; }
    /// <summary>Pasta livre para organizar a biblioteca.</summary>
    public string? Pasta { get; set; }
    public bool Favorito { get; set; }
    /// <summary>Miniatura JPEG em data URL (gerada pelo ffmpeg ou enviada pela tela).</summary>
    public string? Thumb { get; set; }
    /// <summary>Endereço do mesmo arquivo no armazenamento do fal, para não reenviar a cada geração.</summary>
    public string? FalUrl { get; set; }
    public DateTime? FalUrlEm { get; set; }
    public DateTime CriadoEm { get; set; } = DateTime.UtcNow;
    public DateTime? DeletedAt { get; set; }
}

/// <summary>Uma geração (ou montagem local) do Estúdio, da fila até o resultado.</summary>
public class EstudioJob
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    /// <summary>Ferramenta que pediu (criar-imagem, criar-video, palco…) — só para o histórico de cada tela.</summary>
    public string App { get; set; } = "";
    public string ModeloId { get; set; } = "";
    public string Operacao { get; set; } = "";
    /// <summary>fal, worldlabs ou local (ffmpeg).</summary>
    public string Provedor { get; set; } = "";
    public string Endpoint { get; set; } = "";
    /// <summary>fila, rodando, concluido, falhou ou cancelado.</summary>
    public string Status { get; set; } = "fila";
    public string Parametros { get; set; } = "{}";
    /// <summary>Ids de mídia por entrada: {"imagens":["…"],"imagem":["…"]}.</summary>
    public string Entradas { get; set; } = "{}";
    /// <summary>Ids das mídias geradas, em ordem.</summary>
    public string Resultado { get; set; } = "[]";
    /// <summary>Etapas extras depois do provedor (ex.: "trocar-fundo" junta o vídeo sem fundo ao novo fundo).</summary>
    public string? Pipeline { get; set; }
    public string? RequestId { get; set; }
    public string? StatusUrl { get; set; }
    public string? ResponseUrl { get; set; }
    public string? CancelUrl { get; set; }
    public int? PosicaoFila { get; set; }
    public string? Mensagem { get; set; }
    public string? Erro { get; set; }
    public double CustoEstimadoCentavos { get; set; }
    /// <summary>Endereço para abrir o resultado fora (ex.: o mundo no site da World Labs).</summary>
    public string? LinkExterno { get; set; }
    public int Tentativas { get; set; }
    public DateTime? ProximaConsulta { get; set; }
    public DateTime CriadoEm { get; set; } = DateTime.UtcNow;
    public DateTime AtualizadoEm { get; set; } = DateTime.UtcNow;
    public DateTime? ConcluidoEm { get; set; }
    /// <summary>Escondido do histórico (o resultado continua na biblioteca).</summary>
    public bool Oculto { get; set; }
}

/// <summary>
/// Documento de uma ferramenta do Estúdio que não é geração: storyboard, moodboard, cena do
/// palco 3D ou linha do tempo do editor de vídeo. JSON opaco para o servidor, como os projetos
/// do editor de imagens — evoluir a tela não exige migration.
/// </summary>
public class EstudioQuadro
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    /// <summary>storyboard, moodboard, cena ou timeline.</summary>
    public string Tipo { get; set; } = "";
    public string Nome { get; set; } = "";
    public string Data { get; set; } = "{}";
    public string? Thumb { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}
