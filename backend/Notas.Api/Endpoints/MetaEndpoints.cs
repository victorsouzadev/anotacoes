using System.Security.Claims;
using Notas.Api.Dtos;
using Notas.Api.Services.Financas;

namespace Notas.Api.Endpoints;

// Metas de reserva: quanto o usuário quer juntar, até quando, e quanto já juntou.
public static class MetaEndpoints
{
    public static void MapMetaEndpoints(this IEndpointRouteBuilder app)
    {
        var metas = app.MapGroup("/api/financas/metas").RequireAuthorization();

        metas.MapGet("/", async (ClaimsPrincipal user, MetaService service, CancellationToken ct, bool? incluirArquivadas) =>
            Results.Ok(await service.ListarAsync(user.UserId(), incluirArquivadas == true, ct)));

        metas.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal user, MetaService service, CancellationToken ct) =>
        {
            var meta = await service.ObterAsync(user.UserId(), id, ct);
            return meta is null ? Results.NotFound() : Results.Ok(meta);
        });

        // Lançamentos de investimento ainda não vinculados a nenhuma meta: o
        // atalho para transformar em aporte o que já foi registrado.
        metas.MapGet("/investimentos-disponiveis", async (ClaimsPrincipal user, MetaService service, CancellationToken ct) =>
            Results.Ok(await service.InvestimentosDisponiveisAsync(user.UserId(), ct)));

        metas.MapPost("/", async (SalvarMetaRequest req, ClaimsPrincipal user, MetaService service, CancellationToken ct) =>
            await Executar(async () =>
            {
                var meta = await service.CriarAsync(user.UserId(), req, ct);
                return Results.Created($"/api/financas/metas/{meta.Id}", meta);
            }));

        metas.MapPut("/{id:guid}", async (Guid id, SalvarMetaRequest req, ClaimsPrincipal user,
            MetaService service, CancellationToken ct) => await Executar(async () =>
        {
            var meta = await service.AtualizarAsync(user.UserId(), id, req, ct);
            return meta is null ? Results.NotFound() : Results.Ok(meta);
        }));

        metas.MapPost("/{id:guid}/arquivar", async (Guid id, ClaimsPrincipal user, MetaService service,
            CancellationToken ct, bool? desarquivar) =>
        {
            var meta = await service.ArquivarAsync(user.UserId(), id, desarquivar != true, ct);
            return meta is null ? Results.NotFound() : Results.Ok(meta);
        });

        metas.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal user, MetaService service, CancellationToken ct) =>
            await service.RemoverAsync(user.UserId(), id, ct) ? Results.NoContent() : Results.NotFound());

        metas.MapPost("/{id:guid}/aportes", async (Guid id, CriarAporteRequest req, ClaimsPrincipal user,
            MetaService service, CancellationToken ct) => await Executar(async () =>
        {
            var meta = await service.AdicionarAporteAsync(user.UserId(), id, req, ct);
            return meta is null ? Results.NotFound() : Results.Ok(meta);
        }));

        metas.MapDelete("/{id:guid}/aportes/{aporteId:guid}", async (Guid id, Guid aporteId, ClaimsPrincipal user,
            MetaService service, CancellationToken ct) =>
        {
            var meta = await service.RemoverAporteAsync(user.UserId(), id, aporteId, ct);
            return meta is null ? Results.NotFound() : Results.Ok(meta);
        });
    }

    // As mensagens do serviço são escritas para o usuário final, então viram 400
    // com o texto pronto para exibição.
    private static async Task<IResult> Executar(Func<Task<IResult>> acao)
    {
        try
        {
            return await acao();
        }
        catch (MetaInvalidaException ex)
        {
            return Results.BadRequest(new { erro = ex.Message });
        }
    }
}
