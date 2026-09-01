using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Notas.Api.Services.Financas.Llm;

// Chama a OpenRouter (openrouter.ai, API compatível com a da OpenAI) para extrair
// lançamentos de texto livre e de arquivos — foto de cupom, PDF de extrato, CSV
// de fatura. Mesmo provedor que o app Android já usa para interpretar tarefas.
public class OpenRouterLlmExtractor : ILlmExtractor
{
    private readonly HttpClient _httpClient;
    private readonly OpenRouterOptions _options;
    private readonly ILogger<OpenRouterLlmExtractor> _logger;

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public OpenRouterLlmExtractor(HttpClient httpClient, IOptions<OpenRouterOptions> options,
        ILogger<OpenRouterLlmExtractor> logger)
    {
        _httpClient = httpClient;
        _options = options.Value;
        _logger = logger;
    }

    public string Provedor => "openrouter";

    public bool SuportaAnexos => true;

    public async Task<IReadOnlyList<ExtracaoLlmResult>> ExtrairAsync(
        EntradaExtracao entrada, DateOnly dataEnvio, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            // Mensagem escrita para quem está na tela de Configurações, que é por
            // onde a chave se cadastra hoje — falar de variável de ambiente aqui
            // mandaria o usuário para a VPS sem necessidade.
            throw new LlmIndisponivelException(
                "Nenhuma chave da OpenRouter configurada. Cadastre a sua em Configurações "
                + "(ou defina OPENROUTER_API_KEY no servidor, para valer como padrão).");
        }

        var body = await EnviarComRetentativaAsync(entrada, dataEnvio, cancellationToken);
        var texto = LerConteudo(body);

        return RespostaLlmParser.Parse(texto, JsonOptions, _logger);
    }

    // ------------------------------------------------------------------ envio

    private async Task<string> EnviarComRetentativaAsync(EntradaExtracao entrada, DateOnly dataEnvio, CancellationToken ct)
    {
        var payload = JsonSerializer.Serialize(MontarCorpo(entrada, dataEnvio));

        // Ler um extrato de várias páginas é ordens de grandeza mais lento que
        // interpretar "gastei 45 no mercado".
        var timeout = TimeSpan.FromSeconds(entrada.TemAnexos
            ? _options.TimeoutComAnexosSegundos
            : _options.TimeoutSegundos);

        for (var tentativa = 1; ; tentativa++)
        {
            var ultima = tentativa > _options.MaxTentativas;

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeoutCts.CancelAfter(timeout);

            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, _options.BaseUrl);
                request.Headers.Add("Authorization", $"Bearer {_options.ApiKey}");
                request.Headers.Add("HTTP-Referer", SomenteAscii(_options.Referer));
                request.Headers.Add("X-Title", SomenteAscii(_options.Titulo));
                request.Content = new StringContent(payload, Encoding.UTF8, "application/json");

                using var response = await _httpClient.SendAsync(request, timeoutCts.Token);
                var corpo = await response.Content.ReadAsStringAsync(timeoutCts.Token);

                if (response.IsSuccessStatusCode) return corpo;

                _logger.LogError("OpenRouter respondeu {StatusCode} para o modelo {Modelo} (tentativa {Tentativa}): {Corpo}",
                    response.StatusCode, _options.Model, tentativa, Truncar(corpo, 500));

                if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.PaymentRequired)
                {
                    throw new LlmIndisponivelException(
                        "A OpenRouter recusou a chave de API (verifique a chave e o saldo da conta).");
                }

                if (ultima || !EhTransitorio(response.StatusCode))
                {
                    throw new LlmIndisponivelException(
                        $"O serviço de interpretação não respondeu ({(int)response.StatusCode}).");
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw; // O cliente desistiu: não é falha do provedor.
            }
            catch (OperationCanceledException ex)
            {
                _logger.LogError(ex, "Timeout ({Timeout}s) ao chamar a OpenRouter (tentativa {Tentativa}).",
                    timeout.TotalSeconds, tentativa);
                if (ultima) throw new LlmIndisponivelException("O serviço de interpretação demorou demais para responder.", ex);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "Erro de rede ao chamar a OpenRouter (tentativa {Tentativa}).", tentativa);
                if (ultima) throw new LlmIndisponivelException("Não foi possível contatar o serviço de interpretação.", ex);
            }

            await Task.Delay(TimeSpan.FromMilliseconds(500 * tentativa), ct);
        }
    }

    private object MontarCorpo(EntradaExtracao entrada, DateOnly dataEnvio)
    {
        return new
        {
            model = _options.Model,
            max_tokens = _options.MaxTokens,
            temperature = 0,
            // Pede JSON estrito ao provedor. Modelos que não suportam ignoram o
            // campo, e o parser de resposta continua tolerante a markdown.
            response_format = new { type = "json_object" },
            messages = new object[]
            {
                new { role = "system", content = PromptBuilder.SystemPrompt },
                new { role = "user", content = MontarConteudoDoUsuario(entrada, dataEnvio) },
            },
        };
    }

    // O conteúdo da mensagem do usuário é uma lista de partes: o texto do prompt
    // mais uma parte por imagem/PDF anexado, no formato que a API da OpenRouter
    // espera.
    private static List<object> MontarConteudoDoUsuario(EntradaExtracao entrada, DateOnly dataEnvio)
    {
        var partes = new List<object>
        {
            new { type = "text", text = PromptBuilder.BuildUserPrompt(entrada, dataEnvio) },
        };

        foreach (var anexo in entrada.Anexos)
        {
            if (anexo.EhImagem)
            {
                partes.Add(new { type = "image_url", image_url = new { url = anexo.ComoDataUrl() } });
            }
            else if (anexo.EhPdf)
            {
                partes.Add(new { type = "file", file = new { filename = anexo.NomeArquivo, file_data = anexo.ComoDataUrl() } });
            }
            // Anexos de texto já foram embutidos no prompt por PromptBuilder.
        }

        return partes;
    }

    // --------------------------------------------------------------- resposta

    private static string LerConteudo(string corpo)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(corpo);
        }
        catch (JsonException)
        {
            // Um proxy no caminho pode devolver HTML de erro com status 200. Sem
            // isto, a exceção de parsing escaparia como falha genérica, sem dizer
            // que a resposta sequer era JSON.
            throw new LlmIndisponivelException(
                $"O provedor devolveu uma resposta que não é JSON: {Truncar(corpo.Trim(), 200)}");
        }

        using (doc)
        {
        var raiz = doc.RootElement;

        // A OpenRouter devolve 200 com um objeto de erro quando o provedor
        // subjacente falha, então checar só o código HTTP não basta.
        if (raiz.TryGetProperty("error", out var erro))
        {
            var mensagem = erro.TryGetProperty("message", out var m) ? m.GetString() : null;
            throw new LlmIndisponivelException($"A OpenRouter retornou um erro: {mensagem ?? "sem detalhes"}.");
        }

        if (!raiz.TryGetProperty("choices", out var choices)
            || choices.ValueKind != JsonValueKind.Array
            || choices.GetArrayLength() == 0)
        {
            throw new LlmIndisponivelException("Resposta do LLM em formato inesperado.");
        }

        var texto = choices[0].TryGetProperty("message", out var msg) && msg.TryGetProperty("content", out var c)
            ? c.GetString()
            : null;

        if (string.IsNullOrWhiteSpace(texto))
        {
            throw new LlmIndisponivelException("Resposta vazia do LLM.");
        }

        return texto;
        }
    }

    // Cabeçalho HTTP só aceita ASCII: um título configurado como "Finanças" faria
    // toda requisição estourar em HttpRequestException antes de sair da máquina,
    // e o erro ("Request headers must contain only ASCII characters") não sugere
    // em nada que a causa está no appsettings.
    public static string SomenteAscii(string valor)
    {
        if (string.IsNullOrEmpty(valor)) return "";

        var normalizado = valor.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(normalizado.Length);

        foreach (var c in normalizado)
        {
            // Remove o acento e mantém a letra base ("ç" -> "c"), preservando o
            // texto legível em vez de simplesmente apagar o caractere.
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
            if (c is >= ' ' and <= '~') sb.Append(c);
            else if (char.IsWhiteSpace(c)) sb.Append(' ');
        }

        return sb.ToString().Trim();
    }

    private static bool EhTransitorio(HttpStatusCode status) =>
        status == HttpStatusCode.TooManyRequests
        || status == HttpStatusCode.RequestTimeout
        || (int)status >= 500;

    private static string Truncar(string valor, int max) => valor.Length <= max ? valor : valor[..max];
}
