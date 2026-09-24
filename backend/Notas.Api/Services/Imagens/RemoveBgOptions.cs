namespace Notas.Api.Services.Imagens;

public class RemoveBgOptions
{
    public const string SectionName = "RemoveBg";

    /// <summary>
    /// Modelo oficial da Replicate, chamado pelo nome (models/dono/nome/predictions).
    /// Com <see cref="Version"/> preenchida, a chamada vai por versão — é o jeito
    /// de usar um modelo da comunidade, que não atende pelo nome.
    /// </summary>
    public string Model { get; set; } = "bria/remove-background";

    public string? Version { get; set; }

    /// <summary>Nome do campo da foto na entrada do modelo; cada autor escolhe o seu.</summary>
    public string CampoImagem { get; set; } = "image";

    public string BaseUrl { get; set; } = "https://api.replicate.com/v1";

    public int TimeoutSegundos { get; set; } = 90;

    public int MaxUploadBytes { get; set; } = 6 * 1024 * 1024;
}
