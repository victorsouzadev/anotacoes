using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Notas.Api.Services.Imagens;

/// <summary>
/// Reiluminação via IC-Light na Replicate. Usa a MESMA chave do ampliador: é a
/// mesma conta, e pedir dois tokens ao usuário pela mesma origem seria ruído.
/// </summary>
public class ReplicateRelighter : IImageRelighter
{
    private static readonly Dictionary<string, string> Direcoes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["esquerda"] = "Left Light",
        ["direita"] = "Right Light",
        ["cima"] = "Top Light",
        ["baixo"] = "Bottom Light",
    };

    /// <summary>
    /// O texto descreve a CENA, não um desejo artístico. O modelo vai redesenhar
    /// a foto de qualquer jeito — pedir "luz de estúdio suave" sobre uma
    /// descrição fiel rende uma luz plausível para aquele objeto, que é tudo o
    /// que se aproveita daqui.
    /// </summary>
    private const string Prompt =
        "product photo on a plain background, soft even studio lighting, "
        + "gentle highlight on the product, clean soft shadow, professional catalog photo";

    private readonly HttpClient _http;
    private readonly RelightOptions _options;
    private readonly ILogger<ReplicateRelighter> _logger;
    private readonly string _chave;

    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public ReplicateRelighter(HttpClient http, RelightOptions options, string chave, ILogger<ReplicateRelighter> logger)
    {
        _http = http;
        _options = options;
        _chave = chave;
        _logger = logger;
    }

    public bool Disponivel => !string.IsNullOrWhiteSpace(_chave);

    public async Task<ImagemAmpliada> ReiluminarAsync(
        byte[] imagem, string contentType, string direcao, CancellationToken ct = default)
    {
        if (!Disponivel)
        {
            throw new UpscaleIndisponivelException(
                "Nenhuma chave configurada para a IA de imagem. Cadastre a sua em Configurações.");
        }
        if (imagem.Length == 0 || imagem.Length > _options.MaxUploadBytes)
            throw new UpscaleIndisponivelException("Imagem fora do tamanho aceito para reiluminação.");

        if (!Direcoes.TryGetValue(direcao ?? "", out var luz)) luz = "Left Light";

        // O modelo aceita só alguns tamanhos, todos múltiplos de 64 até 1024.
        var lado = Math.Clamp(_options.Lado, 256, 1024) / 64 * 64;
        var largura = Math.Max(256, lado / 2 / 64 * 64);

        var corpo = JsonSerializer.Serialize(new
        {
            version = _options.Version,
            input = new
            {
                subject_image = $"data:{contentType};base64,{Convert.ToBase64String(imagem)}",
                prompt = Prompt,
                light_source = luz,
                width = largura,
                height = lado,
                steps = 25,
                cfg = 2,
                highres_scale = 1.0,
                output_format = "png",
                number_of_images = 1,
            },
        });

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_options.BaseUrl.TrimEnd('/')}/predictions")
        {
            Content = new StringContent(corpo, Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _chave);
        request.Headers.TryAddWithoutValidation("Prefer", "wait=60");

        using var resposta = await _http.SendAsync(request, ct);
        var texto = await resposta.Content.ReadAsStringAsync(ct);
        if (!resposta.IsSuccessStatusCode)
        {
            _logger.LogWarning("Reiluminação recusada: {Status} {Corpo}",
                (int)resposta.StatusCode, texto.Length > 300 ? texto[..300] : texto);
            throw new UpscaleIndisponivelException(resposta.StatusCode switch
            {
                HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => "A chave foi recusada pelo serviço.",
                HttpStatusCode.TooManyRequests => "O serviço está ocupado. Tente de novo em instantes.",
                HttpStatusCode.PaymentRequired => "A conta do serviço está sem crédito.",
                HttpStatusCode.NotFound => "O modelo de reiluminação mudou de versão no serviço.",
                _ => "O serviço de reiluminação não respondeu como esperado.",
            });
        }

        var predicao = JsonSerializer.Deserialize<Predicao>(texto, Json)
            ?? throw new UpscaleIndisponivelException("Resposta vazia do serviço.");
        predicao = await AguardarAsync(predicao, ct);

        var url = UrlDaSaida(predicao) ?? throw new UpscaleIndisponivelException(
            predicao.Error is { Length: > 0 } erro
                ? $"A reiluminação falhou: {erro}"
                : "A reiluminação não devolveu imagem.");

        using var download = await _http.GetAsync(url, ct);
        if (!download.IsSuccessStatusCode)
            throw new UpscaleIndisponivelException("Não consegui baixar o resultado da reiluminação.");

        var bytes = await download.Content.ReadAsByteArrayAsync(ct);
        if (bytes.Length == 0) throw new UpscaleIndisponivelException("O serviço devolveu uma imagem vazia.");

        var tipo = download.Content.Headers.ContentType?.MediaType;
        if (tipo is not ("image/png" or "image/jpeg" or "image/webp")) tipo = "image/png";
        return new ImagemAmpliada(bytes, tipo);
    }

    /// <summary>A difusão quase nunca termina dentro do "Prefer: wait", então o
    /// caminho normal aqui é perguntar até ficar pronta.</summary>
    private async Task<Predicao> AguardarAsync(Predicao predicao, CancellationToken ct)
    {
        var limite = DateTime.UtcNow.AddSeconds(_options.TimeoutSegundos);
        var espera = TimeSpan.FromSeconds(2);

        while (predicao.Status is "starting" or "processing")
        {
            if (DateTime.UtcNow >= limite)
                throw new UpscaleIndisponivelException("A reiluminação demorou demais e foi cancelada.");
            if (predicao.Urls?.Get is not { Length: > 0 } url)
                throw new UpscaleIndisponivelException("O serviço não disse onde buscar o resultado.");

            await Task.Delay(espera, ct);
            espera = TimeSpan.FromSeconds(Math.Min(6, espera.TotalSeconds * 1.4));

            using var consulta = new HttpRequestMessage(HttpMethod.Get, url);
            consulta.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _chave);
            using var resposta = await _http.SendAsync(consulta, ct);
            if (!resposta.IsSuccessStatusCode)
                throw new UpscaleIndisponivelException("Perdi o contato com o serviço no meio da reiluminação.");

            predicao = JsonSerializer.Deserialize<Predicao>(await resposta.Content.ReadAsStringAsync(ct), Json)
                ?? throw new UpscaleIndisponivelException("Resposta vazia do serviço.");
        }

        return predicao;
    }

    private static string? UrlDaSaida(Predicao predicao)
    {
        if (predicao.Status is not "succeeded") return null;
        return predicao.Output.ValueKind switch
        {
            JsonValueKind.String => predicao.Output.GetString(),
            JsonValueKind.Array when predicao.Output.GetArrayLength() > 0 => predicao.Output[0].GetString(),
            _ => null,
        };
    }

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
