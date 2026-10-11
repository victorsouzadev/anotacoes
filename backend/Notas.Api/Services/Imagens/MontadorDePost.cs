using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Notas.Api.Services.Financas.Llm;

namespace Notas.Api.Services.Imagens;

/// <summary>
/// Monta um post da marca a partir das fotos: a IA olha as fotos, escolhe um
/// dos modelos prontos (story, feed ou carrossel) e reescreve os textos dele
/// para combinar com o que aparece nas fotos. O editor aplica o modelo, põe as
/// fotos nos espaços e troca os textos — tudo continua editável depois.
///
/// Mesmo provedor de LLM da legenda; a chave fica só no servidor.
/// </summary>
public record ModeloParaIa(string Id, string Nome, string Grupo, string Ajuda, int Fotos, bool Cresce, IReadOnlyList<string> Textos);

public record PedidoPost(
    IReadOnlyList<string> Fotos, IReadOnlyList<ModeloParaIa> Modelos, IReadOnlyList<string> Filtros,
    string Tipo, string Tom, string Contexto, string Marca);

public record TextoDoPost(int Indice, string Texto);

public record PostSugerido(string ModeloId, IReadOnlyList<TextoDoPost> Textos, IReadOnlyList<int> OrdemFotos, string? Filtro, string Explicacao);

public record PostResultado(PostSugerido? Post, bool UsouIa, string? Motivo);

public interface IMontadorDePost
{
    Task<PostResultado> MontarAsync(string userId, PedidoPost pedido, CancellationToken ct = default);
}

public class MontadorDePost : IMontadorDePost
{
    public static readonly string[] Tipos = ["auto", "Story", "Feed", "Carrossel"];

    private readonly ILlmExtractorFactory _factory;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly OpenRouterOptions _openRouter;
    private readonly AnthropicOptions _anthropic;
    private readonly ILogger<MontadorDePost> _logger;

    public MontadorDePost(
        ILlmExtractorFactory factory,
        IHttpClientFactory httpClientFactory,
        IOptions<OpenRouterOptions> openRouter,
        IOptions<AnthropicOptions> anthropic,
        ILogger<MontadorDePost> logger)
    {
        _factory = factory;
        _httpClientFactory = httpClientFactory;
        _openRouter = openRouter.Value;
        _anthropic = anthropic.Value;
        _logger = logger;
    }

    public async Task<PostResultado> MontarAsync(string userId, PedidoPost pedido, CancellationToken ct = default)
    {
        var credenciais = await _factory.ResolverCredenciaisAsync(userId, ct);
        if (credenciais.Provedor is not ("openrouter" or "anthropic") || string.IsNullOrWhiteSpace(credenciais.Chave))
            return Falha("Nenhum provedor de IA está configurado. Cadastre uma chave da OpenRouter ou da Anthropic em Configurações.");

        var modelos = Candidatos(pedido);
        if (modelos.Count == 0) return Falha("Nenhum modelo desse tipo recebe fotos.");

        var anthropic = credenciais.Provedor == "anthropic";
        var prompt = Prompt(pedido, modelos);
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(_openRouter.TimeoutComAnexosSegundos));

        try
        {
            using var request = anthropic
                ? RequisicaoAnthropic(credenciais, prompt, pedido.Fotos)
                : RequisicaoOpenRouter(credenciais, prompt, pedido.Fotos);
            var http = _httpClientFactory.CreateClient(nameof(MontadorDePost));
            using var resposta = await http.SendAsync(request, cts.Token);
            var texto = await resposta.Content.ReadAsStringAsync(cts.Token);

            if (!resposta.IsSuccessStatusCode)
            {
                _logger.LogError("IA respondeu {Status} ao montar post: {Corpo}",
                    resposta.StatusCode, texto.Length > 400 ? texto[..400] : texto);
                return Falha(resposta.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.PaymentRequired or HttpStatusCode.Forbidden
                    ? "O provedor de IA recusou a chave de API (verifique a chave e o saldo)."
                    : $"O serviço de IA não respondeu ({(int)resposta.StatusCode}).");
            }

            var post = LerPost(texto, anthropic, modelos, pedido.Fotos.Count, pedido.Filtros);
            return post is not null
                ? new PostResultado(post, true, null)
                : Falha("A IA respondeu num formato inesperado. Tente de novo.");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Falha ao montar post com a IA.");
            return Falha("Não foi possível falar com o serviço de IA.");
        }
    }

    private static PostResultado Falha(string motivo) => new(null, false, motivo);

    /// <summary>Só modelos que recebem foto, e do tipo pedido.</summary>
    public static IReadOnlyList<ModeloParaIa> Candidatos(PedidoPost p) =>
        p.Modelos.Where(m => m.Fotos > 0 && (p.Tipo == "auto" || m.Grupo == p.Tipo)).ToList();

    private HttpRequestMessage RequisicaoOpenRouter(CredenciaisLlm c, string prompt, IReadOnlyList<string> fotos)
    {
        var partes = new List<object> { new { type = "text", text = prompt } };
        foreach (var f in fotos) partes.Add(new { type = "image_url", image_url = new { url = f } });
        var corpo = new
        {
            model = c.Modelo,
            max_tokens = 2500,
            temperature = 0.8,
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

    private HttpRequestMessage RequisicaoAnthropic(CredenciaisLlm c, string prompt, IReadOnlyList<string> fotos)
    {
        var partes = new List<object>();
        foreach (var f in fotos)
        {
            if (LegendistaInstagram.TentarSepararDataUrl(f, out var mime, out var base64))
                partes.Add(new { type = "image", source = new { type = "base64", media_type = mime, data = base64 } });
        }
        partes.Add(new { type = "text", text = prompt });
        var corpo = new
        {
            model = c.Modelo,
            max_tokens = 2500,
            temperature = 0.8,
            messages = new object[] { new { role = "user", content = partes } },
        };
        var request = new HttpRequestMessage(HttpMethod.Post, _anthropic.BaseUrl);
        request.Headers.Add("x-api-key", c.Chave);
        request.Headers.Add("anthropic-version", _anthropic.ApiVersion);
        request.Content = new StringContent(JsonSerializer.Serialize(corpo), Encoding.UTF8, "application/json");
        return request;
    }

    public static string Prompt(PedidoPost p, IReadOnlyList<ModeloParaIa> modelos)
    {
        var tom = LegendistaInstagram.Tons.TryGetValue(p.Tom, out var d) ? d : LegendistaInstagram.Tons["carinhoso"];
        var lista = new StringBuilder();
        foreach (var m in modelos)
        {
            var cap = m.Cresce ? $"{m.Fotos} fotos ou mais (cresce até 10 posts)" : m.Fotos == 1 ? "1 foto" : $"{m.Fotos} fotos";
            lista.Append($"\n- id \"{m.Id}\" — {m.Grupo}: {m.Nome}. {m.Ajuda}. Recebe {cap}.\n  textos:");
            for (var i = 0; i < m.Textos.Count; i++)
                lista.Append($"\n    [{i}] {m.Textos[i].Replace("\n", "\\n")}");
        }
        var contexto = string.IsNullOrWhiteSpace(p.Contexto) ? "" : $"\nO que a pessoa quer comunicar: {p.Contexto.Trim()}\n";
        var marca = string.IsNullOrWhiteSpace(p.Marca) ? "" : $"\nSobre a marca (siga a voz):\n{p.Marca.Trim()}\n";
        var tipo = p.Tipo == "auto" ? "Escolha o modelo que melhor combina com as fotos (story, feed ou carrossel)." : $"O post precisa ser um {p.Tipo}.";
        var filtros = p.Filtros.Count > 0 ? string.Join(", ", p.Filtros) : "original";

        return $$"""
            Você é designer e social media de uma pequena marca brasileira de papelaria personalizada.
            As {{p.Fotos.Count}} imagens anexadas são fotos de produtos/entregas que vão virar um post de Instagram, na ordem: foto 0, foto 1, ...
            {{tipo}}
            {{contexto}}{{marca}}
            Modelos disponíveis (use só um destes ids):{{lista}}

            Tarefa:
            1. escolha o modelo ("modelo");
            2. reescreva os textos do modelo para falar do que aparece nas fotos ("textos": índice e texto novo). Mantenha
               o mesmo papel e um tamanho parecido com o original (título curto continua curto; "\n" quebra linha); não mude
               @, telefone nem textos que são só símbolos; omita os textos que já servem como estão;
            3. ordene as fotos ("ordemFotos": índices, a melhor primeiro — ela vai na capa ou no espaço principal);
            4. sugira um filtro para a foto principal, um destes ids: {{filtros}};
            5. explique a escolha em uma frase ("explicacao").
            Tom dos textos: {{tom}}. Letras minúsculas nos títulos cursivos, como no modelo. Não invente preço, prazo ou promoção.

            Responda só com JSON, sem markdown:
            {"modelo": "id", "textos": [{"indice": 0, "texto": "..."}], "ordemFotos": [0, 1], "filtro": "id", "explicacao": "..."}
            """;
    }

    /// <summary>Lê a resposta e descarta o que não cabe no modelo escolhido.</summary>
    public static PostSugerido? LerPost(string corpo, bool anthropic, IReadOnlyList<ModeloParaIa> modelos, int fotos, IReadOnlyList<string> filtros)
    {
        try
        {
            using var doc = JsonDocument.Parse(corpo);
            if (doc.RootElement.TryGetProperty("error", out _)) return null;
            var conteudo = anthropic
                ? doc.RootElement.GetProperty("content")[0].GetProperty("text").GetString() ?? ""
                : doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString() ?? "";
            var inicio = conteudo.IndexOf('{');
            var fim = conteudo.LastIndexOf('}');
            if (inicio < 0 || fim <= inicio) return null;

            using var r = JsonDocument.Parse(conteudo[inicio..(fim + 1)]);
            var raiz = r.RootElement;
            var id = raiz.TryGetProperty("modelo", out var mEl) ? mEl.GetString() : null;
            var modelo = modelos.FirstOrDefault(m => m.Id == id);
            if (modelo is null) return null;

            var textos = new List<TextoDoPost>();
            if (raiz.TryGetProperty("textos", out var ts) && ts.ValueKind == JsonValueKind.Array)
            {
                foreach (var t in ts.EnumerateArray())
                {
                    if (t.ValueKind != JsonValueKind.Object
                        || !t.TryGetProperty("indice", out var iEl) || !iEl.TryGetInt32(out var i)
                        || !t.TryGetProperty("texto", out var xEl)) continue;
                    var x = (xEl.GetString() ?? "").Replace("\\n", "\n").Trim();
                    if (i < 0 || i >= modelo.Textos.Count || x.Length == 0 || textos.Any(o => o.Indice == i)) continue;
                    textos.Add(new TextoDoPost(i, x.Length > 300 ? x[..300].TrimEnd() : x));
                }
            }

            // Ordem das fotos: válidas, sem repetir; as esquecidas vão pro fim.
            var ordem = new List<int>();
            if (raiz.TryGetProperty("ordemFotos", out var os) && os.ValueKind == JsonValueKind.Array)
            {
                foreach (var o in os.EnumerateArray())
                    if (o.TryGetInt32(out var k) && k >= 0 && k < fotos && !ordem.Contains(k)) ordem.Add(k);
            }
            for (var k = 0; k < fotos; k++) if (!ordem.Contains(k)) ordem.Add(k);

            var filtro = raiz.TryGetProperty("filtro", out var fEl) ? fEl.GetString() : null;
            if (filtro is not null && !filtros.Contains(filtro)) filtro = null;
            var explicacao = raiz.TryGetProperty("explicacao", out var eEl) ? (eEl.GetString() ?? "").Trim() : "";
            if (explicacao.Length > 400) explicacao = explicacao[..400];

            return new PostSugerido(modelo.Id, textos, ordem, filtro, explicacao);
        }
        catch (Exception)
        {
            return null;
        }
    }
}
