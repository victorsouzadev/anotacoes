using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Notas.Api.Services.Financas.Llm;

namespace Notas.Api.Services.Imagens;

/// <summary>
/// Dá nome aos elementos do Editor de Imagens olhando para eles.
///
/// Depois de dividir uma folha, os itens saem como "proj 1", "proj 2"… — e um ZIP
/// com seis arquivos numerados obriga a abrir um por um para saber qual é qual.
/// Aqui as miniaturas vão para o mesmo provedor de LLM já configurado nas
/// Finanças (a chave continua morando só no servidor) e voltam nomes como
/// "polvo-maria-clara" ou "tartaruga".
/// </summary>
public record NomeacaoResultado(IReadOnlyList<string> Nomes, bool UsouIa, string? Motivo);

public interface INomeadorDeElementos
{
    Task<NomeacaoResultado> NomearAsync(string userId, IReadOnlyList<string> imagens, CancellationToken ct = default);
}

public class NomeadorDeElementos : INomeadorDeElementos
{
    /// <summary>Teto de imagens por chamada — uma folha cheia de adesivos cabe.</summary>
    public const int MaxImagens = 40;

    private readonly ILlmExtractorFactory _factory;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly OpenRouterOptions _padrao;
    private readonly ILogger<NomeadorDeElementos> _logger;

    public NomeadorDeElementos(
        ILlmExtractorFactory factory,
        IHttpClientFactory httpClientFactory,
        IOptions<OpenRouterOptions> padrao,
        ILogger<NomeadorDeElementos> logger)
    {
        _factory = factory;
        _httpClientFactory = httpClientFactory;
        _padrao = padrao.Value;
        _logger = logger;
    }

    public async Task<NomeacaoResultado> NomearAsync(
        string userId, IReadOnlyList<string> imagens, CancellationToken ct = default)
    {
        if (imagens.Count == 0) return new NomeacaoResultado(Array.Empty<string>(), false, "Nenhuma imagem enviada.");

        var credenciais = await _factory.ResolverCredenciaisAsync(userId, ct);
        // Só o caminho da OpenRouter recebe imagem nesta instalação; sem ele o
        // editor mantém os nomes que já tinha, em vez de falhar a exportação.
        if (credenciais.Provedor != "openrouter" || string.IsNullOrWhiteSpace(credenciais.Chave))
        {
            return new NomeacaoResultado(Array.Empty<string>(), false,
                "Nenhum provedor de IA que leia imagens está configurado. Cadastre uma chave da OpenRouter em Configurações.");
        }

        var corpo = JsonSerializer.Serialize(MontarCorpo(credenciais.Modelo, imagens));
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(_padrao.TimeoutComAnexosSegundos));

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, _padrao.BaseUrl);
            request.Headers.Add("Authorization", $"Bearer {credenciais.Chave}");
            request.Headers.Add("HTTP-Referer", _padrao.Referer);
            request.Headers.Add("X-Title", "Anotacoes - Editor de Imagens");
            request.Content = new StringContent(corpo, Encoding.UTF8, "application/json");

            var http = _httpClientFactory.CreateClient(nameof(NomeadorDeElementos));
            using var resposta = await http.SendAsync(request, cts.Token);
            var texto = await resposta.Content.ReadAsStringAsync(cts.Token);

            if (!resposta.IsSuccessStatusCode)
            {
                _logger.LogError("OpenRouter respondeu {Status} ao nomear elementos: {Corpo}",
                    resposta.StatusCode, texto.Length > 400 ? texto[..400] : texto);
                return new NomeacaoResultado(Array.Empty<string>(), false,
                    resposta.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.PaymentRequired
                        ? "A OpenRouter recusou a chave de API (verifique a chave e o saldo)."
                        : $"O serviço de IA não respondeu ({(int)resposta.StatusCode}).");
            }

            var nomes = LerNomes(texto, imagens.Count);
            return nomes.Count > 0
                ? new NomeacaoResultado(nomes, true, null)
                : new NomeacaoResultado(Array.Empty<string>(), false, "A IA respondeu num formato inesperado.");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Falha ao nomear elementos com a IA.");
            return new NomeacaoResultado(Array.Empty<string>(), false, "Não foi possível falar com o serviço de IA.");
        }
    }

    private object MontarCorpo(string modelo, IReadOnlyList<string> imagens)
    {
        var partes = new List<object>
        {
            new { type = "text", text = Prompt(imagens.Count) },
        };
        foreach (var imagem in imagens)
        {
            partes.Add(new { type = "image_url", image_url = new { url = imagem } });
        }

        return new
        {
            model = modelo,
            max_tokens = 600,
            temperature = 0,
            response_format = new { type = "json_object" },
            messages = new object[] { new { role = "user", content = partes } },
        };
    }

    private static string Prompt(int quantidade) =>
        $$"""
        Estas são {{quantidade}} artes que vão virar adesivos ou recortes, uma por imagem, na ordem em que aparecem.
        Dê a cada uma um nome curto de arquivo que descreva o que ela é, para quem for procurar o arquivo depois.

        Regras de cada nome:
        - português, minúsculas, palavras separadas por hífen, sem acento e sem extensão;
        - no máximo quatro palavras; descreva o desenho e, se houver texto na arte, inclua-o;
        - nomes diferentes entre si, mesmo que as artes sejam parecidas (use um número no fim só nesse caso);
        - nada de "imagem", "arte", "elemento" ou "adesivo" sozinho: diga o que é.

        Responda só com JSON: {"nomes": ["...", "..."]} — exatamente {{quantidade}} nomes, na mesma ordem das imagens.
        """;

    /// <summary>Lê os nomes da resposta e os deixa seguros para virar arquivo.</summary>
    private static IReadOnlyList<string> LerNomes(string corpo, int esperado)
    {
        try
        {
            using var doc = JsonDocument.Parse(corpo);
            if (doc.RootElement.TryGetProperty("error", out _)) return Array.Empty<string>();

            var conteudo = doc.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString() ?? "";

            var limpo = conteudo.Trim();
            // Alguns modelos devolvem o JSON dentro de um bloco de markdown.
            if (limpo.StartsWith("```"))
            {
                var inicio = limpo.IndexOf('\n');
                var fim = limpo.LastIndexOf("```", StringComparison.Ordinal);
                if (inicio > 0 && fim > inicio) limpo = limpo[(inicio + 1)..fim].Trim();
            }

            using var resposta = JsonDocument.Parse(limpo);
            if (!resposta.RootElement.TryGetProperty("nomes", out var lista) || lista.ValueKind != JsonValueKind.Array)
            {
                return Array.Empty<string>();
            }

            var nomes = lista.EnumerateArray()
                .Select(n => Sanear(n.GetString()))
                .Where(n => n.Length > 0)
                .Take(esperado)
                .ToList();

            return nomes.Count == esperado ? nomes : Array.Empty<string>();
        }
        catch (Exception)
        {
            return Array.Empty<string>();
        }
    }

    /// <summary>Tira acento, espaço e qualquer coisa que não sirva em nome de arquivo.</summary>
    public static string Sanear(string? bruto)
    {
        if (string.IsNullOrWhiteSpace(bruto)) return "";

        var semAcento = new StringBuilder();
        // Sem ICU (container em modo globalization-invariant) o Normalize não
        // decompõe "ç" em "c" + cedilha: os acentos do português vão por tabela.
        foreach (var c in TrocarAcentos(bruto).Normalize(NormalizationForm.FormD))
        {
            var categoria = System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c);
            if (categoria != System.Globalization.UnicodeCategory.NonSpacingMark) semAcento.Append(c);
        }

        var saida = new StringBuilder();
        foreach (var c in semAcento.ToString().Normalize(NormalizationForm.FormC).ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(c) && c < 128) saida.Append(c);
            else if (saida.Length > 0 && saida[^1] != '-') saida.Append('-');
        }

        return saida.ToString().Trim('-');
    }

    private const string ComAcento = "áàâãäåçéèêëíìîïñóòôõöúùûüýÿÁÀÂÃÄÅÇÉÈÊËÍÌÎÏÑÓÒÔÕÖÚÙÛÜÝ";
    private const string SemAcento = "aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY";

    private static string TrocarAcentos(string texto)
    {
        var chars = texto.ToCharArray();
        for (var i = 0; i < chars.Length; i++)
        {
            var k = ComAcento.IndexOf(chars[i]);
            if (k >= 0) chars[i] = SemAcento[k];
        }
        return new string(chars);
    }
}
