using Notas.Api.Data;
using Notas.Api.Dtos;

namespace Notas.Api.Services.Acoes;

/// <summary>Monta a carteira a partir das operações, em ordem de data, pelo preço médio.</summary>
public static class Carteira
{
    public record Posicao(string Ticker, decimal Quantidade, decimal Custo, decimal ResultadoRealizado)
    {
        public decimal PrecoMedio => Quantidade == 0 ? 0 : Custo / Quantidade;
    }

    /// <summary>
    /// Compra soma quantidade e custo (com taxas); venda tira a quantidade pelo preço médio e
    /// registra o lucro/prejuízo. Ativos zerados continuam na lista se tiveram resultado realizado.
    /// </summary>
    public static List<Posicao> Calcular(IEnumerable<AcaoOperacao> operacoes)
    {
        var posicoes = new Dictionary<string, Posicao>();
        foreach (var op in operacoes.OrderBy(o => o.Data).ThenBy(o => o.CriadoEm))
        {
            var p = posicoes.GetValueOrDefault(op.Ticker) ?? new Posicao(op.Ticker, 0, 0, 0);
            if (op.Tipo == "compra")
            {
                p = p with { Quantidade = p.Quantidade + op.Quantidade, Custo = p.Custo + op.Quantidade * op.PrecoUnitario + op.Taxas };
            }
            else
            {
                var vendida = Math.Min(op.Quantidade, p.Quantidade);
                var custoSaida = p.PrecoMedio * vendida;
                var receita = vendida * op.PrecoUnitario - op.Taxas;
                p = p with
                {
                    Quantidade = p.Quantidade - vendida,
                    Custo = p.Quantidade - vendida == 0 ? 0 : p.Custo - custoSaida,
                    ResultadoRealizado = p.ResultadoRealizado + receita - custoSaida,
                };
            }
            posicoes[op.Ticker] = p;
        }
        return posicoes.Values.Where(p => p.Quantidade > 0 || p.ResultadoRealizado != 0).OrderBy(p => p.Ticker).ToList();
    }

    public static CarteiraResponse Montar(List<Posicao> posicoes, Dictionary<string, Cotacao> cotacoes)
    {
        var lista = posicoes.Select(p =>
        {
            var c = cotacoes.GetValueOrDefault(p.Ticker);
            decimal? valor = c is null ? null : Math.Round(c.Preco * p.Quantidade, 2);
            decimal? resultado = valor - p.Custo;
            return new PosicaoResponse(
                p.Ticker, c?.Nome, p.Quantidade, Math.Round(p.PrecoMedio, 4), Math.Round(p.Custo, 2),
                c?.Preco, c?.VariacaoDia, valor, resultado is null ? null : Math.Round(resultado.Value, 2),
                resultado is null || p.Custo == 0 ? null : Math.Round(resultado.Value / p.Custo * 100, 2),
                Math.Round(p.ResultadoRealizado, 2), c?.Em);
        }).ToList();

        var abertas = lista.Where(p => p.Quantidade > 0).ToList();
        var completas = abertas.All(p => p.Cotacao is not null);
        var custo = abertas.Sum(p => p.Custo);
        decimal? valorTotal = completas ? abertas.Sum(p => p.ValorAtual!.Value) : null;
        decimal? resultadoTotal = valorTotal - custo;
        return new CarteiraResponse(
            lista, custo, valorTotal, resultadoTotal,
            resultadoTotal is null || custo == 0 ? null : Math.Round(resultadoTotal.Value / custo * 100, 2),
            lista.Sum(p => p.ResultadoRealizado), completas);
    }
}
