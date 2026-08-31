using Notas.Api.Data;

namespace Notas.Api.Services.Financas;

// Agrupamento das categorias no estilo "necessidades / estilo de vida / futuro",
// usado pelos modelos de distribuição de orçamento (ex.: regra 50/30/20).
public enum GrupoCategoria
{
    Essenciais,
    EstiloDeVida,
    Futuro,
    Receita
}

// Ponto único de verdade sobre a taxonomia de categorias: rótulo legível,
// grupo e parsing tolerante do texto vindo do LLM.
public static class CategoriaInfo
{
    private static readonly IReadOnlyDictionary<Categoria, (string Rotulo, GrupoCategoria Grupo)> Meta =
        new Dictionary<Categoria, (string, GrupoCategoria)>
        {
            [Categoria.Moradia] = ("Moradia", GrupoCategoria.Essenciais),
            [Categoria.ContasServicos] = ("Contas e serviços", GrupoCategoria.Essenciais),
            [Categoria.Alimentacao] = ("Alimentação", GrupoCategoria.Essenciais),
            [Categoria.Transporte] = ("Transporte", GrupoCategoria.Essenciais),
            [Categoria.Saude] = ("Saúde", GrupoCategoria.Essenciais),
            [Categoria.Educacao] = ("Educação", GrupoCategoria.Essenciais),
            [Categoria.Lazer] = ("Lazer", GrupoCategoria.EstiloDeVida),
            [Categoria.Compras] = ("Compras", GrupoCategoria.EstiloDeVida),
            [Categoria.Outros] = ("Outros", GrupoCategoria.EstiloDeVida),
            [Categoria.Investimentos] = ("Investimentos", GrupoCategoria.Futuro),
            [Categoria.Salario] = ("Salário", GrupoCategoria.Receita),
        };

    public static string Rotulo(Categoria categoria) =>
        Meta.TryGetValue(categoria, out var m) ? m.Rotulo : categoria.ToString();

    public static GrupoCategoria Grupo(Categoria categoria) =>
        Meta.TryGetValue(categoria, out var m) ? m.Grupo : GrupoCategoria.EstiloDeVida;

    // Categorias que fazem sentido num orçamento de saída de dinheiro. Salário é
    // entrada, então fica de fora da distribuição.
    public static IReadOnlyList<Categoria> Orcaveis { get; } =
        Meta.Where(kv => kv.Value.Grupo != GrupoCategoria.Receita).Select(kv => kv.Key).ToList();

    public static bool EhOrcavel(Categoria categoria) => Grupo(categoria) != GrupoCategoria.Receita;

    public static bool TryParse(string? valor, out Categoria categoria)
    {
        categoria = Categoria.Outros;
        if (string.IsNullOrWhiteSpace(valor)) return false;

        var normalizado = Normalizar(valor);
        switch (normalizado)
        {
            case "alimentacao" or "comida" or "mercado": categoria = Categoria.Alimentacao; return true;
            case "transporte" or "locomocao": categoria = Categoria.Transporte; return true;
            case "moradia" or "casa" or "aluguel": categoria = Categoria.Moradia; return true;
            case "saude": categoria = Categoria.Saude; return true;
            case "educacao" or "estudos": categoria = Categoria.Educacao; return true;
            case "lazer" or "entretenimento": categoria = Categoria.Lazer; return true;
            case "compras": categoria = Categoria.Compras; return true;
            case "contas_servicos" or "contas" or "servicos" or "contas_e_servicos": categoria = Categoria.ContasServicos; return true;
            case "salario" or "renda": categoria = Categoria.Salario; return true;
            case "investimentos" or "investimento": categoria = Categoria.Investimentos; return true;
            case "outros" or "outro": categoria = Categoria.Outros; return true;
            default: return false;
        }
    }

    // Remove acentos e uniformiza separadores, para que "Contas e Serviços",
    // "contas-servicos" e "CONTAS_SERVICOS" caiam todos no mesmo caso.
    private static string Normalizar(string valor)
    {
        var semAcento = string.Concat(valor.Trim().ToLowerInvariant().Normalize(System.Text.NormalizationForm.FormD)
            .Where(c => System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c)
                        != System.Globalization.UnicodeCategory.NonSpacingMark));

        var partes = semAcento.Split(new[] { ' ', '-', '/', '_' }, StringSplitOptions.RemoveEmptyEntries)
            .Where(p => p != "e");
        return string.Join('_', partes);
    }
}
