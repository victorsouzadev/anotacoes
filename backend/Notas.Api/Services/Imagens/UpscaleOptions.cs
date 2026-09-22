namespace Notas.Api.Services.Imagens;

/// <summary>
/// Ampliação de foto por modelo de super-resolução, num serviço externo.
/// O provedor padrão é a Replicate, mas o endereço e o modelo são configuráveis
/// para trocar de modelo (ou de serviço compatível) sem mexer em código.
/// </summary>
public class UpscaleOptions
{
    public const string SectionName = "Upscale";

    /// <summary>Token do serviço. Vazio desliga o recurso — e o endpoint diz isso.</summary>
    public string ApiKey { get; set; } = string.Empty;

    public string BaseUrl { get; set; } = "https://api.replicate.com/v1";

    /// <summary>Modelo, no formato dono/nome. A versão fica a cargo do serviço.</summary>
    public string Model { get; set; } = "nightmareai/real-esrgan";

    /// <summary>Teto de espera. Ampliar não é instantâneo, mas ninguém olha um spinner por minutos.</summary>
    public int TimeoutSegundos { get; set; } = 90;

    /// <summary>Teto do arquivo enviado. Acima disso o serviço costuma recusar de qualquer jeito.</summary>
    public int MaxUploadBytes { get; set; } = 8 * 1024 * 1024;

    /// <summary>Ampliações permitidas. Acima de 4× o ganho não paga o tempo.</summary>
    public int MaxEscala { get; set; } = 4;

    /// <summary>
    /// Teto de pixels da imagem de ENTRADA. O modelo roda numa GPU T4 e recusa
    /// acima de 2.096.704 pixels — e a recusa vem só depois de a foto subir. O
    /// cliente reduz antes de enviar; este valor existe pra ele saber até quanto.
    /// </summary>
    public int MaxInputPixels { get; set; } = 2_000_000;
}
