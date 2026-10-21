namespace Hub.Core;

/// <summary>Configuração do hub. Vem da seção "Hub" (appsettings ou variáveis Hub__*).</summary>
public sealed class HubOptions
{
    /// <summary>Pasta do vault (os .md). É a fonte da verdade.</summary>
    public string VaultPath { get; set; } = "/data/vault";

    /// <summary>Pasta de estado do hub: banco, índice, repositório git. Nunca fica dentro do vault.</summary>
    public string DataPath { get; set; } = "/data/hub";

    /// <summary>Nome da chave → valor da API key. O nome vira a origem padrão da captura.</summary>
    public Dictionary<string, string> ApiKeys { get; set; } = new();

    /// <summary>Token bearer do endpoint /mcp. A tela pode gerar outro, que passa a valer no lugar deste.</summary>
    public string McpToken { get; set; } = "";

    /// <summary>Login do WebDAV vindo do .env. A tela pode trocar (aí este deixa de valer).</summary>
    public string WebdavUser { get; set; } = "";
    public string WebdavPass { get; set; } = "";

    /// <summary>Fontes cujo texto você mesmo escreve (atalho do celular, voz). Recebem trust: self.</summary>
    public List<string> TrustedSources { get; set; } = new() { "celular", "manual", "voz", "mcp" };

    public string TimeZone { get; set; } = "America/Belem";

    public bool GitEnabled { get; set; } = true;

    /// <summary>Espera após uma escrita antes de commitar, para agrupar mudanças.</summary>
    public int GitDebounceSeconds { get; set; } = 10;

    /// <summary>Intervalo para commitar mudanças vindas do sync (edições suas).</summary>
    public int GitPeriodicMinutes { get; set; } = 30;

    /// <summary>Move links direto para 30-Recursos sem esperar aprovação.</summary>
    public bool AutoMoveLowRisk { get; set; }

    public long MaxUploadBytes { get; set; } = 50L * 1024 * 1024;

    public int RateLimitPerMinute { get; set; } = 60;

    public AnthropicOptions Anthropic { get; set; } = new();

    /// <summary>Chave da OpenRouter vinda do servidor (a mesma OPENROUTER_API_KEY do hub). A tela pode trocar.</summary>
    public OpenRouterOptions OpenRouter { get; set; } = new();

    public TranscriptionOptions Transcription { get; set; } = new();

    public WebOptions Web { get; set; } = new();

    /// <summary>Base dos MCPs dos apps do hub pela rede interna do Docker (sem token em URL pública).</summary>
    public string AppsMcpUrl { get; set; } = "http://api:8080/api/mcp";

    /// <summary>App Casa: serviço à parte, com MCP e token próprios (MCP_TOKEN do casa-api). Sem token, fica de fora.</summary>
    public ExternalAppOptions Casa { get; set; } = new() { McpUrl = "https://casa.vsitefy.com.br/mcp" };
}

/// <summary>App fora do notas-api: endereço do MCP e token (vai só no cabeçalho Authorization, nunca na URL).</summary>
public sealed class ExternalAppOptions
{
    public string McpUrl { get; set; } = "";
    public string McpToken { get; set; } = "";
    public bool Configured => !string.IsNullOrWhiteSpace(McpUrl) && !string.IsNullOrWhiteSpace(McpToken);
}

/// <summary>
/// Tela do Cérebro dentro do hub (notas-vps): aceita o mesmo JWT do login único,
/// assinado com o JWT_SECRET do notas-api, mas só para os e-mails listados.
/// </summary>
public sealed class WebOptions
{
    /// <summary>Mesmo JWT_SECRET do notas-api. Vazio = tela web desligada.</summary>
    public string JwtSecret { get; set; } = "";

    /// <summary>E-mails com acesso, separados por vírgula. O vault é de uma pessoa só.</summary>
    public string Usuarios { get; set; } = "";

    public bool Enabled => !string.IsNullOrWhiteSpace(JwtSecret) && AllowedEmails.Count > 0;

    public IReadOnlySet<string> AllowedEmails =>
        Usuarios.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
}

public sealed class AnthropicOptions
{
    public string ApiKey { get; set; } = "";
    public string Model { get; set; } = "claude-haiku-5-5";
    public string BaseUrl { get; set; } = "https://api.anthropic.com";
    public bool Enabled => !string.IsNullOrWhiteSpace(ApiKey);
}

/// <summary>
/// OpenRouter: uma chave para modelos de vários fornecedores, pela API compatível com a da OpenAI
/// (/chat/completions com tools).
/// </summary>
public sealed class OpenRouterOptions
{
    public string ApiKey { get; set; } = "";
    public string Model { get; set; } = "anthropic/claude-haiku-4.5";
    public string BaseUrl { get; set; } = "https://openrouter.ai/api/v1";
    public bool Enabled => !string.IsNullOrWhiteSpace(ApiKey);
}

/// <summary>Transcrição de áudio por API compatível com OpenAI (/audio/transcriptions).</summary>
public sealed class TranscriptionOptions
{
    public string ApiKey { get; set; } = "";
    public string BaseUrl { get; set; } = "https://api.openai.com/v1";
    public string Model { get; set; } = "whisper-1";
    public string Language { get; set; } = "pt";
    public bool Enabled => !string.IsNullOrWhiteSpace(ApiKey);
}
