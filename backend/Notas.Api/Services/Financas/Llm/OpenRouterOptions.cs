namespace Notas.Api.Services.Financas.Llm;

public class OpenRouterOptions
{
    public const string SectionName = "OpenRouter";

    public string ApiKey { get; set; } = string.Empty;

    // Mesmo padrão do app Android (SettingsStore.DEFAULT_MODEL): barato, rápido e
    // lê imagem, que é o que a extração de cupom precisa.
    public string Model { get; set; } = "anthropic/claude-haiku-4.5";

    public string BaseUrl { get; set; } = "https://openrouter.ai/api/v1/chat/completions";

    // A OpenRouter usa estes dois cabeçalhos para atribuir o tráfego a um app.
    // Sem acento de propósito: cabeçalho HTTP só aceita ASCII, e um valor com
    // acento faz a requisição inteira falhar antes de sair da máquina.
    public string Referer { get; set; } = "https://github.com/victorsouzadev/anotacoes";
    public string Titulo { get; set; } = "Anotacoes - Financas";

    public int MaxTokens { get; set; } = 4096;

    // Ler um extrato inteiro demora bem mais que interpretar uma frase.
    public int TimeoutSegundos { get; set; } = 30;
    public int TimeoutComAnexosSegundos { get; set; } = 120;

    public int MaxTentativas { get; set; } = 2;
}
