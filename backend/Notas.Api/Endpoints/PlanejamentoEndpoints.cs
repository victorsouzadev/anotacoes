using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Services.Financas;
using Notas.Api.Services.Financas.Auvp;

namespace Notas.Api.Endpoints;

public record PreferenciasResponse(string Metodo, int MesesReserva, Guid? MetaReservaId,
    decimal PercentualPagueSePrimeiro, decimal PatrimonioInvestido, decimal? SaldoInicialFluxo);

public record SalvarPreferenciasRequest(string? Metodo, int? MesesReserva, Guid? MetaReservaId, bool? LimparMetaReserva,
    decimal? PercentualPagueSePrimeiro, decimal? PatrimonioInvestido, decimal? SaldoInicialFluxo);

public record SalvarDividaRequest(string Nome, decimal Saldo, decimal JurosMensal, decimal ParcelaMinima);

public record SalvarProvisaoRequest(string Nome, decimal Valor, int MesVencimento, decimal? ValorReservado);

public record SalvarFechamentoRequest(decimal? MetaPoupanca, string? Reflexao, string? Compromisso);

// Planejamento financeiro: as metodologias (ver PlanejamentoService) e os
// cadastros que elas usam — dívidas, provisões anuais e o fechamento do mês.
public static class PlanejamentoEndpoints
{
    public static void MapPlanejamentoEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/financas/planejamento").RequireAuthorization();

        // ------------------------------------------------------------ preferências

        g.MapGet("/preferencias", async (ClaimsPrincipal user, PlanejamentoService s, CancellationToken ct) =>
            Results.Ok(Montar(await s.PreferenciasAsync(user.UserId(), ct))));

        g.MapPut("/preferencias", async (SalvarPreferenciasRequest req, ClaimsPrincipal user, AppDbContext db,
            CancellationToken ct) =>
        {
            var userId = user.UserId();
            if (req.Metodo is not null && !PlanejamentoService.MetodoValido(req.Metodo))
                return Results.BadRequest(new { erro = "Método inválido." });
            if (req.MesesReserva is < 1 or > 36)
                return Results.BadRequest(new { erro = "A reserva deve cobrir de 1 a 36 meses." });
            if (req.PercentualPagueSePrimeiro is < 0 or > 90)
                return Results.BadRequest(new { erro = "O percentual deve ficar entre 0 e 90." });
            if (req.PatrimonioInvestido is < 0)
                return Results.BadRequest(new { erro = "O patrimônio não pode ser negativo." });
            if (req.MetaReservaId is { } metaId && !await db.MetasReserva.AnyAsync(m => m.Id == metaId && m.UserId == userId, ct))
                return Results.BadRequest(new { erro = "Meta não encontrada." });

            var p = await db.PreferenciasFinancas.FirstOrDefaultAsync(x => x.UserId == userId, ct);
            if (p is null)
            {
                p = new PreferenciasFinancas { UserId = userId };
                db.PreferenciasFinancas.Add(p);
            }

            if (req.Metodo is not null) p.Metodo = req.Metodo;
            if (req.MesesReserva is { } meses) p.MesesReserva = meses;
            if (req.MetaReservaId is not null) p.MetaReservaId = req.MetaReservaId;
            else if (req.LimparMetaReserva == true) p.MetaReservaId = null;
            if (req.PercentualPagueSePrimeiro is { } pct) p.PercentualPagueSePrimeiro = pct;
            if (req.PatrimonioInvestido is { } pat) p.PatrimonioInvestido = pat;
            if (req.SaldoInicialFluxo is not null) p.SaldoInicialFluxo = req.SaldoInicialFluxo;
            p.AtualizadoEm = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.Ok(Montar(p));
        });

        // ------------------------------------------------------------ análises

        g.MapGet("/saude", async (int ano, int mes, ClaimsPrincipal user, PlanejamentoService s, CancellationToken ct) =>
            mes is < 1 or > 12
                ? Results.BadRequest(new { erro = "Mês inválido." })
                : Results.Ok(await s.SaudeAsync(user.UserId(), ano, mes, ct)));

        g.MapGet("/metodo", async (int ano, int mes, string? metodo, ClaimsPrincipal user, PlanejamentoService s,
            CancellationToken ct) =>
            mes is < 1 or > 12
                ? Results.BadRequest(new { erro = "Mês inválido." })
                : Results.Ok(await s.MetodoAsync(user.UserId(), ano, mes, metodo, ct)));

        g.MapGet("/envelopes", async (int ano, int mes, ClaimsPrincipal user, PlanejamentoService s,
            CancellationToken ct) =>
            mes is < 1 or > 12
                ? Results.BadRequest(new { erro = "Mês inválido." })
                : Results.Ok(await s.EnvelopesAsync(user.UserId(), ano, mes, ct)));

        // Fluxo de caixa dos próximos dias. Saldo de partida: o das contas correntes
        // na AUVP (ao vivo), senão o informado nas preferências, senão zero.
        g.MapGet("/fluxo", async (int? dias, ClaimsPrincipal user, PlanejamentoService s, AuvpEscrita auvp,
            IAuvpCliente cliente, ILoggerFactory logs, CancellationToken ct) =>
        {
            var userId = user.UserId();
            var horizonte = Math.Clamp(dias ?? 60, 7, 120);
            var p = await s.PreferenciasAsync(userId, ct);
            var saldo = p.SaldoInicialFluxo ?? 0m;
            var origem = p.SaldoInicialFluxo is null ? "nenhum" : "informado";
            var cartoes = new List<(string, int, decimal)>();

            if (await auvp.ChaveAsync(userId, ct) is { } chave)
            {
                try
                {
                    var contas = await cliente.ListarContasAsync(chave, ct);
                    saldo = contas.Where(c => !string.Equals(c.Subtype, "CREDIT_CARD", StringComparison.OrdinalIgnoreCase))
                        .Sum(c => c.Balance);
                    origem = "auvp";
                    foreach (var c in contas.Where(c => string.Equals(c.Subtype, "CREDIT_CARD", StringComparison.OrdinalIgnoreCase)
                                                        && c.Name is not null && c.CreditAccountData?.BalanceDueDate is not null))
                    {
                        var fatura = c.ExternalId is { Length: > 0 } ext ? await cliente.FaturaEstimadaAsync(chave, ext, ct) : null;
                        var dia = c.CreditAccountData!.BalanceDueDate!.Value.ToOffset(TimeSpan.FromHours(-3)).Day;
                        cartoes.Add((c.Name!, dia, fatura?.ProjectedTotal ?? 0));
                    }
                }
                catch (AuvpIndisponivelException ex)
                {
                    // Sem a AUVP o fluxo ainda sai, só com o saldo informado.
                    logs.CreateLogger("Planejamento.Fluxo").LogWarning("AUVP indisponível no fluxo: {Motivo}", ex.Message);
                }
            }

            return Results.Ok(await s.FluxoAsync(userId, horizonte, saldo, origem, cartoes, ct));
        });

        // ------------------------------------------------------------ dívidas

        g.MapGet("/dividas", async (ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
            Results.Ok(await ListarDividas(db, user.UserId(), ct)));

        g.MapPost("/dividas", async (SalvarDividaRequest req, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            if (ValidarDivida(req) is { } erro) return Results.BadRequest(new { erro });
            var d = new Divida { UserId = user.UserId() };
            Aplicar(d, req);
            db.Dividas.Add(d);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/financas/planejamento/dividas/{d.Id}", MontarDivida(d));
        });

        g.MapPut("/dividas/{id:guid}", async (Guid id, SalvarDividaRequest req, ClaimsPrincipal user, AppDbContext db,
            CancellationToken ct) =>
        {
            if (ValidarDivida(req) is { } erro) return Results.BadRequest(new { erro });
            var d = await db.Dividas.FirstOrDefaultAsync(x => x.Id == id && x.UserId == user.UserId(), ct);
            if (d is null) return Results.NotFound();
            Aplicar(d, req);
            await db.SaveChangesAsync(ct);
            return Results.Ok(MontarDivida(d));
        });

        g.MapDelete("/dividas/{id:guid}", async (Guid id, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var d = await db.Dividas.FirstOrDefaultAsync(x => x.Id == id && x.UserId == user.UserId(), ct);
            if (d is null) return Results.NotFound();
            db.Dividas.Remove(d);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        g.MapGet("/dividas/simulacao", async (decimal? extra, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var dividas = await db.Dividas.AsNoTracking().Where(x => x.UserId == user.UserId()).ToListAsync(ct);
            if (dividas.Count == 0) return Results.Ok((SimulacaoDividas?)null);
            return Results.Ok(PlanejamentoService.SimularDividas(dividas, Math.Clamp(extra ?? 0, 0, 10_000_000)));
        });

        // ------------------------------------------------------------ provisões

        g.MapGet("/provisoes", async (ClaimsPrincipal user, PlanejamentoService s, CancellationToken ct) =>
            Results.Ok(await s.ProvisoesAsync(user.UserId(), ct)));

        g.MapPost("/provisoes", async (SalvarProvisaoRequest req, ClaimsPrincipal user, AppDbContext db,
            FinancasClock clock, CancellationToken ct) =>
        {
            if (ValidarProvisao(req) is { } erro) return Results.BadRequest(new { erro });
            var x = new ProvisaoAnual { UserId = user.UserId() };
            Aplicar(x, req);
            db.ProvisoesAnuais.Add(x);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/financas/planejamento/provisoes/{x.Id}",
                PlanejamentoService.MontarProvisao(x, clock.Hoje()));
        });

        g.MapPut("/provisoes/{id:guid}", async (Guid id, SalvarProvisaoRequest req, ClaimsPrincipal user,
            AppDbContext db, FinancasClock clock, CancellationToken ct) =>
        {
            if (ValidarProvisao(req) is { } erro) return Results.BadRequest(new { erro });
            var x = await db.ProvisoesAnuais.FirstOrDefaultAsync(p => p.Id == id && p.UserId == user.UserId(), ct);
            if (x is null) return Results.NotFound();
            Aplicar(x, req);
            await db.SaveChangesAsync(ct);
            return Results.Ok(PlanejamentoService.MontarProvisao(x, clock.Hoje()));
        });

        g.MapDelete("/provisoes/{id:guid}", async (Guid id, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var x = await db.ProvisoesAnuais.FirstOrDefaultAsync(p => p.Id == id && p.UserId == user.UserId(), ct);
            if (x is null) return Results.NotFound();
            db.ProvisoesAnuais.Remove(x);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // ------------------------------------------------------------ fechamento

        g.MapGet("/fechamento/{ano:int}/{mes:int}", async (int ano, int mes, ClaimsPrincipal user,
            PlanejamentoService s, CancellationToken ct) =>
            mes is < 1 or > 12
                ? Results.BadRequest(new { erro = "Mês inválido." })
                : Results.Ok(await s.FechamentoAsync(user.UserId(), ano, mes, ct)));

        g.MapPut("/fechamento/{ano:int}/{mes:int}", async (int ano, int mes, SalvarFechamentoRequest req,
            ClaimsPrincipal user, AppDbContext db, PlanejamentoService s, CancellationToken ct) =>
        {
            if (mes is < 1 or > 12) return Results.BadRequest(new { erro = "Mês inválido." });
            if (req.MetaPoupanca is < 0) return Results.BadRequest(new { erro = "A meta não pode ser negativa." });
            var userId = user.UserId();
            var f = await db.FechamentosMes.FirstOrDefaultAsync(x => x.UserId == userId && x.Ano == ano && x.Mes == mes, ct);
            if (f is null)
            {
                f = new FechamentoMes { UserId = userId, Ano = ano, Mes = mes };
                db.FechamentosMes.Add(f);
            }
            f.MetaPoupanca = req.MetaPoupanca;
            f.Reflexao = Texto(req.Reflexao);
            f.Compromisso = Texto(req.Compromisso);
            f.AtualizadoEm = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.Ok(await s.FechamentoAsync(userId, ano, mes, ct));
        });
    }

    private static string? Texto(string? s) =>
        string.IsNullOrWhiteSpace(s) ? null : s.Trim()[..Math.Min(s.Trim().Length, 2000)];

    private static PreferenciasResponse Montar(PreferenciasFinancas p) => new(p.Metodo, p.MesesReserva,
        p.MetaReservaId, p.PercentualPagueSePrimeiro, p.PatrimonioInvestido, p.SaldoInicialFluxo);

    private static async Task<List<DividaResponse>> ListarDividas(AppDbContext db, string userId, CancellationToken ct) =>
        (await db.Dividas.AsNoTracking().Where(x => x.UserId == userId).ToListAsync(ct))
        .OrderByDescending(d => d.JurosMensal).Select(MontarDivida).ToList();

    private static DividaResponse MontarDivida(Divida d) => new(d.Id, d.Nome, d.Saldo, d.JurosMensal, d.ParcelaMinima);

    private static string? ValidarDivida(SalvarDividaRequest r) =>
        string.IsNullOrWhiteSpace(r.Nome) ? "Dê um nome para a dívida."
        : r.Nome.Trim().Length > 120 ? "Nome longo demais."
        : r.Saldo <= 0 ? "O saldo deve ser maior que zero."
        : r.JurosMensal is < 0 or > 100 ? "Juros mensais entre 0 e 100%."
        : r.ParcelaMinima < 0 ? "A parcela mínima não pode ser negativa."
        : null;

    private static void Aplicar(Divida d, SalvarDividaRequest r)
    {
        d.Nome = r.Nome.Trim();
        d.Saldo = Math.Round(r.Saldo, 2);
        d.JurosMensal = Math.Round(r.JurosMensal, 3);
        d.ParcelaMinima = Math.Round(r.ParcelaMinima, 2);
    }

    private static string? ValidarProvisao(SalvarProvisaoRequest r) =>
        string.IsNullOrWhiteSpace(r.Nome) ? "Dê um nome para a provisão."
        : r.Nome.Trim().Length > 120 ? "Nome longo demais."
        : r.Valor <= 0 ? "O valor deve ser maior que zero."
        : r.MesVencimento is < 1 or > 12 ? "Mês de vencimento inválido."
        : r.ValorReservado is < 0 ? "O valor reservado não pode ser negativo."
        : null;

    private static void Aplicar(ProvisaoAnual x, SalvarProvisaoRequest r)
    {
        x.Nome = r.Nome.Trim();
        x.Valor = Math.Round(r.Valor, 2);
        x.MesVencimento = r.MesVencimento;
        if (r.ValorReservado is { } v) x.ValorReservado = Math.Round(v, 2);
    }
}
