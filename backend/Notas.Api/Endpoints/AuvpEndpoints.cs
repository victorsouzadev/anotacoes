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

public record SincronizarAuvpResponse(int Importadas, int JaExistentes, int ParaRevisao, DateTime SincronizadoEm);

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
                resultado.ParaRevisao, resultado.SincronizadoEm));
        }).RequireRateLimiting("financas-importacao");
    }

    private static AuvpConfiguracaoResponse Montar(ConfiguracaoAuvp? config, IAuvpCliente cliente) => new(
        cliente.Habilitado,
        config?.ChaveCifrada is { Length: > 0 },
        config?.ChaveSufixo is { } s ? $"••••••••{s}" : null,
        config?.UltimaSincronizacaoEm);
}
