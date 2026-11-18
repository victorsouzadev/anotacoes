using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Hub.Core;
using Hub.Data;
using Hub.Pipeline;
using Microsoft.Extensions.Options;

namespace Hub.Index;

public sealed record EffectiveEmbeddings(string BaseUrl, string Model, string ApiKey, string KeySource)
{
    public bool Enabled => ApiKey.Length > 0;
}

/// <summary>
/// Embeddings para a busca semântica (spec 027), por API compatível com OpenAI. A chave é a de
/// <c>Hub__Embeddings__ApiKey</c> ou, sem ela, a da transcrição quando é da OpenAI. Ligado/desligado
/// fica no hub.db e nasce desligado (custa por uso).
/// </summary>
public sealed class Embeddings
{
    private const string LigadoKey = "busca_semantica";
    /// <summary>Preço do text-embedding-3-small (US$ por milhão de tokens), para a estimativa da tela.</summary>
    public const double PrecoPorMilhaoUsd = 0.02;

    private readonly IHttpClientFactory _http;
    private readonly HubOptions _options;
    private readonly TranscriptionSettings _transcricao;
    private readonly HubDb _db;

    public Embeddings(IHttpClientFactory http, IOptions<HubOptions> options, TranscriptionSettings transcricao, HubDb db)
    {
        _http = http;
        _options = options.Value;
        _transcricao = transcricao;
        _db = db;
    }

    public bool Ligado => _db.GetSetting(LigadoKey)?.Value == "true";

    public void SetLigado(bool ligado) => _db.SetSetting(LigadoKey, ligado ? "true" : "false");

    public EffectiveEmbeddings Resolve()
    {
        var e = _options.Embeddings;
        if (!string.IsNullOrWhiteSpace(e.ApiKey)) return new(e.BaseUrl, e.Model, e.ApiKey.Trim(), "servidor");
        var t = _transcricao.Resolve();
        if (t.Enabled && t.BaseUrl.Contains("api.openai.com", StringComparison.OrdinalIgnoreCase))
            return new(e.BaseUrl, e.Model, t.ApiKey, "transcricao");
        return new(e.BaseUrl, e.Model, "", "nenhuma");
    }

    /// <summary>Ligado e com chave: só então a busca usa vetores.</summary>
    public bool Ativo => Ligado && Resolve().Enabled;

    /// <summary>Vetores normalizados, na mesma ordem dos textos.</summary>
    public async Task<float[][]> EmbedAsync(IReadOnlyList<string> textos, CancellationToken ct)
    {
        var cfg = Resolve();
        if (!cfg.Enabled) throw new InvalidOperationException("Busca semântica sem chave de embeddings.");
        var payload = new JsonObject { ["model"] = cfg.Model, ["input"] = new JsonArray(textos.Select(t => (JsonNode?)JsonValue.Create(t)).ToArray()) };
        using var req = new HttpRequestMessage(HttpMethod.Post, cfg.BaseUrl.TrimEnd('/') + "/embeddings")
        {
            Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", cfg.ApiKey);
        using var res = await _http.CreateClient("embeddings").SendAsync(req, ct);
        var json = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException($"Embeddings {(int)res.StatusCode}: {(json.Length > 300 ? json[..300] : json)}");
        var data = JsonNode.Parse(json)?["data"]?.AsArray() ?? throw new InvalidOperationException("Resposta de embeddings sem data.");
        var vetores = new float[textos.Count][];
        foreach (var item in data)
        {
            var idx = item?["index"]?.GetValue<int>() ?? 0;
            var v = item?["embedding"]?.AsArray().Select(x => x!.GetValue<float>()).ToArray() ?? [];
            if (idx >= 0 && idx < vetores.Length) vetores[idx] = HybridRanker.Normalizar(v);
        }
        if (vetores.Any(v => v is null)) throw new InvalidOperationException("Resposta de embeddings incompleta.");
        return vetores;
    }
}
