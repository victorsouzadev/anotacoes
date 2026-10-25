namespace Notas.Api.Services.Estudio;

/// <summary>Configuração do Estúdio (seção "Estudio").</summary>
public class EstudioOptions
{
    public const string SectionName = "Estudio";

    /// <summary>Pasta dos arquivos gerados e enviados (imagens, vídeos, áudios, modelos 3D).</summary>
    public string Raiz { get; set; } = "../../data/estudio";

    /// <summary>Chave do fal.ai do servidor, para quem não cadastrou a própria.</summary>
    public string? FalKey { get; set; }

    /// <summary>Chave da World Labs (Marble) do servidor, para quem não cadastrou a própria.</summary>
    public string? WorldLabsKey { get; set; }

    public string FalQueueUrl { get; set; } = "https://queue.fal.run";
    public string FalRestUrl { get; set; } = "https://rest.alpha.fal.ai";
    public string WorldLabsUrl { get; set; } = "https://api.worldlabs.ai";

    /// <summary>Executáveis do ffmpeg e do ffprobe (no PATH por padrão; o desktop aponta para os que leva junto).</summary>
    public string Ffmpeg { get; set; } = "ffmpeg";
    public string Ffprobe { get; set; } = "ffprobe";

    /// <summary>JSON com modelos a mais (ou que substituem os do catálogo embutido), sem recompilar.</summary>
    public string? CatalogoArquivo { get; set; }

    /// <summary>Teto de um arquivo enviado (bytes).</summary>
    public long MaxUploadBytes { get; set; } = 500L * 1024 * 1024;

    /// <summary>Teto de um resultado baixado do provedor (bytes).</summary>
    public long MaxDownloadBytes { get; set; } = 1024L * 1024 * 1024;

    /// <summary>Intervalo entre consultas a uma geração em andamento.</summary>
    public int ConsultaSegundos { get; set; } = 3;

    /// <summary>Serviço que roda as CLIs dos craft apps sem janela (MCP remoto). Vazio = desligado.</summary>
    public string? CraftsMcpUrl { get; set; }

    /// <summary>Pasta com as CLIs dos craft apps para rodá-las aqui mesmo (programa do Windows), no lugar do crafts-mcp.</summary>
    public string? CraftsCliDir { get; set; }

    /// <summary>Desliga o processamento em segundo plano (testes que só olham a fila).</summary>
    public bool WorkerDesligado { get; set; }
}
