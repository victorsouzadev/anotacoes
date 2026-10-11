using Notas.Api.Data;

namespace Notas.Api.Services.Financas;

/// <summary>Um lançamento que se repete: mesma loja, valor estável, vários meses.</summary>
public record Recorrencia(string Chave, Transacao Ultimo, decimal ValorMedio, int Meses, int DiaHabitual);

public static class Recorrencias
{
    /// <summary>
    /// Lançamentos que aparecem em pelo menos 3 meses diferentes com valor parecido —
    /// assinaturas, contas, mensalidades, salário. Parcelas ficam de fora (repetem,
    /// mas acabam) e pagamento de fatura também: é o acerto das compras do cartão,
    /// que já aparecem uma a uma.
    /// </summary>
    public static List<Recorrencia> Detectar(IEnumerable<Transacao> transacoes) =>
        transacoes
            .Where(t => !t.ForaDosTotais && t.Parcela == null
                        && !t.Descricao.Contains("fatura", StringComparison.OrdinalIgnoreCase))
            .GroupBy(t => (Chave: RegrasCategoria.ChaveDeDescricao(t.Descricao), t.Tipo))
            .Where(g => g.Key.Chave.Length >= 3)
            .Select(g =>
            {
                var itens = g.OrderBy(t => t.Data).ToList();
                // Um valor por mês (somado, se houver mais de um no mesmo mês).
                var porMes = itens.GroupBy(t => t.Competencia).Select(m => m.Sum(t => t.Valor)).ToList();
                return (g.Key.Chave, Itens: itens, PorMes: porMes);
            })
            .Where(g => g.PorMes.Count >= 3)
            // Valor estável: o maior mês não passa de 1,5× o menor.
            .Where(g => g.PorMes.Min() > 0 && g.PorMes.Max() <= g.PorMes.Min() * 1.5m)
            .Select(g => new Recorrencia(g.Chave, g.Itens[^1], Math.Round(g.PorMes.Average(), 2), g.PorMes.Count,
                // Dia do mês mais comum — é quando o próximo deve cair.
                g.Itens.GroupBy(t => t.Data.Day).OrderByDescending(d => d.Count()).ThenBy(d => d.Key).First().Key))
            .OrderByDescending(r => r.ValorMedio)
            .ToList();
}
