using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Dtos;
using Notas.Api.Services.Acoes;

namespace Notas.Api.Endpoints;

/// <summary>Ferramenta "Ações": registro de compras/vendas e a carteira com cotação atual.</summary>
public static partial class AcoesEndpoints
{
    [GeneratedRegex("^[A-Z]{4}[0-9]{1,2}F?$")]
    private static partial Regex TickerValido();

    public static void MapAcoesEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/acoes").RequireAuthorization();

        g.MapGet("/operacoes", async (ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var ops = await db.AcaoOperacoes.AsNoTracking().Where(o => o.UserId == user.UserId()).ToListAsync(ct);
            return ops.OrderByDescending(o => o.Data).ThenByDescending(o => o.CriadoEm).Select(ToDto);
        });

        g.MapPost("/operacoes", async (SalvarOperacaoRequest req, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var erro = Validar(req);
            if (erro is not null) return Results.BadRequest(new { erro });
            var userId = user.UserId();
            var ticker = req.Ticker.Trim().ToUpperInvariant();
            if (req.Tipo == "venda")
            {
                var ops = await db.AcaoOperacoes.AsNoTracking().Where(o => o.UserId == userId && o.Ticker == ticker).ToListAsync(ct);
                var emCarteira = Carteira.Calcular(ops.Where(o => o.Data <= req.Data)).FirstOrDefault()?.Quantidade ?? 0;
                if (req.Quantidade > emCarteira)
                    return Results.BadRequest(new { erro = $"Você tinha {emCarteira:0.####} {ticker} nessa data; não dá para vender {req.Quantidade:0.####}." });
            }
            var op = new AcaoOperacao
            {
                UserId = userId, Ticker = ticker, Tipo = req.Tipo, Quantidade = req.Quantidade, PrecoUnitario = req.PrecoUnitario,
                Taxas = req.Taxas ?? 0, Data = req.Data, Observacoes = string.IsNullOrWhiteSpace(req.Observacoes) ? null : req.Observacoes.Trim(),
            };
            db.AcaoOperacoes.Add(op);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/acoes/operacoes/{op.Id}", ToDto(op));
        });

        g.MapDelete("/operacoes/{id:guid}", async (Guid id, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
            await db.AcaoOperacoes.Where(o => o.Id == id && o.UserId == user.UserId()).ExecuteDeleteAsync(ct) > 0
                ? Results.NoContent() : Results.NotFound());

        g.MapGet("/carteira", async (ClaimsPrincipal user, AppDbContext db, ICotacoes cotacoes, CancellationToken ct) =>
        {
            var ops = await db.AcaoOperacoes.AsNoTracking().Where(o => o.UserId == user.UserId()).ToListAsync(ct);
            var posicoes = Carteira.Calcular(ops);
            var precos = await cotacoes.ObterAsync(posicoes.Where(p => p.Quantidade > 0).Select(p => p.Ticker), ct);
            return Carteira.Montar(posicoes, precos);
        });
    }

    private static string? Validar(SalvarOperacaoRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Ticker) || !TickerValido().IsMatch(req.Ticker.Trim().ToUpperInvariant()))
            return "Código inválido. Use o código da B3, como PETR4 ou MXRF11.";
        if (req.Tipo is not ("compra" or "venda")) return "Tipo deve ser compra ou venda.";
        if (req.Quantidade is <= 0 or > 100_000_000) return "Quantidade inválida.";
        if (req.PrecoUnitario is <= 0 or > 10_000_000) return "Preço inválido.";
        if (req.Taxas is < 0 or > 1_000_000) return "Taxas inválidas.";
        if (req.Data > DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1))) return "A data não pode ser no futuro.";
        if (req.Observacoes?.Length > 500) return "Observações muito longas.";
        return null;
    }

    private static OperacaoResponse ToDto(AcaoOperacao o) => new(
        o.Id, o.Ticker, o.Tipo, o.Quantidade, o.PrecoUnitario, o.Taxas, o.Data, o.Observacoes,
        Math.Round(o.Quantidade * o.PrecoUnitario + (o.Tipo == "compra" ? o.Taxas : -o.Taxas), 2));
}
