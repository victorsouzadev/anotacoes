using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;

namespace Notas.Api.Endpoints;

public record NoteShareDto(string Id, string Nome, DateTime? ExpiraEm, DateTime? RevogadoEm, DateTime CreatedAt);
public record NoteShareCriado(string Id, string Nome, DateTime? ExpiraEm, DateTime CreatedAt, string Url);
public record NoteShareCriar(string? Nome, int? DiasValidade);
public record NotaPublicaDto(string Title, string Elements, DateTime UpdatedAt);

/// <summary>
/// Link somente leitura de nota (spec 023). O token só existe na resposta da criação; o banco guarda
/// o SHA-256, então um vazamento do banco não abre as notas compartilhadas. A página pública é a
/// rota Angular /p/nota/{token}, que lê <c>GET /api/notes/publico/{token}</c> sem login.
/// </summary>
public static class NotesShareEndpoints
{
    public static readonly int[] Validades = [7, 30, 90];
    private const string Indisponivel = "Este link não está mais disponível.";

    public static void MapNotesShareEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/notes/{id}/links").RequireAuthorization();

        g.MapGet("/", async (string id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = user.UserId();
            if (!await db.Notes.AnyAsync(n => n.Id == id && n.UserId == uid)) return Results.NotFound();
            var lista = await db.NoteShares.AsNoTracking()
                .Where(s => s.NoteId == id && s.UserId == uid)
                .OrderByDescending(s => s.CreatedAt)
                .Select(s => new NoteShareDto(s.Id, s.Nome, s.ExpiraEm, s.RevogadoEm, s.CreatedAt))
                .ToListAsync();
            return Results.Ok(lista);
        });

        g.MapPost("/", async (string id, NoteShareCriar req, ClaimsPrincipal user, AppDbContext db, HttpRequest http) =>
        {
            var uid = user.UserId();
            var nota = await db.Notes.AsNoTracking().FirstOrDefaultAsync(n => n.Id == id && n.UserId == uid);
            if (nota is null || nota.DeletedAt is not null || nota.TrashedAt is not null)
                return Results.NotFound(new { error = "Nota não encontrada." });
            var nome = (req.Nome ?? "").Trim();
            if (nome.Length == 0) nome = "Link";
            if (nome.Length > 80) return Results.BadRequest(new { error = "Nome muito longo (até 80 caracteres)." });
            if (req.DiasValidade is { } d && !Validades.Contains(d))
                return Results.BadRequest(new { error = "Validade inválida (7, 30 ou 90 dias, ou sem validade)." });

            var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
                .TrimEnd('=').Replace('+', '-').Replace('/', '_');
            var agora = DateTime.UtcNow;
            var share = new NoteShare
            {
                Id = Guid.NewGuid().ToString(),
                NoteId = id,
                UserId = uid,
                TokenHash = Hash(token),
                Nome = nome,
                ExpiraEm = req.DiasValidade is { } dias ? agora.AddDays(dias) : null,
                CreatedAt = agora,
            };
            db.NoteShares.Add(share);
            await db.SaveChangesAsync();
            var url = $"{http.Scheme}://{http.Host}/p/nota/{token}";
            return Results.Ok(new NoteShareCriado(share.Id, share.Nome, share.ExpiraEm, share.CreatedAt, url));
        });

        g.MapDelete("/{linkId}", async (string id, string linkId, ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = user.UserId();
            var share = await db.NoteShares.FirstOrDefaultAsync(s => s.Id == linkId && s.NoteId == id && s.UserId == uid);
            if (share is null) return Results.NotFound();
            share.RevogadoEm ??= DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        app.MapGet("/api/notes/publico/{token}", async (string token, AppDbContext db) =>
        {
            if (token.Length is < 20 or > 100) return Results.NotFound(new { error = Indisponivel });
            var hash = Hash(token);
            var agora = DateTime.UtcNow;
            var share = await db.NoteShares.AsNoTracking().FirstOrDefaultAsync(s => s.TokenHash == hash);
            if (share is null || share.RevogadoEm is not null || (share.ExpiraEm is { } e && e <= agora))
                return Results.NotFound(new { error = Indisponivel });
            var nota = await db.Notes.AsNoTracking()
                .FirstOrDefaultAsync(n => n.Id == share.NoteId && n.UserId == share.UserId);
            if (nota is null || nota.DeletedAt is not null || nota.TrashedAt is not null)
                return Results.NotFound(new { error = Indisponivel });
            // Só título e páginas: nada de e-mail, pasta, id da nota ou datas de criação.
            return Results.Ok(new NotaPublicaDto(nota.Title, nota.Elements, nota.UpdatedAt));
        }).AllowAnonymous().RequireRateLimiting("publico");
    }

    public static string Hash(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();
}
