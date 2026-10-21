using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Dtos;

namespace Notas.Api.Endpoints;

/// <summary>
/// Ferramenta "Treino": recebe o que o app Treino Corrida registra no celular. Como na Dieta, GET devolve
/// tudo (ou só o que mudou desde ?desde=) e PUT /{id} grava se o UpdatedAt recebido for mais novo.
/// </summary>
public static class TreinoEndpoints
{
    public static readonly string[] Tipos = ["sessao", "livre"];

    public static void MapTreinoEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/treino").RequireAuthorization();

        g.MapGet("/atividades", async (DateTime? desde, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
            await db.TreinoAtividades.AsNoTracking()
                .Where(a => a.UserId == user.UserId() && (desde == null || a.UpdatedAt > Utc(desde)))
                .OrderBy(a => a.UpdatedAt).Select(a => ToDto(a)).ToListAsync(ct));

        g.MapPut("/atividades/{id}", async (string id, TreinoAtividadeDto req, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            if (id.Length is 0 or > 64 || !Tipos.Contains(req.Tipo) || req.DuracaoSeg is < 0 or > 86_400 || req.DistanciaM is < 0 or > 500_000
                || req.Esforco is < 1 or > 10 || req.FcMedia is < 20 or > 250 || req.FcMax is < 20 or > 250 || req.MaiorCorridaSeg is < 0 or > 86_400
                || string.IsNullOrWhiteSpace(req.Titulo) || req.Titulo.Length > 200 || req.Meta?.Length > 200 || req.Nota?.Length > 2000)
                return Results.BadRequest(new { error = "Atividade inválida." });
            var userId = user.UserId();
            var a = await db.TreinoAtividades.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (a is not null && a.UserId != userId) return Results.Conflict(new { error = "Id em uso." });
            if (a is null) db.TreinoAtividades.Add(a = new TreinoAtividade { Id = id, UserId = userId });
            else if (a.UpdatedAt >= req.UpdatedAt) return Results.Ok(ToDto(a));

            a.Inicio = Utc(req.Inicio)!.Value;
            a.Tipo = req.Tipo;
            a.Titulo = req.Titulo.Trim();
            a.DuracaoSeg = req.DuracaoSeg;
            a.DistanciaM = req.DistanciaM;
            a.MaiorCorridaSeg = req.MaiorCorridaSeg;
            a.Esforco = req.Esforco;
            a.Dor = req.Dor;
            a.Meta = req.Meta;
            a.FcMedia = req.FcMedia;
            a.FcMax = req.FcMax;
            a.Nota = req.Nota;
            a.UpdatedAt = req.UpdatedAt == default ? DateTime.UtcNow : Utc(req.UpdatedAt)!.Value;
            a.DeletedAt = Utc(req.DeletedAt);
            await db.SaveChangesAsync(ct);
            return Results.Ok(ToDto(a));
        });

        g.MapGet("/plano", async (ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
            await db.TreinoPlanos.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == user.UserId(), ct) is { } p
                ? Results.Ok(ToDto(p)) : Results.NoContent());

        g.MapPut("/plano", async (TreinoPlanoDto req, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(req.Programa) || req.Programa.Length > 200 || req.ProximaSessao?.Length > 200
                || req.Semana is < 0 or > 200 || req.SemanasTotal is < 0 or > 200 || req.SessoesFeitas is < 0 or > 2000 || req.SessoesTotal is < 0 or > 2000)
                return Results.BadRequest(new { error = "Plano inválido." });
            var userId = user.UserId();
            var p = await db.TreinoPlanos.FirstOrDefaultAsync(x => x.UserId == userId, ct);
            if (p is null) db.TreinoPlanos.Add(p = new TreinoPlano { UserId = userId });
            else if (req.UpdatedAt != default && p.UpdatedAt >= req.UpdatedAt) return Results.Ok(ToDto(p));
            p.Programa = req.Programa.Trim();
            p.Semana = req.Semana;
            p.SemanasTotal = req.SemanasTotal;
            p.SessoesFeitas = req.SessoesFeitas;
            p.SessoesTotal = req.SessoesTotal;
            p.ProximaSessao = req.ProximaSessao;
            p.UpdatedAt = req.UpdatedAt == default ? DateTime.UtcNow : Utc(req.UpdatedAt)!.Value;
            await db.SaveChangesAsync(ct);
            return Results.Ok(ToDto(p));
        });
    }

    private static TreinoAtividadeDto ToDto(TreinoAtividade a) => new(
        a.Id, a.Inicio, a.Tipo, a.Titulo, a.DuracaoSeg, a.DistanciaM, a.MaiorCorridaSeg, a.Esforco, a.Dor, a.Meta, a.FcMedia, a.FcMax, a.Nota, a.UpdatedAt, a.DeletedAt);

    private static TreinoPlanoDto ToDto(TreinoPlano p) =>
        new(p.Programa, p.Semana, p.SemanasTotal, p.SessoesFeitas, p.SessoesTotal, p.ProximaSessao, p.UpdatedAt);

    private static DateTime? Utc(DateTime? d) => d?.ToUniversalTime();
}
