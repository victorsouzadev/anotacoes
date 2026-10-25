using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace Notas.Api.Services.Estudio;

public sealed record MundoPronto(string? WorldId, string? LinkMarble, string? Splat, string? SplatLeve, string? Panorama, string? Colisao, string? Miniatura, string? Legenda);

/// <summary>
/// API Marble da World Labs (mundos 3D exploráveis). Fluxo: worlds:generate devolve uma operação,
/// que é consultada até terminar com o mundo (splats .spz, panorama, malha de colisão).
/// </summary>
public sealed class WorldLabsCliente(IHttpClientFactory http, IOptions<EstudioOptions> options)
{
    public async Task<string> Gerar(string chave, string modelo, string? prompt, (byte[] Bytes, string Extensao)? imagem, CancellationToken ct)
    {
        JsonObject mundo = imagem is { } img
            ? new JsonObject
            {
                ["type"] = "image",
                ["image_prompt"] = new JsonObject { ["source"] = "data_base64", ["data_base64"] = Convert.ToBase64String(img.Bytes), ["extension"] = img.Extensao.TrimStart('.') },
            }
            : new JsonObject { ["type"] = "text" };
        if (!string.IsNullOrWhiteSpace(prompt)) mundo["text_prompt"] = prompt;
        var corpo = new JsonObject { ["world_prompt"] = mundo, ["model"] = modelo, ["display_name"] = Titulo(prompt) };

        using var req = new HttpRequestMessage(HttpMethod.Post, $"{Base}/marble/v1/worlds:generate") { Content = JsonContent.Create(corpo) };
        var j = await Enviar(req, chave, ct);
        if (j["error"] is JsonObject erro) throw new ErroDoProvedor("World Labs: " + ((string?)erro["message"] ?? "erro ao gerar"), true);
        return (string?)j["operation_id"] ?? throw new ErroDoProvedor("A World Labs não devolveu a operação.", false);
    }

    /// <summary>Null enquanto o mundo não fica pronto.</summary>
    public async Task<MundoPronto?> Consultar(string chave, string operacao, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{Base}/marble/v1/operations/{Uri.EscapeDataString(operacao)}");
        var j = await Enviar(req, chave, ct);
        if (j["error"] is JsonObject erro && erro.Count > 0)
            throw new ErroDoProvedor("World Labs: " + ((string?)erro["message"] ?? "a geração falhou"), true);
        if ((bool?)j["done"] != true) return null;
        var w = j["response"];
        var assets = w?["assets"];
        var spz = assets?["splats"]?["spz_urls"];
        return new MundoPronto(
            (string?)w?["world_id"],
            (string?)w?["world_marble_url"],
            (string?)spz?["500k"] ?? (string?)spz?["full_res"] ?? (string?)spz?["100k"],
            (string?)spz?["100k"],
            (string?)assets?["imagery"]?["pano_url"],
            (string?)assets?["mesh"]?["collider_mesh_url"],
            (string?)assets?["thumbnail_url"],
            (string?)assets?["caption"]);
    }

    private string Base => options.Value.WorldLabsUrl.TrimEnd('/');

    private async Task<JsonObject> Enviar(HttpRequestMessage req, string chave, CancellationToken ct)
    {
        req.Headers.Add("WLT-Api-Key", chave);
        using var cliente = http.CreateClient(FalCliente.NomeHttp);
        HttpResponseMessage res;
        try { res = await cliente.SendAsync(req, ct); }
        catch (HttpRequestException e) { throw new ErroDoProvedor("Sem conexão com a World Labs: " + e.Message, false); }
        using (res)
        {
            var corpo = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode)
            {
                var codigo = (int)res.StatusCode;
                var msg = codigo is 401 or 403 ? "A World Labs recusou a chave (confira em Estúdio › Configurações)."
                    : $"World Labs ({codigo}): {FalCliente.MensagemDeErro(corpo) ?? "erro"}";
                throw new ErroDoProvedor(msg, codigo is not (429 or >= 500));
            }
            return JsonNode.Parse(corpo)?.AsObject() ?? [];
        }
    }

    private static string Titulo(string? prompt)
    {
        var t = string.IsNullOrWhiteSpace(prompt) ? "Mundo do Estúdio" : prompt.Trim();
        return t.Length > 60 ? t[..60] : t;
    }
}
