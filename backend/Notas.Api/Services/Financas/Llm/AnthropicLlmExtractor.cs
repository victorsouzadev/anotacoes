using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Notas.Api.Services.Financas.Llm;

// Implementação de ILlmExtractor que chama a API da Anthropic (Claude) para
// extrair os dados estruturados do texto livre.
public class AnthropicLlmExtractor : ILlmExtractor
{
    private readonly HttpClient _httpClient;
    private readonly AnthropicOptions _options;
    private readonly ILogger<AnthropicLlmExtractor> _logger;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public AnthropicLlmExtractor(HttpClient httpClient, IOptions<AnthropicOptions> options, ILogger<AnthropicLlmExtractor> logger)
    {
        _httpClient = httpClient;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<ExtracaoLlmResult> ExtrairAsync(string textoLivre, DateOnly dataEnvio, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            throw new InvalidOperationException(
                "Anthropic:ApiKey não configurada. Defina a variável de ambiente ANTHROPIC_API_KEY " +
                "ou configure Anthropic:ApiKey em appsettings/secrets.");
        }

        var requestBody = new
        {
            model = _options.Model,
            max_tokens = _options.MaxTokens,
            system = PromptBuilder.SystemPrompt,
            messages = new[]
            {
                new { role = "user", content = PromptBuilder.BuildUserPrompt(textoLivre, dataEnvio) }
            }
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, _options.BaseUrl);
        request.Headers.Add("x-api-key", _options.ApiKey);
        request.Headers.Add("anthropic-version", _options.ApiVersion);
        request.Content = new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json");

        using var response = await _httpClient.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Falha ao chamar API da Anthropic: {StatusCode} {Body}", response.StatusCode, body);
            throw new ExtracaoInvalidaException($"Falha ao chamar o LLM: {response.StatusCode}");
        }

        using var doc = JsonDocument.Parse(body);
        var text = doc.RootElement
            .GetProperty("content")[0]
            .GetProperty("text")
            .GetString();

        if (string.IsNullOrWhiteSpace(text))
        {
            throw new ExtracaoInvalidaException("Resposta vazia do LLM.");
        }

        var json = ExtractJson(text);

        try
        {
            var resultado = JsonSerializer.Deserialize<ExtracaoLlmResult>(json, JsonOptions);
            if (resultado is null)
            {
                throw new ExtracaoInvalidaException("Não foi possível desserializar a resposta do LLM.");
            }
            return resultado;
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "JSON inválido retornado pelo LLM: {Json}", json);
            throw new ExtracaoInvalidaException("LLM retornou um JSON inválido.");
        }
    }

    // O prompt instrui o modelo a devolver somente JSON, mas alguns modelos podem
    // envolver a resposta em blocos de código markdown. Esta função extrai apenas
    // o objeto JSON, para tornar o parsing resiliente.
    private static string ExtractJson(string text)
    {
        var trimmed = text.Trim();
        var start = trimmed.IndexOf('{');
        var end = trimmed.LastIndexOf('}');
        if (start < 0 || end < 0 || end < start)
        {
            return trimmed;
        }
        return trimmed.Substring(start, end - start + 1);
    }
}
