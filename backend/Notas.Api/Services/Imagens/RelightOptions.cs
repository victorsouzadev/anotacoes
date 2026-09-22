namespace Notas.Api.Services.Imagens;

public class RelightOptions
{
    public const string SectionName = "Relight";

    /// <summary>
    /// Versão do modelo. Modelo da comunidade na Replicate só atende por versão
    /// — o atalho por nome (models/dono/nome/predictions), que o ampliador usa,
    /// responde 404 aqui. Como a versão é um hash que muda quando o autor
    /// publica, ela fica configurável.
    /// </summary>
    public string Version { get; set; } = "d41bcb10d8c159868f4cfbd7c6a2ca01484f7d39e4613419d5952c61562f1ba7";

    public string BaseUrl { get; set; } = "https://api.replicate.com/v1";

    /// <summary>Difusão leva mais tempo que super-resolução, e há fila.</summary>
    public int TimeoutSegundos { get; set; } = 180;

    /// <summary>
    /// Lado maior da imagem enviada e devolvida. Pequeno de propósito: só a luz
    /// borrada é aproveitada, e pedir grande custaria mais pelo mesmo resultado.
    /// </summary>
    public int Lado { get; set; } = 960;

    public int MaxUploadBytes { get; set; } = 4 * 1024 * 1024;
}
