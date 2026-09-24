using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Notas.Api.Services.Imagens;

/// <summary>
/// Remoção de fundo na Replicate, com a MESMA chave do ampliador (mesma conta,
/// mesmo serviço). O modelo é configurável: modelos de recorte mudam de dono e
/// de versão com frequência, e trocar não deve exigir deploy.
/// </summary>
public class ReplicateBackgroundRemover : IBackgroundRemover
{
    private readonly HttpClient _http;
    private readonly RemoveBgOptions _options;
    private readonly ILogger<ReplicateBackgroundRemover> _logger;
    private readonly string _chave;

    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public ReplicateBackgroundRemover(HttpClient http, RemoveBgOptions options, string chave, ILogger<ReplicateBackgroundRemover> logger)
    {
        _http = http;
        _options = options;
        _chave = chave;
        _logger = logger;
    }

    public bool Disponivel => !string.IsNullOrWhiteSpace(_chave);

    public async Task<ImagemAmpliada> RemoverFundoAsync(byte[] imagem, string contentType, CancellationToken ct = default)
    {
        if (!Disponivel)
        {
            throw new UpscaleIndisponivelException(
                "Nenhuma chave configurada para a IA de imagem. Cadastre a sua em Configurações.");
        }
        if (imagem.Length == 0 || imagem.Length > _options.MaxUploadBytes)
            throw new UpscaleIndisponivelException("Imagem fora do tamanho aceito para remover o fundo.", tentarMenor: true);

        var entrada = new Dictionary<string, object>
        {
            [_options.CampoImagem] = $"data:{contentType};base64,{Convert.ToBase64String(imagem)}",
        };
        var porVersao = !string.IsNullOrWhiteSpace(_options.Version);
        var corpo = porVersao
            ? JsonSerializer.Serialize(new { version = _options.Version, input = entrada })
            : JsonSerializer.Serialize(new { input = entrada });
        var url = porVersao
            ? $"{_options.BaseUrl.TrimEnd('/')}/predictions"
            : $"{_options.BaseUrl.TrimEnd('/')}/models/{_options.Model}/predictions";

        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(corpo, Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _chave);
        request.Headers.TryAddWithoutValidation("Prefer", "wait=30");

        using var resposta = await _http.SendAsync(request, ct);
        var texto = await resposta.Content.ReadAsStringAsync(ct);
        if (!resposta.IsSuccessStatusCode)
        {
            _logger.LogWarning("Remoção de fundo recusada: {Status} {Corpo}",
                (int)resposta.StatusCode, texto.Length > 300 ? texto[..300] : texto);
            throw new UpscaleIndisponivelException(resposta.StatusCode switch
            {
                HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => "A chave foi recusada pelo serviço.",
                HttpStatusCode.TooManyRequests => "O serviço está ocupado. Tente de novo em instantes.",
                HttpStatusCode.PaymentRequired => "A conta do serviço está sem crédito.",
                HttpStatusCode.NotFound => "O modelo de remoção de fundo mudou no serviço.",
                HttpStatusCode.RequestEntityTooLarge => "Foto grande demais para o serviço.",
                _ => "O serviço de remoção de fundo não respondeu como esperado.",
            }, tentarMenor: resposta.StatusCode == HttpStatusCode.RequestEntityTooLarge);
        }

        var predicao = JsonSerializer.Deserialize<Predicao>(texto, Json)
            ?? throw new UpscaleIndisponivelException("Resposta vazia do serviço.");
        predicao = await AguardarAsync(predicao, ct);

        var saida = UrlDaSaida(predicao) ?? throw new UpscaleIndisponivelException(
            predicao.Error is { Length: > 0 } erro
                ? $"A remoção de fundo falhou: {erro}"
                : "A remoção de fundo não devolveu imagem.");

        using var download = await _http.GetAsync(saida, ct);
        if (!download.IsSuccessStatusCode)
            throw new UpscaleIndisponivelException("Não consegui baixar o recorte.");

        var bytes = await download.Content.ReadAsByteArrayAsync(ct);
        if (bytes.Length == 0) throw new UpscaleIndisponivelException("O serviço devolveu uma imagem vazia.");

        var tipo = download.Content.Headers.ContentType?.MediaType;
        if (tipo is not ("image/png" or "image/webp")) tipo = "image/png";
        return new ImagemAmpliada(bytes, tipo);
    }

    private async Task<Predicao> AguardarAsync(Predicao predicao, CancellationToken ct)
    {
        var limite = DateTime.UtcNow.AddSeconds(_options.TimeoutSegundos);
        var espera = TimeSpan.FromSeconds(1);

        while (predicao.Status is "starting" or "processing")
        {
            if (DateTime.UtcNow >= limite)
                throw new UpscaleIndisponivelException("A remoção de fundo demorou demais e foi cancelada.");
            if (predicao.Urls?.Get is not { Length: > 0 } url)
                throw new UpscaleIndisponivelException("O serviço não disse onde buscar o resultado.");

            await Task.Delay(espera, ct);
            espera = TimeSpan.FromSeconds(Math.Min(4, espera.TotalSeconds * 1.5));

            using var consulta = new HttpRequestMessage(HttpMethod.Get, url);
            consulta.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _chave);
            using var resposta = await _http.SendAsync(consulta, ct);
            if (!resposta.IsSuccessStatusCode)
                throw new UpscaleIndisponivelException("Perdi o contato com o serviço no meio da remoção de fundo.");

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
