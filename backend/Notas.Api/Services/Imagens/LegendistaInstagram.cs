using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Notas.Api.Services.Financas.Llm;

namespace Notas.Api.Services.Imagens;

/// <summary>
/// Escreve legendas de Instagram para o post montado no modo Redes sociais.
///
/// A IA vê o post como ele vai sair (uma prévia em JPEG), lê os textos que já
/// estão na arte e recebe o perfil da marca e o tom pedido; devolve três
/// opções de legenda com hashtags. Usa o mesmo provedor de LLM das Finanças —
/// a chave continua morando só no servidor.
/// </summary>
public record LegendaSugestao(string Texto, IReadOnlyList<string> Hashtags);

public record LegendaResultado(IReadOnlyList<LegendaSugestao> Legendas, bool UsouIa, string? Motivo);

public record PedidoLegenda(
    string? Imagem, IReadOnlyList<string> Textos, string Formato, string Tom, string Contexto, string Marca);

public interface ILegendistaInstagram
{
    Task<LegendaResultado> SugerirAsync(string userId, PedidoLegenda pedido, CancellationToken ct = default);
}

public class LegendistaInstagram : ILegendistaInstagram
{
    public const int Opcoes = 3;
    /// <summary>Limite do Instagram para a legenda inteira.</summary>
    public const int MaxLegenda = 2200;
    /// <summary>O Instagram aceita 30; acima de uns 15 já parece spam.</summary>
    public const int MaxHashtags = 15;

    public static readonly IReadOnlyDictionary<string, string> Tons = new Dictionary<string, string>
    {
        ["carinhoso"] = "carinhoso e próximo, como quem conversa com uma cliente querida",
        ["divertido"] = "divertido e leve, com humor gentil",
        ["vendedor"] = "vendedor sem ser agressivo: destaque o benefício e chame para encomendar",
        ["informativo"] = "claro e informativo: explique o produto, prazos e como pedir",
    };

    private readonly ILlmExtractorFactory _factory;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly OpenRouterOptions _openRouter;
    private readonly AnthropicOptions _anthropic;
    private readonly ILogger<LegendistaInstagram> _logger;

    public LegendistaInstagram(
        ILlmExtractorFactory factory,
        IHttpClientFactory httpClientFactory,
        IOptions<OpenRouterOptions> openRouter,
        IOptions<AnthropicOptions> anthropic,
        ILogger<LegendistaInstagram> logger)
    {
        _factory = factory;
        _httpClientFactory = httpClientFactory;
        _openRouter = openRouter.Value;
        _anthropic = anthropic.Value;
        _logger = logger;
    }

    public async Task<LegendaResultado> SugerirAsync(string userId, PedidoLegenda pedido, CancellationToken ct = default)
    {
        var credenciais = await _factory.ResolverCredenciaisAsync(userId, ct);
        if (credenciais.Provedor is not ("openrouter" or "anthropic") || string.IsNullOrWhiteSpace(credenciais.Chave))
        {
            return Falha("Nenhum provedor de IA está configurado. Cadastre uma chave da OpenRouter ou da Anthropic em Configurações.");
        }

        var anthropic = credenciais.Provedor == "anthropic";
        var prompt = Prompt(pedido);
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(_openRouter.TimeoutComAnexosSegundos));

        try
        {
            using var request = anthropic
                ? RequisicaoAnthropic(credenciais, prompt, pedido.Imagem)
                : RequisicaoOpenRouter(credenciais, prompt, pedido.Imagem);
            var http = _httpClientFactory.CreateClient(nameof(LegendistaInstagram));
            using var resposta = await http.SendAsync(request, cts.Token);
            var texto = await resposta.Content.ReadAsStringAsync(cts.Token);

            if (!resposta.IsSuccessStatusCode)
            {
                _logger.LogError("IA respondeu {Status} ao sugerir legenda: {Corpo}",
                    resposta.StatusCode, texto.Length > 400 ? texto[..400] : texto);
                return Falha(resposta.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.PaymentRequired or HttpStatusCode.Forbidden
                    ? "O provedor de IA recusou a chave de API (verifique a chave e o saldo)."
                    : $"O serviço de IA não respondeu ({(int)resposta.StatusCode}).");
            }

            var legendas = LerLegendas(texto, anthropic);
            return legendas.Count > 0
                ? new LegendaResultado(legendas, true, null)
                : Falha("A IA respondeu num formato inesperado. Tente de novo.");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Falha ao sugerir legenda com a IA.");
            return Falha("Não foi possível falar com o serviço de IA.");
        }
    }

    private static LegendaResultado Falha(string motivo) => new(Array.Empty<LegendaSugestao>(), false, motivo);

    private HttpRequestMessage RequisicaoOpenRouter(CredenciaisLlm c, string prompt, string? imagem)
    {
        var partes = new List<object> { new { type = "text", text = prompt } };
        if (!string.IsNullOrEmpty(imagem)) partes.Add(new { type = "image_url", image_url = new { url = imagem } });
        var corpo = new
        {
            model = c.Modelo,
            max_tokens = 2000,
            temperature = 0.9,
            response_format = new { type = "json_object" },
            messages = new object[] { new { role = "user", content = partes } },
        };
        var request = new HttpRequestMessage(HttpMethod.Post, _openRouter.BaseUrl);
        request.Headers.Add("Authorization", $"Bearer {c.Chave}");
        request.Headers.Add("HTTP-Referer", _openRouter.Referer);
        request.Headers.Add("X-Title", "Anotacoes - Editor de Imagens");
        request.Content = new StringContent(JsonSerializer.Serialize(corpo), Encoding.UTF8, "application/json");
        return request;
    }

    private HttpRequestMessage RequisicaoAnthropic(CredenciaisLlm c, string prompt, string? imagem)
    {
        var partes = new List<object>();
        if (TentarSepararDataUrl(imagem, out var mime, out var base64))
        {
            partes.Add(new { type = "image", source = new { type = "base64", media_type = mime, data = base64 } });
        }
        partes.Add(new { type = "text", text = prompt });
        var corpo = new
        {
            model = c.Modelo,
            max_tokens = 2000,
            temperature = 0.9,
            messages = new object[] { new { role = "user", content = partes } },
        };
        var request = new HttpRequestMessage(HttpMethod.Post, _anthropic.BaseUrl);
        request.Headers.Add("x-api-key", c.Chave);
        request.Headers.Add("anthropic-version", _anthropic.ApiVersion);
        request.Content = new StringContent(JsonSerializer.Serialize(corpo), Encoding.UTF8, "application/json");
        return request;
    }

    private static bool TentarSepararDataUrl(string? dataUrl, out string mime, out string base64)
    {
        mime = "";
        base64 = "";
        if (string.IsNullOrEmpty(dataUrl) || !dataUrl.StartsWith("data:image/", StringComparison.Ordinal)) return false;
        var virgula = dataUrl.IndexOf(',');
        var cabecalho = virgula > 0 ? dataUrl[5..virgula] : "";
        if (!cabecalho.EndsWith(";base64", StringComparison.Ordinal)) return false;
        mime = cabecalho[..^";base64".Length];
        base64 = dataUrl[(virgula + 1)..];
        return base64.Length > 0;
    }

    public static string Prompt(PedidoLegenda p)
    {
        var tom = Tons.TryGetValue(p.Tom, out var descricao) ? descricao : Tons["carinhoso"];
        var textos = p.Textos.Count > 0 ? string.Join(" / ", p.Textos.Select(t => t.Replace('\n', ' '))) : "(sem texto na arte)";
        var tipo = p.Formato switch
        {
            "story" => "um story (legenda curta: no máximo duas linhas, que caiba num texto por cima do story, "
                + "e termine sugerindo uma enquete ou caixinha de perguntas)",
            "carrossel" => "um carrossel (a primeira linha precisa convidar a arrastar para o lado)",
            _ => "um post de feed",
        };
        var imagem = string.IsNullOrEmpty(p.Imagem) ? "" : "A imagem anexada é o post exatamente como vai ser publicado.\n";
        var contexto = string.IsNullOrWhiteSpace(p.Contexto) ? "" : $"\nO que a pessoa quer comunicar com este post: {p.Contexto.Trim()}\n";
        var marca = string.IsNullOrWhiteSpace(p.Marca) ? "" : $"\nSobre a marca (siga a voz e use os contatos quando fizer sentido):\n{p.Marca.Trim()}\n";

        return $$"""
            Você é social media de uma pequena marca brasileira e escreve legendas de Instagram em português do Brasil.
            {{imagem}}Escreva {{Opcoes}} opções de legenda, diferentes entre si, para {{tipo}}.
            Textos que já estão na arte: {{textos}}
            {{contexto}}{{marca}}
            Tom: {{tom}}.

            Regras:
            - a primeira linha é o gancho: curta, e faz a pessoa querer ler o resto;
            - não repita a arte palavra por palavra: complemente o que ela já diz;
            - termine com uma chamada para ação clara (comentar, salvar, chamar no direct ou no WhatsApp);
            - emojis com moderação, combinando com a marca;
            - no máximo {{MaxLegenda}} caracteres por legenda, sem as hashtags;
            - para cada opção, de 5 a {{MaxHashtags}} hashtags relevantes, misturando nicho, produto e cidade quando houver;
            - não invente preço, prazo ou promoção que não foram informados.

            Responda só com JSON, sem markdown: {"legendas": [{"texto": "...", "hashtags": ["#...", "#..."]}]}
            """;
    }

    /// <summary>Lê as opções e as deixa prontas pra colar.</summary>
    public static IReadOnlyList<LegendaSugestao> LerLegendas(string corpo, bool anthropic)
    {
        try
        {
            using var doc = JsonDocument.Parse(corpo);
            if (doc.RootElement.TryGetProperty("error", out _)) return Array.Empty<LegendaSugestao>();

            var conteudo = anthropic
                ? doc.RootElement.GetProperty("content")[0].GetProperty("text").GetString() ?? ""
                : doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString() ?? "";

            var limpo = conteudo.Trim();
            // Alguns modelos devolvem o JSON dentro de um bloco de markdown, ou com
            // uma frase antes: vale o que estiver entre a primeira e a última chave.
            var inicio = limpo.IndexOf('{');
            var fim = limpo.LastIndexOf('}');
            if (inicio < 0 || fim <= inicio) return Array.Empty<LegendaSugestao>();
            limpo = limpo[inicio..(fim + 1)];

            using var resposta = JsonDocument.Parse(limpo);
            if (!resposta.RootElement.TryGetProperty("legendas", out var lista) || lista.ValueKind != JsonValueKind.Array)
                return Array.Empty<LegendaSugestao>();

            var saida = new List<LegendaSugestao>();
            foreach (var item in lista.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty("texto", out var t)) continue;
                var texto = (t.GetString() ?? "").Trim();
                if (texto.Length == 0) continue;
                if (texto.Length > MaxLegenda) texto = texto[..MaxLegenda].TrimEnd();

                var hashtags = new List<string>();
                if (item.TryGetProperty("hashtags", out var hs) && hs.ValueKind == JsonValueKind.Array)
                {
                    foreach (var h in hs.EnumerateArray())
                    {
                        var tag = Hashtag(h.GetString());
                        if (tag.Length > 1 && !hashtags.Contains(tag, StringComparer.OrdinalIgnoreCase)) hashtags.Add(tag);
                        if (hashtags.Count == MaxHashtags) break;
                    }
                }
                saida.Add(new LegendaSugestao(texto, hashtags));
                if (saida.Count == Opcoes) break;
            }
            return saida;
        }
        catch (Exception)
        {
            return Array.Empty<LegendaSugestao>();
        }
    }

    /// <summary>"#Topo de bolo" vira "#topodebolo": hashtag não tem espaço nem pontuação.</summary>
    public static string Hashtag(string? bruto)
    {
        if (string.IsNullOrWhiteSpace(bruto)) return "";
        var sb = new StringBuilder("#");
        foreach (var c in bruto.Trim().TrimStart('#'))
        {
            if (char.IsLetterOrDigit(c) || c == '_') sb.Append(char.ToLowerInvariant(c));
        }
        return sb.ToString();
    }
}
