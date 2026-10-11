using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Services.Financas.Auvp;
using Notas.Api.Services.Seguranca;

namespace Notas.Api.Endpoints;

public record AuvpConfiguracaoResponse(bool Habilitado, bool ChaveConfigurada, string? ChaveMascarada,
    DateTime? UltimaSincronizacaoEm);

public record SalvarAuvpRequest(string? Chave);

public record SincronizarAuvpRequest(DateOnly? De, DateOnly? Ate);

public record SincronizarAuvpResponse(int Importadas, int JaExistentes, int Atualizadas, int ForaDosTotais,
    DateTime SincronizadoEm);

public record AuvpTagResponse(long Id, string Nome, string? Cor);

public record AuvpOrcamentoResponse(string Chave, string Nome);

public record AuvpOrcamentoMesItem(string Nome, decimal Meta, decimal Planejado, decimal Gasto, decimal Restante,
    decimal Utilizado);

public record AuvpOrcamentoMesResponse(int Ano, int Mes, decimal TotalPlanejado, decimal TotalGasto,
    decimal SemOrcamento, List<AuvpOrcamentoMesItem> Itens);

public record AuvpContaResponse(long Id, string Nome, string Tipo, decimal Saldo, string? Numero,
    DateTimeOffset? AtualizadaEm, decimal? LimiteTotal, decimal? LimiteDisponivel, decimal? FaturaAberta,
    DateOnly? MesDaFatura);

// Importação de transações da AUVP Financeiro (open banking). A chave é do
// usuário, guardada cifrada; a URL da API é do servidor (Auvp__BaseUrl).
public static class AuvpEndpoints
{
    public static void MapAuvpEndpoints(this IEndpointRouteBuilder app)
    {
        var grupo = app.MapGroup("/api/financas/auvp").RequireAuthorization();

        grupo.MapGet("/", async (ClaimsPrincipal user, AppDbContext db, IAuvpCliente cliente, CancellationToken ct) =>
        {
            var userId = user.UserId();
            var config = await db.ConfiguracoesAuvp.AsNoTracking().FirstOrDefaultAsync(c => c.UserId == userId, ct);
            return Results.Ok(Montar(config, cliente));
        });

        grupo.MapPut("/", async (SalvarAuvpRequest req, ClaimsPrincipal user, AppDbContext db,
            IProtetorDeSegredos protetor, IAuvpCliente cliente, CancellationToken ct) =>
        {
            var chave = (req.Chave ?? "").Trim();
            if (chave.Length is < 8 or > 400)
                return Results.BadRequest(new { erro = "A chave de API da AUVP não parece válida." });

            var userId = user.UserId();
            var config = await db.ConfiguracoesAuvp.FirstOrDefaultAsync(c => c.UserId == userId, ct);
            if (config is null)
            {
                config = new ConfiguracaoAuvp { UserId = userId };
                db.ConfiguracoesAuvp.Add(config);
            }

            config.ChaveCifrada = protetor.Proteger(chave);
            config.ChaveSufixo = chave[^4..];
            config.AtualizadoEm = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);

            return Results.Ok(Montar(config, cliente));
        });

        grupo.MapDelete("/", async (ClaimsPrincipal user, AppDbContext db, IAuvpCliente cliente, CancellationToken ct) =>
        {
            var userId = user.UserId();
            var config = await db.ConfiguracoesAuvp.FirstOrDefaultAsync(c => c.UserId == userId, ct);
            if (config is null) return Results.NotFound();

            // Os lançamentos já importados ficam: são dados do usuário agora.
            db.ConfiguracoesAuvp.Remove(config);
            await db.SaveChangesAsync(ct);
            return Results.Ok(Montar(null, cliente));
        });

        grupo.MapPost("/sincronizar", async (SincronizarAuvpRequest? req, ClaimsPrincipal user, AppDbContext db,
            IProtetorDeSegredos protetor, IAuvpCliente cliente, AuvpSincronizador sincronizador,
            CancellationToken ct) =>
        {
            if (!cliente.Habilitado)
                return Results.Problem(title: "Integração com a AUVP desligada",
                    detail: "O servidor não tem a URL da API da AUVP configurada (Auvp__BaseUrl).",
                    statusCode: StatusCodes.Status503ServiceUnavailable);

            if (req?.De is { } de && req.Ate is { } ate && de > ate)
                return Results.BadRequest(new { erro = "A data inicial é depois da final." });

            var userId = user.UserId();
            var config = await db.ConfiguracoesAuvp.FirstOrDefaultAsync(c => c.UserId == userId, ct);
            if (config?.ChaveCifrada is not { Length: > 0 })
                return Results.BadRequest(new { erro = "Cadastre a chave de API da AUVP antes de sincronizar." });

            // Null quando o segredo do servidor mudou e a chave antiga não decifra mais.
            var chave = protetor.Desproteger(config.ChaveCifrada);
            if (chave is null)
                return Results.BadRequest(new { erro = "Não consegui ler a chave da AUVP salva. Cadastre-a de novo." });

            ResultadoSincronizacaoAuvp resultado;
            try
            {
                resultado = await sincronizador.SincronizarAsync(userId, chave,
                    config.UltimaSincronizacaoEm, req?.De, req?.Ate, ct);
            }
            catch (AuvpIndisponivelException ex)
            {
                return Results.Problem(title: ex.ChaveRecusada ? "Chave da AUVP recusada" : "AUVP indisponível",
                    detail: ex.Message, statusCode: StatusCodes.Status502BadGateway);
            }

            // Sincronizar um período específico não conta como "em dia": a próxima
            // sincronização automática ainda precisa cobrir o resto.
            if (req?.De is null && req?.Ate is null)
            {
                config.UltimaSincronizacaoEm = resultado.SincronizadoEm;
                await db.SaveChangesAsync(ct);
            }

            return Results.Ok(new SincronizarAuvpResponse(resultado.Importadas, resultado.JaExistentes,
                resultado.Atualizadas, resultado.ForaDosTotais, resultado.SincronizadoEm));
        }).RequireRateLimiting("financas-importacao");

        // Leituras ao vivo da AUVP — o que não faz sentido copiar para cá porque
        // muda a toda hora (saldo, limite, fatura aberta) ou é configuração de lá.

        grupo.MapGet("/tags", (ClaimsPrincipal user, AuvpEscrita escrita, IAuvpCliente cliente, CancellationToken ct) =>
            ComChave(user, escrita, async chave => (await cliente.ListarTagsAsync(chave, ct))
                .Where(t => t.Status is null or "ACTIVE" && !string.IsNullOrWhiteSpace(t.Name))
                .OrderBy(t => t.Name, StringComparer.CurrentCultureIgnoreCase)
                .Select(t => new AuvpTagResponse(t.Id, t.Name!, t.Color))
                .ToList(), ct));

        grupo.MapGet("/orcamentos", (ClaimsPrincipal user, AuvpEscrita escrita, IAuvpCliente cliente, CancellationToken ct) =>
            ComChave(user, escrita, async chave => (await cliente.ListarOrcamentosAsync(chave, ct))
                .Where(o => o.Key is not null)
                .Select(o => new AuvpOrcamentoResponse(o.Key!, o.Name ?? o.Key!))
                .ToList(), ct));

        grupo.MapGet("/orcamento-mensal", (int ano, int mes, ClaimsPrincipal user, AuvpEscrita escrita,
            IAuvpCliente cliente, CancellationToken ct) =>
        {
            if (mes is < 1 or > 12) return Task.FromResult(Results.BadRequest(new { erro = "Mês inválido." }));
            return ComChave(user, escrita, async chave =>
            {
                var r = await cliente.OrcamentoMensalAsync(chave, new DateOnly(ano, mes, 1), ct);
                return new AuvpOrcamentoMesResponse(ano, mes,
                    Math.Round(r.Totals?.TotalToSpend ?? 0, 2), Math.Round(r.Totals?.TotalSpent ?? 0, 2),
                    Math.Round(r.Totals?.Uncategorized ?? 0, 2),
                    r.Resume.Select(i => new AuvpOrcamentoMesItem(i.Name ?? "", i.Goal,
                        Math.Round(i.AmountToSpend, 2), Math.Round(i.AmountSpent, 2), Math.Round(i.Remaining, 2),
                        Math.Round(i.Utilized, 2))).ToList());
            }, ct);
        });

        grupo.MapGet("/contas", (ClaimsPrincipal user, AuvpEscrita escrita, IAuvpCliente cliente, CancellationToken ct) =>
            ComChave(user, escrita, async chave =>
            {
                var contas = await cliente.ListarContasAsync(chave, ct);
                var resposta = new List<AuvpContaResponse>();
                foreach (var c in contas)
                {
                    var cartao = string.Equals(c.Subtype, "CREDIT_CARD", StringComparison.OrdinalIgnoreCase);
                    AuvpFaturaEstimada? fatura = null;
                    if (cartao && c.ExternalId is { Length: > 0 } ext)
                        fatura = await cliente.FaturaEstimadaAsync(chave, ext, ct);
                    resposta.Add(new AuvpContaResponse(c.Id, c.Name ?? "Conta", cartao ? "cartao" : "conta",
                        c.Balance, c.Number, c.LastSyncedAt,
                        Decimal(c.CreditAccountData?.TotalLimit), Decimal(c.CreditAccountData?.AvailableLimit),
                        fatura is null ? null : Math.Round(fatura.ProjectedTotal, 2),
                        fatura?.ReferenceMonth is { } m
                            ? new DateOnly(m.ToOffset(TimeSpan.FromHours(-3)).Year, m.ToOffset(TimeSpan.FromHours(-3)).Month, 1)
                            : null));
                }
                return resposta.OrderBy(c => c.Tipo).ThenByDescending(c => Math.Abs(c.Saldo)).ToList();
            }, ct));
    }

    private static decimal? Decimal(string? s) =>
        decimal.TryParse(s, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var v)
            ? v : null;

    private static async Task<IResult> ComChave<T>(ClaimsPrincipal user, AuvpEscrita escrita,
        Func<string, Task<T>> acao, CancellationToken ct)
    {
        var chave = await escrita.ChaveAsync(user.UserId(), ct);
        if (chave is null)
            return Results.BadRequest(new { erro = "Cadastre a chave de API da AUVP primeiro." });
        try
        {
            return Results.Ok(await acao(chave));
        }
        catch (AuvpIndisponivelException ex)
        {
            return Results.Problem(title: "AUVP indisponível", detail: ex.Message,
                statusCode: StatusCodes.Status502BadGateway);
        }
    }

    private static AuvpConfiguracaoResponse Montar(ConfiguracaoAuvp? config, IAuvpCliente cliente) => new(
        cliente.Habilitado,
        config?.ChaveCifrada is { Length: > 0 },
        config?.ChaveSufixo is { } s ? $"••••••••{s}" : null,
        config?.UltimaSincronizacaoEm);
}
