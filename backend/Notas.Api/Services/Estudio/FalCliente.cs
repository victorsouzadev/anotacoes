using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace Notas.Api.Services.Estudio;

public sealed record FalFila(string RequestId, string StatusUrl, string ResponseUrl, string CancelUrl, int? Posicao);

public sealed record FalStatus(string Status, int? Posicao, string? UltimoLog);

/// <summary>Erro devolvido pelo provedor, já em texto para mostrar ao usuário.</summary>
public sealed class ErroDoProvedor(string mensagem, bool definitivo) : Exception(mensagem)
{
    /// <summary>Falso para erros passageiros (rede, 429, 5xx): vale tentar de novo.</summary>
    public bool Definitivo { get; } = definitivo;
}

/// <summary>
/// Fila do fal.ai (queue.fal.run): envia o pedido, consulta, busca o resultado e cancela. Os
/// endereços de status/resultado vêm na resposta do envio e só são seguidos se forem do próprio
/// fal — a chave do usuário vai junto em cada chamada.
/// </summary>
public sealed class FalCliente(IHttpClientFactory http, IOptions<EstudioOptions> options, ILogger<FalCliente> log)
{
    public const string NomeHttp = "estudio-fal";

    public async Task<FalFila> Enfileirar(string chave, string endpoint, JsonObject entrada, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{options.Value.FalQueueUrl.TrimEnd('/')}/{endpoint.Trim('/')}")
        {
            Content = new StringContent(entrada.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        var corpo = await Enviar(req, chave, ct);
        var j = JsonNode.Parse(corpo)?.AsObject() ?? throw new ErroDoProvedor("O fal respondeu vazio ao enviar.", false);
        return new FalFila(
            (string?)j["request_id"] ?? throw new ErroDoProvedor("O fal não devolveu o número do pedido.", false),
            (string?)j["status_url"] ?? "",
            (string?)j["response_url"] ?? "",
            (string?)j["cancel_url"] ?? "",
            (int?)j["queue_position"]);
    }

    public async Task<FalStatus> Status(string chave, string statusUrl, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, Conferir(statusUrl) + "?logs=1");
        var j = JsonNode.Parse(await Enviar(req, chave, ct))?.AsObject() ?? [];
        var log = (j["logs"] as JsonArray)?.LastOrDefault()?["message"]?.ToString();
        return new FalStatus((string?)j["status"] ?? "IN_QUEUE", (int?)j["queue_position"], log);
    }

    public async Task<JsonNode> Resultado(string chave, string responseUrl, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, Conferir(responseUrl));
        return JsonNode.Parse(await Enviar(req, chave, ct)) ?? new JsonObject();
    }

    public async Task Cancelar(string chave, string cancelUrl, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Put, Conferir(cancelUrl));
        try { await Enviar(req, chave, ct); }
        catch (ErroDoProvedor e) { log.LogInformation("fal: cancelamento recusado ({Erro})", e.Message); }
    }

    /// <summary>
    /// Sobe um arquivo para o armazenamento do fal e devolve a URL pública dele, que os modelos
    /// conseguem baixar (o hub pode estar atrás de login ou rodando no PC, sem endereço público).
    /// </summary>
    public async Task<string> SubirArquivo(string chave, Stream conteudo, string contentType, string nome, CancellationToken ct)
    {
        using var inicio = new HttpRequestMessage(HttpMethod.Post,
            $"{options.Value.FalRestUrl.TrimEnd('/')}/storage/upload/initiate?storage_type=fal-cdn-v3")
        {
            Content = JsonContent.Create(new { content_type = contentType, file_name = nome }),
        };
        var j = JsonNode.Parse(await Enviar(inicio, chave, ct))?.AsObject() ?? [];
        var upload = (string?)j["upload_url"];
        var publico = (string?)j["file_url"];
        if (string.IsNullOrEmpty(upload) || string.IsNullOrEmpty(publico))
            throw new ErroDoProvedor("O fal não devolveu onde subir o arquivo.", false);

        using var put = new HttpRequestMessage(HttpMethod.Put, upload) { Content = new StreamContent(conteudo) };
        put.Content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        using var cliente = http.CreateClient(NomeHttp);
        using var res = await cliente.SendAsync(put, ct);
        if (!res.IsSuccessStatusCode)
            throw new ErroDoProvedor($"Falhou ao subir o arquivo para o fal ({(int)res.StatusCode}).", false);
        return publico;
    }

    /// <summary>Baixa um arquivo de resultado (URL pública do CDN do fal).</summary>
    public async Task<(Stream Conteudo, string? ContentType, HttpResponseMessage Resposta)> Baixar(string url, CancellationToken ct)
    {
        var cliente = http.CreateClient(NomeHttp);
        var res = await cliente.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!res.IsSuccessStatusCode)
        {
            res.Dispose();
            throw new ErroDoProvedor($"Não consegui baixar o resultado ({(int)res.StatusCode}).", res.StatusCode != HttpStatusCode.TooManyRequests && (int)res.StatusCode < 500);
        }
        return (await res.Content.ReadAsStreamAsync(ct), res.Content.Headers.ContentType?.MediaType, res);
    }

    private async Task<string> Enviar(HttpRequestMessage req, string chave, CancellationToken ct)
    {
        req.Headers.Authorization = new AuthenticationHeaderValue("Key", chave);
        using var cliente = http.CreateClient(NomeHttp);
        HttpResponseMessage res;
        try
        {
            res = await cliente.SendAsync(req, ct);
        }
        catch (HttpRequestException e)
        {
            throw new ErroDoProvedor("Sem conexão com o fal.ai: " + e.Message, false);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new ErroDoProvedor("O fal.ai demorou demais para responder.", false);
        }
        using (res)
        {
            var corpo = await res.Content.ReadAsStringAsync(ct);
            if (res.IsSuccessStatusCode) return corpo;
            var codigo = (int)res.StatusCode;
            var mensagem = codigo switch
            {
                401 or 403 => "O fal.ai recusou a chave (confira em Estúdio › Configurações).",
                402 => "Sem saldo no fal.ai. Recarregue em fal.ai/dashboard/billing.",
                _ => MensagemDeErro(corpo) is { } m ? $"fal.ai ({codigo}): {m}" : $"fal.ai respondeu {codigo}.",
            };
            throw new ErroDoProvedor(mensagem, codigo is not (429 or >= 500));
        }
    }

    /// <summary>Lê o "detail" do fal, que vem como texto ou como a lista de erros de validação.</summary>
    public static string? MensagemDeErro(string corpo)
    {
        try
        {
            var j = JsonNode.Parse(corpo);
            var detalhe = j?["detail"] ?? j?["error"] ?? j?["message"];
            return detalhe switch
            {
                JsonArray lista => string.Join("; ", lista.Select(e =>
                {
                    var campo = e?["loc"] is JsonArray loc ? string.Join(".", loc.Skip(1).Select(x => x?.ToString())) : null;
                    var msg = (string?)e?["msg"] ?? e?.ToString();
                    return string.IsNullOrEmpty(campo) ? msg : $"{campo}: {msg}";
                })),
                JsonValue v => v.ToString(),
                JsonObject o => (string?)o["message"] ?? o.ToJsonString(),
                _ => corpo.Length > 300 ? corpo[..300] : corpo.Length > 0 ? corpo : null,
            };
        }
        catch (JsonException)
        {
            return corpo.Length > 300 ? corpo[..300] : corpo.Length > 0 ? corpo : null;
        }
    }

    private string Conferir(string url)
    {
        var uri = new Uri(url);
        var permitido = new Uri(options.Value.FalQueueUrl).Host;
        if (!string.Equals(uri.Host, permitido, StringComparison.OrdinalIgnoreCase))
            throw new ErroDoProvedor($"Endereço inesperado devolvido pelo fal: {uri.Host}.", true);
        return uri.GetLeftPart(UriPartial.Path);
    }
}
