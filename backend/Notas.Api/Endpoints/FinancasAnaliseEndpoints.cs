using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Services.Financas;

namespace Notas.Api.Endpoints;

public record RecorrenteResponse(string Descricao, string Categoria, string CategoriaRotulo, decimal ValorMedio,
    decimal UltimoValor, DateOnly UltimaData, int Meses, string? Conta);

public record CompromissoMesResponse(int Ano, int Mes, decimal Total, int Quantidade);

public record ParceladoResponse(string Descricao, decimal ValorParcela, int ParcelaAtual, int TotalParcelas,
    decimal Restante, DateOnly UltimaCompetencia, string? Conta);

public record CompromissosResponse(List<CompromissoMesResponse> Meses, List<ParceladoResponse> Parcelados);

public record TagResumo(string Tag, decimal Total, decimal Percentual, int Quantidade);

// Análises sobre os lançamentos: o que se repete, o que já está comprometido nos
// próximos meses e para onde vai o dinheiro por tag.
public static class FinancasAnaliseEndpoints
{
    public static void MapFinancasAnaliseEndpoints(this IEndpointRouteBuilder app)
    {
        var grupo = app.MapGroup("/api/financas/dashboard").RequireAuthorization();

        // Gastos que aparecem em pelo menos 3 dos últimos 6 meses com valor parecido —
        // assinaturas, contas, mensalidades. Parcelas ficam de fora: repetem, mas acabam.
        grupo.MapGet("/recorrentes", async (ClaimsPrincipal user, AppDbContext db, FinancasClock clock,
            CancellationToken ct) =>
        {
            var userId = user.UserId();
            var mesAtual = Transacao.CompetenciaDe(clock.Hoje());
            var inicio = mesAtual.AddMonths(-5);

            var despesas = await db.Transacoes.AsNoTracking()
                .Where(t => t.UserId == userId && t.Tipo == TipoTransacao.Despesa && !t.ForaDosTotais
                            && t.Parcela == null && t.Competencia >= inicio && t.Competencia <= mesAtual)
                .ToListAsync(ct);

            var resultado = despesas
                // Pagar a fatura se repete todo mês, mas não é um gasto recorrente:
                // é o acerto das compras do cartão, que já aparecem uma a uma.
                .Where(t => !t.Descricao.Contains("fatura", StringComparison.OrdinalIgnoreCase))
                .GroupBy(t => RegrasCategoria.ChaveDeDescricao(t.Descricao))
                .Where(g => g.Key.Length >= 3)
                .Select(g => new { Itens = g.OrderBy(t => t.Data).ToList(), Meses = g.Select(t => t.Competencia).Distinct().Count() })
                .Where(g => g.Meses >= 3)
                .Select(g =>
                {
                    // Um valor por mês (o maior, se houver mais de um no mesmo mês).
                    var porMes = g.Itens.GroupBy(t => t.Competencia).Select(m => m.Sum(t => t.Valor)).ToList();
                    return new { g.Itens, g.Meses, PorMes = porMes };
                })
                // Valor estável: o maior mês não passa de 1,5× o menor.
                .Where(g => g.PorMes.Min() > 0 && g.PorMes.Max() <= g.PorMes.Min() * 1.5m)
                .Select(g =>
                {
                    var ultimo = g.Itens[^1];
                    return new RecorrenteResponse(ultimo.Descricao, ultimo.Categoria.ToString(),
                        CategoriaInfo.Rotulo(ultimo.Categoria),
                        Math.Round(g.PorMes.Average(), 2), ultimo.Valor, ultimo.Data, g.Meses, ultimo.Conta);
                })
                .OrderByDescending(r => r.ValorMedio)
                .ToList();

            return Results.Ok(resultado);
        });

        // O que já está contratado para os próximos meses: parcelas futuras que o
        // banco já informou, mês a mês, e as compras parceladas ainda em curso.
        grupo.MapGet("/compromissos", async (ClaimsPrincipal user, AppDbContext db, FinancasClock clock,
            CancellationToken ct) =>
        {
            var userId = user.UserId();
            var mesAtual = Transacao.CompetenciaDe(clock.Hoje());
            var limite = mesAtual.AddMonths(12);

            var futuras = await db.Transacoes.AsNoTracking()
                .Where(t => t.UserId == userId && t.Tipo == TipoTransacao.Despesa && !t.ForaDosTotais
                            && t.Competencia > mesAtual && t.Competencia <= limite)
                .ToListAsync(ct);

            var meses = Enumerable.Range(1, 12)
                .Select(i => mesAtual.AddMonths(i))
                .Select(m =>
                {
                    var doMes = futuras.Where(t => t.Competencia == m).ToList();
                    return new CompromissoMesResponse(m.Year, m.Month, doMes.Sum(t => t.Valor), doMes.Count);
                })
                .ToList();

            // Uma compra parcelada aparece como várias transações ("3/10", "4/10"…);
            // agrupa pela loja + total de parcelas + valor e pega a última parcela.
            var parceladas = await db.Transacoes.AsNoTracking()
                .Where(t => t.UserId == userId && t.Tipo == TipoTransacao.Despesa && !t.ForaDosTotais
                            && t.Parcela != null && t.TotalParcelas != null && t.Competencia >= mesAtual)
                .ToListAsync(ct);

            var parcelados = parceladas
                .GroupBy(t => (Chave: RegrasCategoria.ChaveDeDescricao(t.Descricao), t.TotalParcelas, t.Valor, t.Conta))
                .Select(g =>
                {
                    var atual = g.OrderBy(t => t.Competencia).First();
                    var ultima = g.Max(t => t.Competencia);
                    var restantes = g.Count(t => t.Competencia > mesAtual);
                    return new ParceladoResponse(atual.Descricao, atual.Valor, atual.Parcela!.Value,
                        atual.TotalParcelas!.Value, restantes * atual.Valor, ultima, atual.Conta);
                })
                .Where(p => p.Restante > 0)
                .OrderByDescending(p => p.Restante)
                .ToList();

            return Results.Ok(new CompromissosResponse(meses, parcelados));
        });

        // Despesas do mês por tag. Um lançamento com duas tags conta nas duas, então
        // os percentuais são sobre o total do mês e podem somar mais de 100%.
        grupo.MapGet("/tags", async (ClaimsPrincipal user, AppDbContext db, FinancasClock clock,
            CancellationToken ct, int? ano, int? mes) =>
        {
            if (mes is < 1 or > 12) return Results.BadRequest(new { erro = $"Mês inválido: {mes}." });
            var userId = user.UserId();
            var (anoRef, mesRef) = clock.ResolverMes(ano, mes);
            var competencia = new DateOnly(anoRef, mesRef, 1);

            var despesas = await db.Transacoes.AsNoTracking()
                .Where(t => t.UserId == userId && t.Tipo == TipoTransacao.Despesa && !t.ForaDosTotais
                            && t.Competencia == competencia)
                .ToListAsync(ct);
            var total = despesas.Sum(t => t.Valor);

            var resultado = despesas
                .SelectMany(t => t.ListaDeTags().DefaultIfEmpty("Sem tag").Select(tag => (tag, t)))
                .GroupBy(x => x.tag, StringComparer.CurrentCultureIgnoreCase)
                .Select(g => new TagResumo(g.Key, g.Sum(x => x.t.Valor),
                    total > 0 ? Math.Round(g.Sum(x => x.t.Valor) / total * 100, 2) : 0, g.Count()))
                .OrderBy(t => t.Tag == "Sem tag")
                .ThenByDescending(t => t.Total)
                .ToList();

            return Results.Ok(resultado);
        });
    }
}
