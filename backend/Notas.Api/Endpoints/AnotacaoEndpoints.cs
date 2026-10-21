using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Notas.Api.Data;
using Notas.Api.Dtos;
using Notas.Api.Services.Anotacao;

namespace Notas.Api.Endpoints;

/// <summary>
/// Anotação: aprovação das pré-anotações que o Claude faz nos relatos do mestrado.
/// Os relatos são boletins de ocorrência reais, então a ferramenta exige as duas coisas:
/// <c>Anotacao__RunDir</c> com o lote atual e o e-mail do usuário em <c>Anotacao__Usuarios</c>.
/// Para quem não passa, o estado diz "desligada" e as outras rotas respondem 404 — nem a
/// existência da ferramenta aparece. O Caddy ainda exige HTTPS em /api/anotacao.
/// </summary>
public static class AnotacaoEndpoints
{
    public static void MapAnotacaoEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/anotacao").RequireAuthorization();

        group.MapGet("/estado", async (ClaimsPrincipal user, AppDbContext db, IOptions<AnotacaoOptions> opt, AnotacaoArquivos arquivos) =>
            await PodeAnotar(user, db, opt.Value)
                ? Results.Ok(arquivos.Estado())
                : Results.Ok(new EstadoAnotacaoResponse(false, 0, 0)));

        group.MapGet("/proximo", async (string? pular, ClaimsPrincipal user, AppDbContext db, IOptions<AnotacaoOptions> opt, AnotacaoArquivos arquivos) =>
        {
            if (!arquivos.Habilitado || !await PodeAnotar(user, db, opt.Value)) return Results.NotFound();
            var ignorar = (pular ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet();
            var doc = arquivos.Proximo(ignorar);
            return doc is null ? Results.NoContent() : Results.Ok(doc);
        });

        group.MapPost("/{rowId}/decisao", async (string rowId, DecisaoAnotacaoRequest req, ClaimsPrincipal user, AppDbContext db,
            IOptions<AnotacaoOptions> opt, AnotacaoArquivos arquivos, CancellationToken ct) =>
        {
            if (!arquivos.Habilitado || !await PodeAnotar(user, db, opt.Value)) return Results.NotFound();
            var erro = await arquivos.RegistrarAsync(rowId, req, ct);
            return erro is null ? Results.NoContent() : Results.BadRequest(new { erro });
        });
    }

    private static async Task<bool> PodeAnotar(ClaimsPrincipal user, AppDbContext db, AnotacaoOptions opt)
    {
        if (string.IsNullOrWhiteSpace(opt.Usuarios)) return false;
        var id = user.UserId();
        var email = await db.Users.AsNoTracking().Where(u => u.Id == id).Select(u => u.Email).FirstOrDefaultAsync();
        return opt.PodeAnotar(email);
    }
}
