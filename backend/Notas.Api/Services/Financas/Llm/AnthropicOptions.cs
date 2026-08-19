namespace Notas.Api.Services.Financas.Llm;

public class AnthropicOptions
{
    public const string SectionName = "Anthropic";

    public string ApiKey { get; set; } = string.Empty;
    public string Model { get; set; } = "claude-sonnet-5";
    public string ApiVersion { get; set; } = "2023-06-01";
    public string BaseUrl { get; set; } = "https://api.anthropic.com/v1/messages";
    public int MaxTokens { get; set; } = 1024;
}
