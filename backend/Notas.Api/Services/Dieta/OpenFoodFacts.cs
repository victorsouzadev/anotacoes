using System.Text.Json;

namespace Notas.Api.Services.Dieta;

public sealed record ProdutoOff(string Nome, double Kcal, double Proteina, double Carbo, double Gordura, double Fibra, double Sodio, double? PorcaoG,
    string? Codigo = null, string? Marca = null, double? PesoG = null);

public interface IOpenFoodFacts
{
    /// <summary>Produto pelo código de barras, com valores por 100 g. Null = não encontrado.</summary>
    Task<ProdutoOff?> Buscar(string codigo, CancellationToken ct);

    /// <summary>Produtos vendidos no Brasil cujo nome/marca combina com o texto; só os que têm calorias.</summary>
    Task<List<ProdutoOff>> Pesquisar(string texto, int limite, CancellationToken ct);
}

/// <summary>Consulta pública da Open Food Facts (sem chave). O app lê o código no aparelho e pergunta aqui.</summary>
public sealed class OpenFoodFacts(HttpClient http, ILogger<OpenFoodFacts> log) : IOpenFoodFacts
{
    public async Task<ProdutoOff?> Buscar(string codigo, CancellationToken ct)
    {
        try
        {
            using var resp = await http.GetAsync(
                $"https://world.openfoodfacts.org/api/v2/product/{Uri.EscapeDataString(codigo)}.json?fields=product_name,product_name_pt,brands,nutriments,serving_quantity,product_quantity", ct);
            if (!resp.IsSuccessStatusCode) return null;
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStreamAsync(ct));
            if (!doc.RootElement.TryGetProperty("product", out var p)) return null;
            var nome = Texto(p, "product_name_pt") ?? Texto(p, "product_name");
            if (string.IsNullOrWhiteSpace(nome)) return null;
            var n = p.TryGetProperty("nutriments", out var x) ? x : default;
            // Sódio vem em gramas; a TACO usa miligramas.
            return new ProdutoOff(nome.Trim(), Num(n, "energy-kcal_100g"), Num(n, "proteins_100g"), Num(n, "carbohydrates_100g"),
                Num(n, "fat_100g"), Num(n, "fiber_100g"), Num(n, "sodium_100g") * 1000,
                NumOuNulo(p, "serving_quantity"), codigo, Texto(p, "brands"), NumOuNulo(p, "product_quantity"));
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException)
        {
            log.LogWarning(e, "Open Food Facts falhou para {Codigo}", codigo);
            return null;
        }
    }

    // A busca clássica (cgi/search.pl) vive fora do ar (503); a nova (search-a-licious) responde rápido.
    public async Task<List<ProdutoOff>> Pesquisar(string texto, int limite, CancellationToken ct)
    {
        try
        {
            var q = Uri.EscapeDataString($"{texto} countries_tags:\"en:brazil\"");
            using var resp = await http.GetAsync(
                $"https://search.openfoodfacts.org/search?q={q}&page_size={Math.Clamp(limite * 2, 5, 50)}" +
                "&fields=code,product_name,product_name_pt,brands,nutriments,serving_quantity,product_quantity", ct);
            if (!resp.IsSuccessStatusCode) return [];
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStreamAsync(ct));
            var lista = new List<ProdutoOff>();
            if (!doc.RootElement.TryGetProperty("hits", out var h) || h.ValueKind != JsonValueKind.Array) return lista;
            foreach (var p in h.EnumerateArray())
            {
                var nome = Texto(p, "product_name_pt") ?? Texto(p, "product_name");
                var n = p.TryGetProperty("nutriments", out var x) ? x : default;
                if (string.IsNullOrWhiteSpace(nome) || Num(n, "energy-kcal_100g") <= 0) continue;
                // brands vem como lista nesta API (e como texto na de produto).
                var marca = p.TryGetProperty("brands", out var b)
                    ? b.ValueKind == JsonValueKind.Array ? string.Join(", ", b.EnumerateArray().Select(m => m.GetString())) : b.GetString()
                    : null;
                lista.Add(new ProdutoOff(nome.Trim(), Num(n, "energy-kcal_100g"), Num(n, "proteins_100g"), Num(n, "carbohydrates_100g"),
                    Num(n, "fat_100g"), Num(n, "fiber_100g"), Num(n, "sodium_100g") * 1000, NumOuNulo(p, "serving_quantity"),
                    Texto(p, "code"), string.IsNullOrWhiteSpace(marca) ? null : marca, NumOuNulo(p, "product_quantity")));
                if (lista.Count >= limite) break;
            }
            return lista;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException)
        {
            log.LogWarning(e, "Open Food Facts: busca falhou para {Texto}", texto);
            return [];
        }
    }

    private static double? NumOuNulo(JsonElement e, string nome) =>
        e.TryGetProperty(nome, out var v) && v.ValueKind == JsonValueKind.Number && v.GetDouble() > 0 ? v.GetDouble()
        : e.TryGetProperty(nome, out v) && v.ValueKind == JsonValueKind.String && double.TryParse(v.GetString(), System.Globalization.CultureInfo.InvariantCulture, out var d) && d > 0 ? d
        : null;

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
