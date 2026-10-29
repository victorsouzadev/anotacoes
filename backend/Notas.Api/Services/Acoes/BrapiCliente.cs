using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace Notas.Api.Services.Acoes;

public record Cotacao(string Ticker, string? Nome, decimal Preco, decimal? VariacaoDia, DateTime Em);

public interface ICotacoes
{
    /// <summary>Cotação de cada ticker que a fonte conhecer; os que falharem ficam de fora.</summary>
    Task<Dictionary<string, Cotacao>> ObterAsync(IEnumerable<string> tickers, CancellationToken ct);
}

/// <summary>
/// Cotações da B3 pela brapi.dev. Um pedido por ativo (o plano grátis não aceita vários de uma vez)
/// e cache de 5 minutos. Sem token (Brapi__Token) só alguns ativos de teste respondem.
/// </summary>
public class BrapiCliente(IHttpClientFactory http, IMemoryCache cache, IConfiguration config, ILogger<BrapiCliente> log) : ICotacoes
{
    private static readonly TimeSpan Validade = TimeSpan.FromMinutes(5);

    public async Task<Dictionary<string, Cotacao>> ObterAsync(IEnumerable<string> tickers, CancellationToken ct)
    {
        var tarefas = tickers.Distinct().Select(t => ObterUmaAsync(t, ct));
        var resultado = await Task.WhenAll(tarefas);
        return resultado.Where(c => c is not null).ToDictionary(c => c!.Ticker, c => c!);
    }

    private async Task<Cotacao?> ObterUmaAsync(string ticker, CancellationToken ct)
    {
        if (cache.TryGetValue($"brapi:{ticker}", out Cotacao? emCache)) return emCache;
        try
        {
            var token = config["Brapi:Token"];
            var url = $"api/quote/{Uri.EscapeDataString(ticker)}" + (string.IsNullOrWhiteSpace(token) ? "" : $"?token={Uri.EscapeDataString(token)}");
            using var res = await http.CreateClient(nameof(BrapiCliente)).GetAsync(url, ct);
            if (!res.IsSuccessStatusCode)
            {
                log.LogInformation("brapi respondeu {Status} para {Ticker}", (int)res.StatusCode, ticker);
                return null;
            }
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStreamAsync(ct));
            var r = doc.RootElement.GetProperty("results")[0];
            if (!r.TryGetProperty("regularMarketPrice", out var preco) || preco.ValueKind != JsonValueKind.Number) return null;
            var cotacao = new Cotacao(
                ticker,
                r.TryGetProperty("longName", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString()
                    : r.TryGetProperty("shortName", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString() : null,
                preco.GetDecimal(),
                r.TryGetProperty("regularMarketChangePercent", out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDecimal() : null,
                r.TryGetProperty("regularMarketTime", out var t) && t.ValueKind == JsonValueKind.String && t.TryGetDateTime(out var em)
                    ? em.ToUniversalTime() : DateTime.UtcNow);
            cache.Set($"brapi:{ticker}", cotacao, Validade);
            return cotacao;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or KeyNotFoundException
                                       or InvalidOperationException or IndexOutOfRangeException or FormatException)
        {
            if (ct.IsCancellationRequested) throw;
            log.LogWarning(ex, "Falha ao buscar a cotação de {Ticker} na brapi", ticker);
            return null;
        }
    }
}
