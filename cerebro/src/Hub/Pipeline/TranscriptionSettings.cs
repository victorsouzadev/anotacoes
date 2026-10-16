using System.Text.Json;
using Hub.Core;
using Hub.Data;
using Microsoft.Extensions.Options;

namespace Hub.Pipeline;

/// <summary>Um serviço de transcrição compatível com a API da OpenAI (/audio/transcriptions).</summary>
public sealed record TranscriptionPreset(string Id, string Name, string BaseUrl, string Model, string Description);

/// <summary>O que vale na próxima transcrição: tela, servidor (.env) ou nada.</summary>
public sealed record EffectiveTranscription(string BaseUrl, string Model, string Language, string ApiKey, string KeySource)
{
    public bool Enabled => ApiKey.Length > 0;
}

/// <summary>
/// Transcrição de áudio configurada pela tela (aba Configurações), guardada no hub.db com a chave
/// cifrada como a da IA. Sem nada salvo na tela, vale CEREBRO_OPENAI_API_KEY do .env.
/// </summary>
public sealed class TranscriptionSettings
{
    private const string Key = "transcricao";

    public static readonly IReadOnlyList<TranscriptionPreset> Presets =
    [
        new("openai", "OpenAI", "https://api.openai.com/v1", "whisper-1", "Whisper da OpenAI. Chave em platform.openai.com."),
        new("groq", "Groq", "https://api.groq.com/openai/v1", "whisper-large-v3-turbo", "Whisper rápido e barato (tem cota grátis). Chave em console.groq.com."),
    ];

    private readonly HubDb _db;
    private readonly HubOptions _options;
    private readonly SecretBox _box;

    public TranscriptionSettings(HubDb db, IOptions<HubOptions> options, SecretBox box)
    {
        _db = db;
        _options = options.Value;
        _box = box;
    }

    public sealed record Stored(string? Preset, string? Model, string? EncryptedKey);

    public bool CanStoreKeys => _box.Available;

    public Stored Load()
    {
        var row = _db.GetSetting(Key);
        return row is null ? new Stored(null, null, null) : JsonSerializer.Deserialize<Stored>(row.Value.Value) ?? new Stored(null, null, null);
    }

    /// <param name="apiKey">null mantém a chave salva; "" apaga; texto substitui.</param>
    public void Save(string? preset, string? model, string? apiKey)
    {
        if (preset is not null && Presets.All(p => p.Id != preset)) throw new ArgumentException("Serviço de transcrição inválido.");
        var current = Load();
        var encrypted = apiKey switch
        {
            null => current.EncryptedKey,
            "" => null,
            _ => _box.Encrypt(apiKey.Trim()),
        };
        _db.SetSetting(Key, JsonSerializer.Serialize(new Stored(preset, string.IsNullOrWhiteSpace(model) ? null : model.Trim(), encrypted)));
    }

    public string? StoredKey() => _box.Decrypt(Load().EncryptedKey);

    public EffectiveTranscription Resolve()
    {
        var s = Load();
        var key = StoredKey();
        if (key is not null)
        {
            var p = Presets.FirstOrDefault(x => x.Id == s.Preset) ?? Presets[0];
            return new(p.BaseUrl, s.Model ?? p.Model, _options.Transcription.Language, key, "tela");
        }
        var t = _options.Transcription;
        return new(t.BaseUrl, t.Model, t.Language, t.Enabled ? t.ApiKey : "", t.Enabled ? "servidor" : "nenhuma");
    }
}
