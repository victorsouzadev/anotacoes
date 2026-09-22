using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Dtos;
using Notas.Api.Services.Imagens;

namespace Notas.Api.Endpoints;

/// <summary>
/// Projetos do Editor de Imagens. Mesma estratégia das notas: Id vindo do cliente,
/// PUT idempotente com last-write-wins por UpdatedAt e exclusão lógica — o payload
/// é um blob JSON opaco (artes em data URL + parâmetros de contorno e folha).
/// </summary>
public static class ImagemEndpoints
{
    // As artes vão embutidas no JSON, então o teto é maior que o de uma nota,
    // mas ainda abaixo do limite de corpo de requisição do Kestrel (10 MB).
    private const int MaxDataBytes = 9 * 1024 * 1024;

    public static void MapImagemEndpoints(this IEndpointRouteBuilder app)
    {
        MapUpscale(app);
        var group = app.MapGroup("/api/imagens/projetos").RequireAuthorization();

        group.MapGet("/", async (ClaimsPrincipal user, AppDbContext db) =>
        {
            var metas = await db.ImageProjects.AsNoTracking()
                .Where(p => p.UserId == user.UserId() && p.DeletedAt == null)
                .OrderByDescending(p => p.UpdatedAt)
                .Select(p => new ImageProjectMetaDto(p.Id, p.Name, p.CreatedAt, p.UpdatedAt))
                .ToListAsync();
            return Results.Ok(metas);
        });

        group.MapGet("/{id}", async (string id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var project = await db.ImageProjects.AsNoTracking()
                .FirstOrDefaultAsync(p => p.Id == id && p.UserId == user.UserId());
            return project is null || project.DeletedAt is not null
                ? Results.NotFound()
                : Results.Ok(ToDto(project));
        });

        group.MapPut("/{id}", (string id, ImageProjectUpsertRequest req, ClaimsPrincipal user, AppDbContext db) =>
            Upsert(req with { Id = id }, user, db));

        group.MapDelete("/{id}", async (string id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var project = await db.ImageProjects.FirstOrDefaultAsync(p => p.Id == id && p.UserId == user.UserId());
            if (project is null) return Results.NotFound();
            project.DeletedAt = DateTime.UtcNow;
            project.UpdatedAt = DateTime.UtcNow;
            project.Data = "{}"; // libera o espaço das artes já na exclusão
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    /// <summary>
    /// Ampliação por IA. A foto vem em data URL, é ampliada num serviço externo e
    /// volta em data URL — o editor troca a foto de trabalho pela ampliada.
    /// A chave do serviço mora só aqui: o navegador nunca a vê.
    /// </summary>
    private static void MapUpscale(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/imagens").RequireAuthorization();

        // O editor pergunta antes de oferecer o botão: recurso sem chave não deve
        // aparecer só pra falhar quando clicado.
        group.MapGet("/upscale", async (ClaimsPrincipal user, IUpscalerFactory factory,
            Microsoft.Extensions.Options.IOptions<UpscaleOptions> options, CancellationToken ct) =>
        {
            var efetivo = await factory.ResolverAsync(user.UserId(), ct);
            return Results.Ok(new UpscaleStatusDto(efetivo.Disponivel, options.Value.MaxInputPixels));
        });

        group.MapPost("/reiluminar", async (
            RelightRequest req, ClaimsPrincipal user, IUpscalerFactory factory, CancellationToken ct) =>
        {
            var relighter = await factory.CriarRelighterAsync(user.UserId(), ct);
            if (!relighter.Disponivel)
            {
                return Results.Json(
                    new { error = "Nenhuma chave de IA de imagem configurada. Cadastre a sua em Configurações." },
                    statusCode: 503);
            }

            if (!TentarLerDataUrl(req.Imagem, out var bytes, out var contentType))
                return Results.BadRequest(new { error = "Imagem inválida." });

            try
            {
                var luz = await relighter.ReiluminarAsync(bytes, contentType, req.Direcao ?? "esquerda", ct);
                var dataUrl = $"data:{luz.ContentType};base64,{Convert.ToBase64String(luz.Conteudo)}";
                return Results.Ok(new UpscaleResponse(dataUrl));
            }
            catch (UpscaleIndisponivelException ex)
            {
                return Results.Json(new { error = ex.Message, tentarMenor = ex.TentarMenor }, statusCode: 502);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return Results.StatusCode(499);
            }
            catch (TaskCanceledException)
            {
                return Results.Json(new { error = "A reiluminação demorou demais e foi cancelada." }, statusCode: 504);
            }
        });

        group.MapPost("/upscale", async (
            UpscaleRequest req, ClaimsPrincipal user, IUpscalerFactory factory, CancellationToken ct) =>
        {
            var upscaler = await factory.CriarAsync(user.UserId(), ct);
            if (!upscaler.Disponivel)
            {
                return Results.Json(
                    new { error = "Nenhuma chave de ampliação configurada. Cadastre a sua em Configurações." },
                    statusCode: 503);
            }

            if (!TentarLerDataUrl(req.Imagem, out var bytes, out var contentType))
                return Results.BadRequest(new { error = "Imagem inválida." });

            try
            {
                var ampliada = await upscaler.AmpliarAsync(bytes, contentType, req.Escala <= 0 ? 2 : req.Escala, ct);
                var dataUrl = $"data:{ampliada.ContentType};base64,{Convert.ToBase64String(ampliada.Conteudo)}";
                return Results.Ok(new UpscaleResponse(dataUrl));
            }
            catch (UpscaleIndisponivelException ex)
            {
                // Falha esperada e com texto pronto pro usuário: 502, não 500.
                // `tentarMenor` diz ao cliente que reenviar reduzido tem chance.
                return Results.Json(new { error = ex.Message, tentarMenor = ex.TentarMenor }, statusCode: 502);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return Results.StatusCode(499);
            }
            catch (TaskCanceledException)
            {
                return Results.Json(new { error = "A ampliação demorou demais e foi cancelada." }, statusCode: 504);
            }
        });
    }

    /// <summary>
    /// Lê uma data URL de imagem. Só os tipos que o editor sabe desenhar passam —
    /// o que chega aqui vai direto pra um serviço externo.
    /// </summary>
    internal static bool TentarLerDataUrl(string? valor, out byte[] bytes, out string contentType)
    {
        bytes = [];
        contentType = "";
        if (string.IsNullOrWhiteSpace(valor)) return false;
        if (valor.Length > MaxDataBytes) return false;

        var separador = valor.IndexOf(";base64,", StringComparison.Ordinal);
        if (separador < 0 || !valor.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase)) return false;

        var tipo = valor[5..separador].ToLowerInvariant();
        if (tipo is not ("image/png" or "image/jpeg" or "image/webp")) return false;

        try
        {
            bytes = Convert.FromBase64String(valor[(separador + 8)..]);
        }
        catch (FormatException)
        {
            return false;
        }

        contentType = tipo;
        return bytes.Length > 0;
    }

    private static async Task<IResult> Upsert(ImageProjectUpsertRequest req, ClaimsPrincipal user, AppDbContext db)
    {
        if (string.IsNullOrWhiteSpace(req.Id) || req.Id.Length > 64)
            return Results.BadRequest(new { error = "Id inválido." });
        if ((req.Name?.Length ?? 0) > 300)
            return Results.BadRequest(new { error = "Nome muito longo." });
        if ((req.Data?.Length ?? 0) > MaxDataBytes)
            return Results.Json(new { error = "Projeto muito grande." }, statusCode: 413);

        var userId = user.UserId();
        var project = await db.ImageProjects.FirstOrDefaultAsync(p => p.Id == req.Id && p.UserId == userId);
        var isNew = project is null;
        if (project is null)
        {
            if (await db.ImageProjects.AnyAsync(p => p.Id == req.Id))
                return Results.Conflict(new { error = "Id em uso." });
            project = new ImageProject
            {
                Id = req.Id,
                UserId = userId,
                CreatedAt = req.CreatedAt == default ? DateTime.UtcNow : req.CreatedAt,
            };
            db.ImageProjects.Add(project);
        }
        else if (project.UpdatedAt >= req.UpdatedAt)
        {
            return Results.Ok(ToDto(project));
        }

        Apply(project, req);

        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException) when (isNew)
        {
            // Dois salvamentos concorrentes do mesmo projeto novo: a requisição perdedora
            // cai aqui. Em vez de 500, trata como update do que já foi gravado.
            db.Entry(project).State = EntityState.Detached;
            var existing = await db.ImageProjects.FirstOrDefaultAsync(p => p.Id == req.Id && p.UserId == userId);
            if (existing is null) throw;
            if (existing.UpdatedAt < req.UpdatedAt)
            {
                Apply(existing, req);
                await db.SaveChangesAsync();
            }
            project = existing;
        }
        return Results.Ok(ToDto(project));
    }

    private static void Apply(ImageProject project, ImageProjectUpsertRequest req)
    {
        project.Name = req.Name ?? "";
        project.Data = req.Data ?? "{}";
        project.UpdatedAt = req.UpdatedAt == default ? DateTime.UtcNow : req.UpdatedAt;
        project.DeletedAt = req.DeletedAt;
        if (project.DeletedAt is not null) project.Data = "{}";
    }

    private static ImageProjectDto ToDto(ImageProject p) =>
        new(p.Id, p.Name, p.Data, p.CreatedAt, p.UpdatedAt, p.DeletedAt);
}
