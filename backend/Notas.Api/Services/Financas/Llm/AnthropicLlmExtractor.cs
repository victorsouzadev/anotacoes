using System.Net;
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

    public string Provedor => "anthropic";

    // A API de mensagens da Anthropic aceita imagens, mas este extrator existe só
    // como caminho alternativo ao da OpenRouter; a entrada multimodal ficou
    // concentrada lá para não manter dois formatos de anexo.
    public bool SuportaAnexos => false;

    public async Task<IReadOnlyList<ExtracaoLlmResult>> ExtrairAsync(
        EntradaExtracao entrada, DateOnly dataEnvio, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            throw new LlmIndisponivelException(
                "Anthropic:ApiKey não configurada. Defina a variável de ambiente ANTHROPIC_API_KEY " +
                "ou configure Anthropic:ApiKey em appsettings/secrets.");
        }

        var body = await EnviarComRetentativaAsync(entrada, dataEnvio, cancellationToken);

        using var doc = JsonDocument.Parse(body);
        if (!doc.RootElement.TryGetProperty("content", out var content)
            || content.ValueKind != JsonValueKind.Array
            || content.GetArrayLength() == 0
            || !content[0].TryGetProperty("text", out var textProp))
        {
            throw new LlmIndisponivelException("Resposta do LLM em formato inesperado.");
        }

        var text = textProp.GetString();
        if (string.IsNullOrWhiteSpace(text))
        {
            throw new LlmIndisponivelException("Resposta vazia do LLM.");
        }

        return RespostaLlmParser.Parse(text, JsonOptions, _logger);
    }

    // Erros transitórios (429, 5xx, timeout) merecem uma segunda tentativa com
    // espera curta; erros 4xx de configuração/entrada não, porque repetir não muda
    // o resultado e só faz o usuário esperar mais.
    private async Task<string> EnviarComRetentativaAsync(EntradaExtracao entrada, DateOnly dataEnvio, CancellationToken cancellationToken)
    {
        var requestBody = new
        {
            model = _options.Model,
            max_tokens = _options.MaxTokens,
            temperature = 0,
            system = PromptBuilder.SystemPrompt,
            messages = new[]
            {
                new { role = "user", content = PromptBuilder.BuildUserPrompt(entrada, dataEnvio) }
            }
        };
        var payload = JsonSerializer.Serialize(requestBody);

        for (var tentativa = 1; ; tentativa++)
        {
            var ultima = tentativa > _options.MaxTentativas;

            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, _options.BaseUrl);
                request.Headers.Add("x-api-key", _options.ApiKey);
                request.Headers.Add("anthropic-version", _options.ApiVersion);
                request.Content = new StringContent(payload, Encoding.UTF8, "application/json");

                using var response = await _httpClient.SendAsync(request, cancellationToken);
                var body = await response.Content.ReadAsStringAsync(cancellationToken);

                if (response.IsSuccessStatusCode) return body;

                _logger.LogError("Falha ao chamar API da Anthropic (tentativa {Tentativa}): {StatusCode} {Body}",
                    tentativa, response.StatusCode, body);

                if (ultima || !EhTransitorio(response.StatusCode))
                {
                    throw new LlmIndisponivelException(
                        $"O serviço de interpretação não respondeu ({(int)response.StatusCode}).");
                }
            }
            catch (TaskCanceledException ex) when (!cancellationToken.IsCancellationRequested)
            {
                // TaskCanceledException sem cancelamento do cliente = timeout do HttpClient.
                _logger.LogError(ex, "Timeout ao chamar API da Anthropic (tentativa {Tentativa}).", tentativa);
                if (ultima) throw new LlmIndisponivelException("O serviço de interpretação demorou demais para responder.", ex);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "Erro de rede ao chamar API da Anthropic (tentativa {Tentativa}).", tentativa);
                if (ultima) throw new LlmIndisponivelException("Não foi possível contatar o serviço de interpretação.", ex);
            }

            await Task.Delay(TimeSpan.FromMilliseconds(400 * tentativa), cancellationToken);
        }
    }

    private static bool EhTransitorio(HttpStatusCode status) =>
        status == HttpStatusCode.TooManyRequests
        || status == HttpStatusCode.RequestTimeout
        || (int)status >= 500;

}
