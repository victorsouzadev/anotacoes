namespace Notas.Api.Services.Financas.Llm;

public class AnthropicOptions
{
    public const string SectionName = "Anthropic";

    public string ApiKey { get; set; } = string.Empty;
    public string Model { get; set; } = "claude-sonnet-5";
    public string ApiVersion { get; set; } = "2023-06-01";
    public string BaseUrl { get; set; } = "https://api.anthropic.com/v1/messages";
    public int MaxTokens { get; set; } = 1024;

    // O padrão do HttpClient (100s) deixaria o usuário olhando um spinner por um
    // minuto e meio antes de qualquer erro.
    public int TimeoutSegundos { get; set; } = 20;

    // Quantas tentativas extras em caso de erro transitório (429/5xx/timeout).
    public int MaxTentativas { get; set; } = 2;
}
