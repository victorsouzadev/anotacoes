using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Dtos;
using Notas.Api.Services.Financas;
using Notas.Api.Services.Financas.Llm;

namespace Notas.Api.Endpoints;

public static class FinancasEndpoints
{
    public static void MapFinancasEndpoints(this IEndpointRouteBuilder app)
    {
        var transacoes = app.MapGroup("/api/financas/transacoes").RequireAuthorization();

        // POST /api/financas/transacoes — recebe texto livre, aciona o LLM, retorna a transação estruturada.
        transacoes.MapPost("/", async (CriarTransacaoRequest req, ClaimsPrincipal user, AppDbContext db,
            TransacaoExtractionService extractionService) =>
        {
            if (string.IsNullOrWhiteSpace(req.Texto))
                return Results.BadRequest(new { erro = "O campo 'texto' é obrigatório." });

            Transacao transacao;
            try
            {
                transacao = await extractionService.ExtrairTransacaoAsync(req.Texto, user.UserId());
            }
            catch (ExtracaoInvalidaException ex)
            {
                return Results.UnprocessableEntity(new { erro = ex.Message });
            }

            db.Transacoes.Add(transacao);
            await db.SaveChangesAsync();
            return Results.Created($"/api/financas/transacoes/{transacao.Id}", TransacaoResponse.FromEntity(transacao));
        });

        // GET /api/financas/transacoes — lista transações com filtros de período, categoria e tipo.
        transacoes.MapGet("/", async (ClaimsPrincipal user, AppDbContext db,
            DateOnly? dataInicio, DateOnly? dataFim, Categoria? categoria, TipoTransacao? tipo) =>
        {
            var userId = user.UserId();
            var query = db.Transacoes.AsNoTracking().Where(t => t.UserId == userId);

            if (dataInicio.HasValue) query = query.Where(t => t.Data >= dataInicio.Value);
            if (dataFim.HasValue) query = query.Where(t => t.Data <= dataFim.Value);
            if (categoria.HasValue) query = query.Where(t => t.Categoria == categoria.Value);
            if (tipo.HasValue) query = query.Where(t => t.Tipo == tipo.Value);

            var resultado = await query
                .OrderByDescending(t => t.Data)
                .ThenByDescending(t => t.CriadoEm)
                .ToListAsync();

            return Results.Ok(resultado.Select(TransacaoResponse.FromEntity));
        });

        transacoes.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var transacao = await db.Transacoes.AsNoTracking()
                .FirstOrDefaultAsync(t => t.Id == id && t.UserId == user.UserId());
            return transacao is null ? Results.NotFound() : Results.Ok(TransacaoResponse.FromEntity(transacao));
        });

        // PATCH /api/financas/transacoes/{id} — usuário corrige campos extraídos incorretamente.
        transacoes.MapPatch("/{id:guid}", async (Guid id, AtualizarTransacaoRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var transacao = await db.Transacoes.FirstOrDefaultAsync(t => t.Id == id && t.UserId == user.UserId());
            if (transacao is null) return Results.NotFound();

            if (req.Descricao is not null) transacao.Descricao = req.Descricao;
            if (req.Valor is not null) transacao.Valor = req.Valor.Value;
            if (req.Tipo is not null) transacao.Tipo = req.Tipo.Value;
            if (req.Categoria is not null) transacao.Categoria = req.Categoria.Value;
            if (req.Data is not null) transacao.Data = req.Data.Value;
            if (req.FormaPagamento is not null) transacao.FormaPagamento = req.FormaPagamento.Value;
            if (req.Observacoes is not null) transacao.Observacoes = req.Observacoes;

            // Uma correção manual do usuário é, por definição, confirmada — a menos
            // que o cliente explicitamente informe outro status.
            transacao.Status = req.Status ?? StatusTransacao.Confirmado;

            await db.SaveChangesAsync();
            return Results.Ok(TransacaoResponse.FromEntity(transacao));
        });

        transacoes.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var transacao = await db.Transacoes.FirstOrDefaultAsync(t => t.Id == id && t.UserId == user.UserId());
            if (transacao is null) return Results.NotFound();

            db.Transacoes.Remove(transacao);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        var dashboard = app.MapGroup("/api/financas/dashboard").RequireAuthorization();

        // GET /api/financas/dashboard/resumo?ano=2026&mes=8 — totais do período (padrão: mês atual).
        dashboard.MapGet("/resumo", async (ClaimsPrincipal user, AppDbContext db, int? ano, int? mes) =>
        {
            var userId = user.UserId();
            var hoje = DateTime.UtcNow;
            var anoRef = ano ?? hoje.Year;
            var mesRef = mes ?? hoje.Month;

            var (inicio, fim) = LimitesDoMes(anoRef, mesRef);
            var (inicioAnterior, fimAnterior) = LimitesDoMes(mesRef == 1 ? anoRef - 1 : anoRef, mesRef == 1 ? 12 : mesRef - 1);

            var transacoesMes = await db.Transacoes.AsNoTracking()
                .Where(t => t.UserId == userId && t.Data >= inicio && t.Data <= fim)
                .ToListAsync();

            var transacoesMesAnterior = await db.Transacoes.AsNoTracking()
                .Where(t => t.UserId == userId && t.Data >= inicioAnterior && t.Data <= fimAnterior)
                .ToListAsync();

            var totalReceitas = transacoesMes.Where(t => t.Tipo == TipoTransacao.Receita).Sum(t => t.Valor);
            var totalDespesas = transacoesMes.Where(t => t.Tipo == TipoTransacao.Despesa).Sum(t => t.Valor);
            var saldo = totalReceitas - totalDespesas;

            var saldoAnterior = transacoesMesAnterior.Where(t => t.Tipo == TipoTransacao.Receita).Sum(t => t.Valor)
                - transacoesMesAnterior.Where(t => t.Tipo == TipoTransacao.Despesa).Sum(t => t.Valor);

            var maiorCategoria = transacoesMes
                .Where(t => t.Tipo == TipoTransacao.Despesa)
                .GroupBy(t => t.Categoria)
                .OrderByDescending(g => g.Sum(t => t.Valor))
                .Select(g => g.Key.ToString())
                .FirstOrDefault();

            decimal variacaoPercentual = 0;
            if (saldoAnterior != 0)
                variacaoPercentual = Math.Round((saldo - saldoAnterior) / Math.Abs(saldoAnterior) * 100, 2);
            else if (saldo != 0)
                variacaoPercentual = 100;

            return Results.Ok(new ResumoResponse(totalReceitas, totalDespesas, saldo, maiorCategoria, saldoAnterior, variacaoPercentual));
        });

        // GET /api/financas/dashboard/categorias?ano=&mes=&tipo=despesa — gastos agrupados por categoria (padrão: despesas do mês atual).
        dashboard.MapGet("/categorias", async (ClaimsPrincipal user, AppDbContext db, int? ano, int? mes, TipoTransacao? tipo) =>
        {
            var userId = user.UserId();
            var hoje = DateTime.UtcNow;
            var anoRef = ano ?? hoje.Year;
            var mesRef = mes ?? hoje.Month;
            var tipoRef = tipo ?? TipoTransacao.Despesa;

            var (inicio, fim) = LimitesDoMes(anoRef, mesRef);

            var transacoes = await db.Transacoes.AsNoTracking()
                .Where(t => t.UserId == userId && t.Data >= inicio && t.Data <= fim && t.Tipo == tipoRef)
                .ToListAsync();

            var total = transacoes.Sum(t => t.Valor);

            var resultado = transacoes
                .GroupBy(t => t.Categoria)
                .Select(g => new CategoriaResumo(g.Key.ToString(), g.Sum(t => t.Valor),
                    total > 0 ? Math.Round(g.Sum(t => t.Valor) / total * 100, 2) : 0))
                .OrderByDescending(c => c.Total)
                .ToList();

            return Results.Ok(resultado);
        });

        // GET /api/financas/dashboard/tendencias?agrupamento=mensal|semanal&periodos=6 — evolução de receitas x despesas ao longo do tempo.
        dashboard.MapGet("/tendencias", async (ClaimsPrincipal user, AppDbContext db, string? agrupamento, int? periodos) =>
        {
            var userId = user.UserId();
            var periodosRef = Math.Clamp(periodos ?? 6, 1, 52);
            var semanal = string.Equals(agrupamento ?? "mensal", "semanal", StringComparison.OrdinalIgnoreCase);

            var hoje = DateOnly.FromDateTime(DateTime.UtcNow);
            var dataLimite = semanal ? hoje.AddDays(-7 * periodosRef) : hoje.AddMonths(-periodosRef);

            var transacoes = await db.Transacoes.AsNoTracking()
                .Where(t => t.UserId == userId && t.Data >= dataLimite)
                .ToListAsync();

            var agrupado = transacoes
                .GroupBy(t => semanal ? ChavePeriodoSemanal(t.Data) : ChavePeriodoMensal(t.Data))
                .Select(g => new TendenciaPeriodo(
                    g.Key,
                    g.Where(t => t.Tipo == TipoTransacao.Receita).Sum(t => t.Valor),
                    g.Where(t => t.Tipo == TipoTransacao.Despesa).Sum(t => t.Valor),
                    g.Where(t => t.Tipo == TipoTransacao.Receita).Sum(t => t.Valor)
                        - g.Where(t => t.Tipo == TipoTransacao.Despesa).Sum(t => t.Valor)))
                .OrderBy(p => p.Periodo)
                .ToList();

            return Results.Ok(agrupado);
        });
    }

    private static (DateOnly inicio, DateOnly fim) LimitesDoMes(int ano, int mes)
    {
        var inicio = new DateOnly(ano, mes, 1);
        var fim = inicio.AddMonths(1).AddDays(-1);
        return (inicio, fim);
    }

    private static string ChavePeriodoMensal(DateOnly data) => data.ToString("yyyy-MM");

    private static string ChavePeriodoSemanal(DateOnly data)
    {
        var calendario = System.Globalization.CultureInfo.InvariantCulture.Calendar;
        var semana = calendario.GetWeekOfYear(
            data.ToDateTime(TimeOnly.MinValue),
            System.Globalization.CalendarWeekRule.FirstFourDayWeek,
            DayOfWeek.Monday);
        return $"{data.Year}-W{semana:D2}";
    }
}
