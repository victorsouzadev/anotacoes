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

    // Miniaturas, não as artes: uma folha inteira de adesivos cabe com folga.
    private const int MaxNomesBytes = 6 * 1024 * 1024;

    public static void MapImagemEndpoints(this IEndpointRouteBuilder app)
    {
        MapUpscale(app);
        MapNomes(app);
        MapBiblioteca(app);
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

    // Uma arte (PNG em data URL) e a miniatura dela.
    private const int MaxBibliotecaBytes = 8 * 1024 * 1024;
    private const int MaxThumbBytes = 200 * 1024;
    private const int MaxItensBiblioteca = 300;

    /// <summary>
    /// Biblioteca: artes guardadas pra reusar em qualquer projeto. A lista
    /// devolve só as miniaturas; a arte inteira vem item a item.
    /// </summary>
    private static void MapBiblioteca(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/imagens/biblioteca").RequireAuthorization();

        group.MapGet("/", async (ClaimsPrincipal user, AppDbContext db) =>
        {
            var itens = await db.ImageLibrary.AsNoTracking()
                .Where(i => i.UserId == user.UserId())
                .OrderByDescending(i => i.UpdatedAt)
                .Select(i => new ImageLibraryMetaDto(i.Id, i.Name, i.Origin, i.Thumb, i.WidthMm, i.CreatedAt))
                .ToListAsync();
            return Results.Ok(itens);
        });

        group.MapGet("/{id}", async (string id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var item = await db.ImageLibrary.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id && i.UserId == user.UserId());
            return item is null
                ? Results.NotFound()
                : Results.Ok(new ImageLibraryItemDto(item.Id, item.Name, item.Origin, item.Data, item.WidthMm, item.CreatedAt));
        });

        group.MapPut("/{id}", async (string id, ImageLibraryUpsertRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(id) || id.Length > 64) return Results.BadRequest(new { error = "Id inválido." });
            var name = (req.Name ?? "").Trim();
            if (name.Length is 0 or > 200) return Results.BadRequest(new { error = "Dê um nome de até 200 caracteres." });
            if (!TentarLerDataUrl(req.Data, out _, out _)) return Results.BadRequest(new { error = "A arte precisa ser uma imagem PNG, JPEG ou WebP." });
            if ((req.Data?.Length ?? 0) > MaxBibliotecaBytes) return Results.Json(new { error = "Arte grande demais pra biblioteca." }, statusCode: 413);
            if (!TentarLerDataUrl(req.Thumb, out _, out _) || req.Thumb!.Length > MaxThumbBytes)
                return Results.BadRequest(new { error = "Miniatura inválida." });

            var userId = user.UserId();
            var item = await db.ImageLibrary.FirstOrDefaultAsync(i => i.Id == id && i.UserId == userId);
            if (item is null)
            {
                if (await db.ImageLibrary.AnyAsync(i => i.Id == id)) return Results.Conflict(new { error = "Id em uso." });
                if (await db.ImageLibrary.CountAsync(i => i.UserId == userId) >= MaxItensBiblioteca)
                    return Results.BadRequest(new { error = $"A biblioteca chegou a {MaxItensBiblioteca} artes — apague algumas antes." });
                item = new ImageLibraryItem { Id = id, UserId = userId, CreatedAt = DateTime.UtcNow };
                db.ImageLibrary.Add(item);
            }
            item.Name = name;
            item.Origin = (req.Origin ?? "").Length <= 20 ? req.Origin ?? "" : "";
            item.Data = req.Data!;
            item.Thumb = req.Thumb!;
            item.WidthMm = double.IsFinite(req.WidthMm) && req.WidthMm > 0 ? Math.Min(req.WidthMm, 5000) : 0;
            item.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(new ImageLibraryMetaDto(item.Id, item.Name, item.Origin, item.Thumb, item.WidthMm, item.CreatedAt));
        });

        group.MapDelete("/{id}", async (string id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var item = await db.ImageLibrary.FirstOrDefaultAsync(i => i.Id == id && i.UserId == user.UserId());
            if (item is null) return Results.NotFound();
            db.ImageLibrary.Remove(item);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    /// <summary>
    /// Nomes dos elementos, dados por IA a partir das miniaturas. Existe para a
    /// exportação em ZIP: depois de dividir uma folha, "proj 1…proj 6" obriga a
    /// abrir arquivo por arquivo pra achar o polvo. Falhar aqui não é erro de
    /// exportação — o editor segue com os nomes que já tinha.
    /// </summary>
    private static void MapNomes(IEndpointRouteBuilder app)
    {
        app.MapPost("/api/imagens/nomes", async (
            NomearElementosRequest req, ClaimsPrincipal user, INomeadorDeElementos nomeador, CancellationToken ct) =>
        {
            var imagens = req.Imagens ?? new List<string>();
            if (imagens.Count == 0) return Results.BadRequest(new { erro = "Envie ao menos uma imagem." });
            if (imagens.Count > NomeadorDeElementos.MaxImagens)
            {
                return Results.BadRequest(new { erro = $"No máximo {NomeadorDeElementos.MaxImagens} imagens por vez." });
            }
            if (imagens.Any(i => string.IsNullOrWhiteSpace(i) || !i.StartsWith("data:image/", StringComparison.Ordinal)))
            {
                return Results.BadRequest(new { erro = "Cada imagem precisa ser uma data URL de imagem." });
            }
            if (imagens.Sum(i => i.Length) > MaxNomesBytes)
            {
                return Results.BadRequest(new { erro = "As miniaturas somadas passaram do limite; reduza a quantidade." });
            }

            var resultado = await nomeador.NomearAsync(user.UserId(), imagens, ct);
            return Results.Ok(new NomearElementosResponse(resultado.Nomes, resultado.UsouIa, resultado.Motivo));
        }).RequireAuthorization();
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

        // Recorte por IA: volta um PNG do mesmo enquadramento com o fundo transparente.
        group.MapPost("/remover-fundo", async (
            RemoveBgRequest req, ClaimsPrincipal user, IUpscalerFactory factory, CancellationToken ct) =>
        {
            var removedor = await factory.CriarRemovedorDeFundoAsync(user.UserId(), ct);
            if (!removedor.Disponivel)
            {
                return Results.Json(
                    new { error = "Nenhuma chave de IA de imagem configurada. Cadastre a sua em Configurações." },
                    statusCode: 503);
            }

            if (!TentarLerDataUrl(req.Imagem, out var bytes, out var contentType))
                return Results.BadRequest(new { error = "Imagem inválida." });

            try
            {
                var recorte = await removedor.RemoverFundoAsync(bytes, contentType, ct);
                var dataUrl = $"data:{recorte.ContentType};base64,{Convert.ToBase64String(recorte.Conteudo)}";
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
                return Results.Json(new { error = "A remoção de fundo demorou demais e foi cancelada." }, statusCode: 504);
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
