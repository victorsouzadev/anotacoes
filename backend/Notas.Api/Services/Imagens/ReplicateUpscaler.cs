using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Notas.Api.Services.Imagens;

/// <summary>
/// Ampliação via Replicate. O fluxo de lá é assíncrono — cria-se uma predição e
/// pergunta-se por ela até ficar pronta —, mas o cabeçalho <c>Prefer: wait</c>
/// segura a resposta até o fim quando o modelo é rápido. A consulta em laço fica
/// como caminho secundário, para quando a fila do serviço estiver cheia.
/// </summary>
public class ReplicateUpscaler : IImageUpscaler
{
    private readonly HttpClient _http;
    private readonly UpscaleOptions _options;
    private readonly ILogger<ReplicateUpscaler> _logger;

    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public ReplicateUpscaler(HttpClient http, IOptions<UpscaleOptions> options, ILogger<ReplicateUpscaler> logger)
    {
        _http = http;
        _options = options.Value;
        _logger = logger;
    }

    public bool Disponivel => !string.IsNullOrWhiteSpace(_options.ApiKey);

    public async Task<ImagemAmpliada> AmpliarAsync(byte[] imagem, string contentType, int escala, CancellationToken ct = default)
    {
        if (!Disponivel)
        {
            throw new UpscaleIndisponivelException(
                "Nenhuma chave de ampliação configurada no servidor (defina Upscale__ApiKey).");
        }
        if (imagem.Length == 0)
            throw new UpscaleIndisponivelException("Imagem vazia.");
        if (imagem.Length > _options.MaxUploadBytes)
            throw new UpscaleIndisponivelException("Imagem grande demais para ampliar. Reduza antes de enviar.");

        escala = Math.Clamp(escala, 2, Math.Max(2, _options.MaxEscala));

        var dataUrl = $"data:{contentType};base64,{Convert.ToBase64String(imagem)}";
        var corpo = JsonSerializer.Serialize(new
        {
            input = new
            {
                image = dataUrl,
                scale = escala,
                // Restauração de rosto muda traço de pessoa; num editor de post de
                // produto isso é defeito, não recurso. Fica desligada.
                face_enhance = false,
            },
        });

        using var request = new HttpRequestMessage(
            HttpMethod.Post, $"{_options.BaseUrl.TrimEnd('/')}/models/{_options.Model}/predictions")
        {
            Content = new StringContent(corpo, Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);
        // Segura a resposta até o modelo terminar, em vez de devolver "em fila".
        request.Headers.TryAddWithoutValidation("Prefer", $"wait={Math.Clamp(_options.TimeoutSegundos - 10, 5, 60)}");

        using var resposta = await _http.SendAsync(request, ct);
        var texto = await resposta.Content.ReadAsStringAsync(ct);
        if (!resposta.IsSuccessStatusCode)
        {
            _logger.LogWarning("Ampliação recusada pelo serviço: {Status} {Corpo}", (int)resposta.StatusCode, Resumo(texto));
            throw new UpscaleIndisponivelException(resposta.StatusCode switch
            {
                HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => "A chave de ampliação foi recusada pelo serviço.",
                HttpStatusCode.TooManyRequests => "O serviço de ampliação está ocupado. Tente de novo em instantes.",
                HttpStatusCode.PaymentRequired => "A conta do serviço de ampliação está sem crédito.",
                _ => "O serviço de ampliação não respondeu como esperado.",
            });
        }

        var predicao = JsonSerializer.Deserialize<Predicao>(texto, Json)
            ?? throw new UpscaleIndisponivelException("Resposta vazia do serviço de ampliação.");
        predicao = await AguardarAsync(predicao, ct);

        var url = UrlDaSaida(predicao) ?? throw Falha(predicao.Error);

        return await BaixarAsync(url, ct);
    }

    /// <summary>Pergunta pela predição até ela sair da fila, respeitando o teto de espera.</summary>
    private async Task<Predicao> AguardarAsync(Predicao predicao, CancellationToken ct)
    {
        var limite = DateTime.UtcNow.AddSeconds(_options.TimeoutSegundos);
        var espera = TimeSpan.FromSeconds(1);

        while (predicao.Status is "starting" or "processing")
        {
            if (DateTime.UtcNow >= limite)
                throw new UpscaleIndisponivelException("A ampliação demorou demais e foi cancelada.");
            if (predicao.Urls?.Get is not { Length: > 0 } url)
                throw new UpscaleIndisponivelException("O serviço de ampliação não disse onde buscar o resultado.");

            await Task.Delay(espera, ct);
            // Espera crescente: a primeira resposta costuma vir rápido, e insistir
            // a cada segundo só gasta requisição.
            espera = TimeSpan.FromSeconds(Math.Min(5, espera.TotalSeconds * 1.5));

            using var consulta = new HttpRequestMessage(HttpMethod.Get, url);
            consulta.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);
            using var resposta = await _http.SendAsync(consulta, ct);
            if (!resposta.IsSuccessStatusCode)
                throw new UpscaleIndisponivelException("Perdi o contato com o serviço no meio da ampliação.");

            predicao = JsonSerializer.Deserialize<Predicao>(await resposta.Content.ReadAsStringAsync(ct), Json)
                ?? throw new UpscaleIndisponivelException("Resposta vazia do serviço de ampliação.");
        }

        return predicao;
    }

    private async Task<ImagemAmpliada> BaixarAsync(string url, CancellationToken ct)
    {
        using var resposta = await _http.GetAsync(url, ct);
        if (!resposta.IsSuccessStatusCode)
            throw new UpscaleIndisponivelException("Não consegui baixar a imagem ampliada.");

        var bytes = await resposta.Content.ReadAsByteArrayAsync(ct);
        if (bytes.Length == 0)
            throw new UpscaleIndisponivelException("O serviço devolveu uma imagem vazia.");

        var tipo = resposta.Content.Headers.ContentType?.MediaType;
        // Só formato que o navegador sabe desenhar volta pro editor.
        if (tipo is not ("image/png" or "image/jpeg" or "image/webp")) tipo = "image/png";
        return new ImagemAmpliada(bytes, tipo);
    }

    /// <summary>A saída vem como texto ou como lista, dependendo do modelo.</summary>
    private static string? UrlDaSaida(Predicao predicao)
    {
        if (predicao.Status is not "succeeded") return null;
        return predicao.Output.ValueKind switch
        {
            JsonValueKind.String => predicao.Output.GetString(),
            JsonValueKind.Array when predicao.Output.GetArrayLength() > 0
                => predicao.Output[0].GetString(),
            _ => null,
        };
    }

    /// <summary>
    /// Traduz a falha do modelo e diz se vale tentar de novo com a foto menor.
    /// São duas falhas de tamanho, e elas são diferentes:
    ///
    /// - o limite declarado do modelo ("greater than the max size that fits in
    ///   GPU memory") é fixo e a recusa é imediata;
    /// - a falta de memória de verdade ("CUDA out of memory") depende de quem
    ///   mais está na mesma GPU naquele instante, então a mesma foto pode passar
    ///   daqui a pouco — e passa quase sempre se for menor.
    /// </summary>
    private static UpscaleIndisponivelException Falha(string? erro)
    {
        if (string.IsNullOrWhiteSpace(erro))
            return new UpscaleIndisponivelException("A ampliação não devolveu imagem.");

        if (erro.Contains("out of memory", StringComparison.OrdinalIgnoreCase))
        {
            return new UpscaleIndisponivelException(
                "A GPU do serviço ficou sem memória para esta foto. O tamanho que cabe varia conforme "
                + "quem mais está usando o serviço no momento — tentando de novo com a foto menor.",
                tentarMenor: true);
        }

        if (erro.Contains("fits in GPU memory", StringComparison.OrdinalIgnoreCase)
            || erro.Contains("greater than the max size", StringComparison.OrdinalIgnoreCase))
        {
            return new UpscaleIndisponivelException(
                "Essa foto passa do tamanho que o ampliador aceita. Numa foto desse tamanho, porém, "
                + "ampliar não acrescenta nada: ela já tem pixel de sobra.",
                tentarMenor: true);
        }

        return new UpscaleIndisponivelException($"A ampliação falhou: {erro}");
    }

    private static string Resumo(string texto) => texto.Length <= 300 ? texto : texto[..300];

    private record Predicao
    {
        public string Status { get; init; } = "";
        public JsonElement Output { get; init; }
        public string? Error { get; init; }
        public PredicaoUrls? Urls { get; init; }
    }

    private record PredicaoUrls
    {
        public string? Get { get; init; }
    }
}
