using System.Text.Json;

namespace Notas.Api.Services.Dieta;

public sealed record ProdutoOff(string Nome, double Kcal, double Proteina, double Carbo, double Gordura, double Fibra, double Sodio, double? PorcaoG);

public interface IOpenFoodFacts
{
    /// <summary>Produto pelo código de barras, com valores por 100 g. Null = não encontrado.</summary>
    Task<ProdutoOff?> Buscar(string codigo, CancellationToken ct);
}

/// <summary>Consulta pública da Open Food Facts (sem chave). O app lê o código no aparelho e pergunta aqui.</summary>
public sealed class OpenFoodFacts(HttpClient http, ILogger<OpenFoodFacts> log) : IOpenFoodFacts
{
    public async Task<ProdutoOff?> Buscar(string codigo, CancellationToken ct)
    {
        try
        {
            using var resp = await http.GetAsync(
                $"https://world.openfoodfacts.org/api/v2/product/{Uri.EscapeDataString(codigo)}.json?fields=product_name,product_name_pt,nutriments,serving_quantity", ct);
            if (!resp.IsSuccessStatusCode) return null;
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStreamAsync(ct));
            if (!doc.RootElement.TryGetProperty("product", out var p)) return null;
            var nome = Texto(p, "product_name_pt") ?? Texto(p, "product_name");
            if (string.IsNullOrWhiteSpace(nome)) return null;
            var n = p.TryGetProperty("nutriments", out var x) ? x : default;
            // Sódio vem em gramas; a TACO usa miligramas.
            return new ProdutoOff(nome.Trim(), Num(n, "energy-kcal_100g"), Num(n, "proteins_100g"), Num(n, "carbohydrates_100g"),
                Num(n, "fat_100g"), Num(n, "fiber_100g"), Num(n, "sodium_100g") * 1000,
                p.TryGetProperty("serving_quantity", out var s) && s.ValueKind == JsonValueKind.Number ? s.GetDouble() : null);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException)
        {
            log.LogWarning(e, "Open Food Facts falhou para {Codigo}", codigo);
            return null;
        }
    }

    private static string? Texto(JsonElement e, string nome) =>
        e.TryGetProperty(nome, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static double Num(JsonElement e, string nome)
    {
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(nome, out var v)) return 0;
        return v.ValueKind switch
        {
            JsonValueKind.Number => Math.Round(v.GetDouble(), 2),
            JsonValueKind.String when double.TryParse(v.GetString(), System.Globalization.CultureInfo.InvariantCulture, out var d) => d,
            _ => 0,
        };
    }
}
