using System.Text.Json;
using Hub.Core;
using Hub.Data;
using Microsoft.Extensions.Options;

namespace Hub.Pipeline;

public static class AiProvider
{
    /// <summary>Segue o servidor: Anthropic se houver chave, senão OpenRouter.</summary>
    public const string Default = "";
    public const string OpenRouter = "openrouter";
    public const string Anthropic = "anthropic";
    /// <summary>Classificação desligada: as capturas ficam na Inbox sem sugestão.</summary>
    public const string Off = "off";

    public static bool IsValid(string? p) => p is Default or OpenRouter or Anthropic or Off;
}

public sealed record SuggestedModel(string Id, string Name, string Description);

/// <summary>O que será usado de fato na próxima classificação.</summary>
public sealed record EffectiveAi(string Provider, string Model, string ApiKey, string KeySource)
{
    public static readonly EffectiveAi None = new(AiProvider.Off, "", "", "nenhuma");
    public bool Enabled => Provider is AiProvider.OpenRouter or AiProvider.Anthropic && ApiKey.Length > 0;
}

/// <summary>
/// Configuração de IA da tela do Cérebro, guardada no hub.db. A chave fica cifrada (AES-GCM) com uma
/// chave derivada do JWT_SECRET do hub, e nunca volta inteira para o navegador. Sem nada salvo na
/// tela, valem as chaves do servidor (.env): ANTHROPIC_API_KEY e depois OPENROUTER_API_KEY.
/// </summary>
public sealed class AiSettings
{
    private const string Key = "ai";

    public static readonly IReadOnlyList<SuggestedModel> OpenRouterModels =
    [
        new("anthropic/claude-haiku-4.5", "Claude Haiku 4.5", "Padrão. Rápido, barato e bom em português."),
        new("openai/gpt-4o-mini", "GPT-4o mini", "Alternativa barata da OpenAI."),
        new("google/gemini-3.6-flash", "Gemini 3.6 Flash", "Bom com textos longos, como páginas inteiras de links."),
        new("anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5", "Mais caro; resumos e ligações entre notas mais precisos."),
    ];

    public static readonly IReadOnlyList<SuggestedModel> AnthropicModels =
    [
        new("claude-haiku-5-5", "Claude Haiku 5.5", "Padrão. Rápido e barato."),
        new("claude-sonnet-5-5", "Claude Sonnet 5.5", "Mais preciso em textos ambíguos."),
    ];

    private readonly HubDb _db;
    private readonly HubOptions _options;
    private readonly SecretBox _box;

    public AiSettings(HubDb db, IOptions<HubOptions> options, SecretBox box)
    {
        _db = db;
        _options = options.Value;
        _box = box;
    }

    public sealed record Stored(string Provider, string? Model, string? EncryptedKey);

    public bool CanStoreKeys => _box.Available;

    public (Stored Value, DateTimeOffset? UpdatedAt) Load()
    {
        var row = _db.GetSetting(Key);
        if (row is null) return (new Stored(AiProvider.Default, null, null), null);
        var s = JsonSerializer.Deserialize<Stored>(row.Value.Value) ?? new Stored(AiProvider.Default, null, null);
        return (s, row.Value.UpdatedAt);
    }

    /// <param name="apiKey">null mantém a chave salva; "" apaga; texto substitui.</param>
    public void Save(string provider, string? model, string? apiKey)
    {
        if (!AiProvider.IsValid(provider)) throw new ArgumentException("Provedor inválido.");
        var current = Load().Value;
        var encrypted = apiKey switch
        {
            null => current.EncryptedKey,
            "" => null,
            _ => _box.Encrypt(apiKey.Trim()),
        };
        var stored = new Stored(provider, string.IsNullOrWhiteSpace(model) ? null : model.Trim(), encrypted);
        _db.SetSetting(Key, JsonSerializer.Serialize(stored));
    }

    public string? StoredKey()
    {
        var enc = Load().Value.EncryptedKey;
        return _box.Decrypt(enc);
    }

    /// <summary>Combina o que foi salvo na tela com o .env. Também serve para testar uma configuração antes de salvar.</summary>
    public EffectiveAi Resolve(string? provider = null, string? model = null, string? apiKey = null)
    {
        var stored = Load().Value;
        provider ??= stored.Provider;
        model = string.IsNullOrWhiteSpace(model) ? stored.Model : model;
        var key = string.IsNullOrWhiteSpace(apiKey) ? StoredKey() : apiKey.Trim();

        if (provider == AiProvider.Off) return EffectiveAi.None;

        if (provider == AiProvider.Default)
        {
            if (key is not null)  // chave salva sem provedor escolhido: é da OpenRouter (o padrão da tela)
                return new(AiProvider.OpenRouter, model ?? _options.OpenRouter.Model, key, "tela");
            if (_options.Anthropic.Enabled)
                return new(AiProvider.Anthropic, model ?? _options.Anthropic.Model, _options.Anthropic.ApiKey, "servidor");
            if (_options.OpenRouter.Enabled)
                return new(AiProvider.OpenRouter, model ?? _options.OpenRouter.Model, _options.OpenRouter.ApiKey, "servidor");
            return EffectiveAi.None;
        }

        var (serverKey, serverModel) = provider == AiProvider.Anthropic
            ? (_options.Anthropic.ApiKey, _options.Anthropic.Model)
            : (_options.OpenRouter.ApiKey, _options.OpenRouter.Model);
        if (key is not null) return new(provider, model ?? serverModel, key, "tela");
        if (!string.IsNullOrWhiteSpace(serverKey)) return new(provider, model ?? serverModel, serverKey, "servidor");
        return new(provider, model ?? serverModel, "", "nenhuma");
    }

    public static string Mask(string? key) => SecretBox.Mask(key);
}
