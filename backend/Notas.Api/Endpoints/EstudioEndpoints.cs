using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Dtos;
using Notas.Api.Services.Estudio;
using Notas.Api.Services.Seguranca;

namespace Notas.Api.Endpoints;

/// <summary>
/// Estúdio: catálogo de modelos de IA, biblioteca de arquivos, gerações (fal.ai / World Labs),
/// montagens locais (ffmpeg) e os documentos das ferramentas (storyboard, moodboard, cena, linha do tempo).
/// </summary>
public static class EstudioEndpoints
{
    /// <summary>Teto de um envio (vídeo bruto cabe; a API geral segue com o limite pequeno).</summary>
    private const long UploadMax = 500L * 1024 * 1024;

    private static readonly string[] TiposDeQuadro = ["storyboard", "moodboard", "cena", "timeline"];

    public static void MapEstudioEndpoints(this IEndpointRouteBuilder app)
    {
        // Arquivo por link assinado: sem login, porque <video>/<audio>/Three.js não mandam o token.
        app.MapGet("/api/estudio/arquivos/{id}", async (string id, long exp, string? sig, AppDbContext db, EstudioArmazenamento arm, CancellationToken ct) =>
        {
            if (!arm.Valido(id, exp, sig)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var m = await db.EstudioMidias.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct);
            if (m is null) return Results.NotFound();
            var abs = arm.Absoluto(m.Arquivo);
            if (!File.Exists(abs)) return Results.NotFound();
            return Results.File(abs, m.ContentType, m.Nome, enableRangeProcessing: true);
        });

        var g = app.MapGroup("/api/estudio").RequireAuthorization();

        g.MapGet("/catalogo", (Catalogo catalogo) => Results.Ok(catalogo.Modelos.Select(m => new
        {
            m.Id, m.Nome, m.Familia, m.Tipo, m.Provedor, m.Descricao,
            Ops = m.Ops.ToDictionary(kv => kv.Key, kv => new
            {
                Entradas = kv.Value.Mapa.Keys.Where(k => Catalogo.ChavesDeMidia.Contains(k)).ToList(),
                Parametros = kv.Value.Mapa.Keys.Where(k => !Catalogo.ChavesDeMidia.Contains(k)).ToList(),
                kv.Value.Obrigatorios, kv.Value.Opcoes, kv.Value.Padroes, kv.Value.Limites, kv.Value.MaxImagens, kv.Value.Custo,
            }),
        })));

        MapConfig(g);
        MapMidias(g);
        MapGeracoes(g);
        MapQuadros(g);
    }

    // ---------- configuração ----------

    private static void MapConfig(RouteGroupBuilder g)
    {
        g.MapGet("/config", async (ClaimsPrincipal user, AppDbContext db, EstudioGeracoes ger, Ffmpeg ff, CancellationToken ct) =>
            Results.Ok(await Montar(user.UserId(), db, ger, ff, ct)));

        g.MapPut("/config", async (EstudioConfigRequest req, ClaimsPrincipal user, AppDbContext db, IProtetorDeSegredos protetor,
            EstudioGeracoes ger, Ffmpeg ff, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var c = await db.EstudioConfigs.FirstOrDefaultAsync(x => x.UserId == uid, ct);
            if (c is null) db.EstudioConfigs.Add(c = new EstudioConfig { UserId = uid });

            string? erro = null;
            void Chave(string? valor, Action<string?, string?> gravar, string nome)
            {
                if (valor is null) return;
                var v = valor.Trim();
                if (v.Length == 0) { gravar(null, null); return; }
                if (v.Length is < 8 or > 400) { erro = $"A chave {nome} não parece válida."; return; }
                gravar(protetor.Proteger(v), v[^4..]);
            }
            Chave(req.ChaveFal, (cif, suf) => { c.ChaveFalCifrada = cif; c.ChaveFalSufixo = suf; }, "do fal.ai");
            Chave(req.ChaveWorldLabs, (cif, suf) => { c.ChaveWorldLabsCifrada = cif; c.ChaveWorldLabsSufixo = suf; }, "da World Labs");
            if (erro is not null) return Results.BadRequest(new { erro });

            if (req.SemLimite == true) c.LimiteMensalCentavos = null;
            else if (req.LimiteMensalCentavos is { } lim)
            {
                if (lim is < 0 or > 10_000_000) return Results.BadRequest(new { erro = "Teto mensal fora do intervalo." });
                c.LimiteMensalCentavos = lim;
            }
            if (req.ConfirmarAcimaCentavos is { } conf) c.ConfirmarAcimaCentavos = Math.Clamp(conf, 0, 1_000_000);
            c.AtualizadoEm = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.Ok(await Montar(uid, db, ger, ff, ct));
        });
    }

    private static async Task<EstudioConfigResponse> Montar(string uid, AppDbContext db, EstudioGeracoes ger, Ffmpeg ff, CancellationToken ct)
    {
        var c = await db.EstudioConfigs.AsNoTracking().FirstOrDefaultAsync(x => x.UserId == uid, ct);
        var chaves = await ger.Chaves(uid, ct);
        var uso = await ger.Uso(uid, ct);
        return new EstudioConfigResponse(
            chaves.Fal is not null, c?.ChaveFalSufixo is { } fs ? "…" + fs : null, chaves.FalDoServidor,
            chaves.WorldLabs is not null, c?.ChaveWorldLabsSufixo is { } ws ? "…" + ws : null, chaves.WorldLabsDoServidor,
            uso.LimiteMensalCentavos, uso.ConfirmarAcimaCentavos, uso.GastoMesCentavos, uso.GeracoesNoMes, ff.Disponivel);
    }

    // ---------- biblioteca ----------

    private static void MapMidias(RouteGroupBuilder g)
    {
        g.MapGet("/midias", async (string? tipo, string? q, string? pasta, bool? favoritos, string? origem, int? limite, DateTime? antes,
            ClaimsPrincipal user, AppDbContext db, EstudioArmazenamento arm, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var query = db.EstudioMidias.AsNoTracking().Where(m => m.UserId == uid && m.DeletedAt == null);
            if (!string.IsNullOrWhiteSpace(tipo))
            {
                var tipos = tipo.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                query = query.Where(m => tipos.Contains(m.Tipo));
            }
            if (!string.IsNullOrWhiteSpace(pasta)) query = query.Where(m => m.Pasta == pasta);
            if (!string.IsNullOrWhiteSpace(origem)) query = query.Where(m => m.Origem == origem);
            if (favoritos == true) query = query.Where(m => m.Favorito);
            if (antes is { } a) query = query.Where(m => m.CriadoEm < a);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var termo = q.Trim().ToLower();
                query = query.Where(m => m.Nome.ToLower().Contains(termo) || (m.Prompt != null && m.Prompt.ToLower().Contains(termo)));
            }
            var itens = await query.OrderByDescending(m => m.CriadoEm).Take(Math.Clamp(limite ?? 60, 1, 300)).ToListAsync(ct);
            return Results.Ok(itens.Select(m => Dto(m, arm)));
        });

        g.MapGet("/midias/pastas", async (ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var uid = user.UserId();
            return Results.Ok(await db.EstudioMidias.AsNoTracking().Where(m => m.UserId == uid && m.DeletedAt == null && m.Pasta != null)
                .Select(m => m.Pasta!).Distinct().OrderBy(p => p).ToListAsync(ct));
        });

        g.MapGet("/midias/{id}", async (string id, ClaimsPrincipal user, AppDbContext db, EstudioArmazenamento arm, CancellationToken ct) =>
        {
            var m = await Achar(db, user.UserId(), id, ct);
            return m is null ? Results.NotFound() : Results.Ok(Dto(m, arm));
        });

        // Upload: multipart (arquivos) ou JSON (data URL / endereço https).
        g.MapPost("/midias", async (HttpRequest http, ClaimsPrincipal user, EstudioMidias midias, EstudioArmazenamento arm, CancellationToken ct) =>
        {
            var uid = user.UserId();
            try
            {
                if (http.HasFormContentType)
                {
                    var form = await http.ReadFormAsync(ct);
                    var pasta = Pasta(form["pasta"].FirstOrDefault());
                    var origem = Origem(form["origem"].FirstOrDefault());
                    var criadas = new List<MidiaDto>();
                    foreach (var arquivo in form.Files.Take(50))
                    {
                        await using var s = arquivo.OpenReadStream();
                        var m = await midias.Importar(uid, s, arquivo.ContentType, arquivo.FileName, origem, x => x.Pasta = pasta, ct);
                        criadas.Add(Dto(m, arm));
                    }
                    return criadas.Count == 0 ? Results.BadRequest(new { erro = "Nenhum arquivo enviado." }) : Results.Ok(criadas);
                }

                var req = await http.ReadFromJsonAsync<MidiaImportarRequest>(ct) ?? throw new ErroDoEstudio("Corpo vazio.");
                EstudioMidia nova;
                if (!string.IsNullOrEmpty(req.DataUrl))
                {
                    var (bytes, tipo) = DataUrl(req.DataUrl);
                    using var ms = new MemoryStream(bytes);
                    var nome = string.IsNullOrWhiteSpace(req.Nome) ? "arquivo" + EstudioMidias.ExtensaoDe(tipo, null) : req.Nome!;
                    if (Path.GetExtension(nome).Length == 0) nome += EstudioMidias.ExtensaoDe(tipo, null);
                    nova = await midias.Importar(uid, ms, tipo, nome, Origem(req.Origem), x => x.Pasta = Pasta(req.Pasta), ct);
                }
                else if (!string.IsNullOrEmpty(req.Url))
                {
                    nova = await midias.ImportarDeUrl(uid, req.Url, req.Nome, Origem(req.Origem), x => x.Pasta = Pasta(req.Pasta), ct);
                }
                else throw new ErroDoEstudio("Mande o arquivo, uma data URL ou um endereço https.");
                return Results.Ok(new[] { Dto(nova, arm) });
            }
            catch (Exception e) when (e is ErroDoEstudio or ErroDoProvedor or FormatException)
            {
                return Results.BadRequest(new { erro = e.Message });
            }
        }).DisableAntiforgery()
          .WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(UploadMax))
          .WithFormOptions(multipartBodyLengthLimit: UploadMax);

        // Substitui o conteúdo (Salvar de um craft app sobre o mesmo documento).
        g.MapPut("/midias/{id}/arquivo", async (string id, HttpRequest http, ClaimsPrincipal user, AppDbContext db,
            EstudioMidias midias, EstudioArmazenamento arm, CancellationToken ct) =>
        {
            var m = await Achar(db, user.UserId(), id, ct);
            if (m is null) return Results.NotFound();
            try
            {
                var tamanho = await arm.Gravar(m.Arquivo, http.Body, 500L * 1024 * 1024, ct);
                m.Tamanho = tamanho;
                m.Thumb = null;
                m.FalUrl = null;
                await midias.Medir(m, ct);
                await db.SaveChangesAsync(ct);
                return Results.Ok(Dto(m, arm));
            }
            catch (ErroDoEstudio e) { return Results.BadRequest(new { erro = e.Message }); }
        }).WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(UploadMax));

        g.MapPatch("/midias/{id}", async (string id, MidiaAtualizarRequest req, ClaimsPrincipal user, AppDbContext db, EstudioArmazenamento arm, CancellationToken ct) =>
        {
            var m = await Achar(db, user.UserId(), id, ct);
            if (m is null) return Results.NotFound();
            if (req.Nome is { } nome && nome.Trim().Length > 0) m.Nome = nome.Trim()[..Math.Min(nome.Trim().Length, 200)];
            if (req.Pasta is not null) m.Pasta = Pasta(req.Pasta);
            if (req.Favorito is { } f) m.Favorito = f;
            if (req.Thumb is { } t && t.StartsWith("data:image/") && t.Length < 400_000) m.Thumb = t;
            await db.SaveChangesAsync(ct);
            return Results.Ok(Dto(m, arm));
        });

        g.MapDelete("/midias/{id}", async (string id, ClaimsPrincipal user, AppDbContext db, EstudioMidias midias, CancellationToken ct) =>
        {
            var m = await Achar(db, user.UserId(), id, ct);
            if (m is null) return Results.NotFound();
            m.DeletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            midias.ApagarArquivo(m);
            return Results.NoContent();
        });

        // Manda uma imagem para a biblioteca do Editor (Print & Cut, Moldes, Redes sociais, Ilustração).
        g.MapPost("/midias/{id}/editor", async (string id, ClaimsPrincipal user, AppDbContext db, EstudioArmazenamento arm, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var m = await Achar(db, uid, id, ct);
            if (m is null) return Results.NotFound();
            if (m.Tipo != "imagem") return Results.BadRequest(new { erro = "Só imagens vão para o Editor." });
            if (m.Tamanho > 9 * 1024 * 1024) return Results.BadRequest(new { erro = "Imagem grande demais para o Editor (máximo 9 MB)." });
            var dados = $"data:{m.ContentType};base64,{Convert.ToBase64String(await File.ReadAllBytesAsync(arm.Absoluto(m.Arquivo), ct))}";
            var item = new ImageLibraryItem
            {
                Id = Guid.NewGuid().ToString(),
                UserId = uid,
                Name = Path.GetFileNameWithoutExtension(m.Nome)[..Math.Min(Path.GetFileNameWithoutExtension(m.Nome).Length, 200)],
                Origin = "estudio",
                Data = dados,
                Thumb = m.Thumb ?? dados,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };
            db.ImageLibrary.Add(item);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { item.Id });
        });
    }

    // ---------- gerações ----------

    private static void MapGeracoes(RouteGroupBuilder g)
    {
        g.MapPost("/estimar", async (GeracaoRequest req, ClaimsPrincipal user, EstudioGeracoes ger, CancellationToken ct) =>
        {
            try
            {
                var uid = user.UserId();
                var custo = await ger.Estimar(uid, Pedido(req), ct);
                var uso = await ger.Uso(uid, ct);
                return Results.Ok(new EstimativaResponse(custo, uso.GastoMesCentavos, uso.LimiteMensalCentavos,
                    uso.LimiteMensalCentavos is { } l && uso.GastoMesCentavos + custo > l));
            }
            catch (ErroDoEstudio e) { return Results.BadRequest(new { erro = e.Message }); }
        });

        g.MapPost("/geracoes", async (GeracaoRequest req, ClaimsPrincipal user, EstudioGeracoes ger, AppDbContext db,
            Catalogo catalogo, EstudioArmazenamento arm, CancellationToken ct) =>
        {
            try
            {
                var job = await ger.Criar(user.UserId(), Pedido(req), ct);
                return Results.Ok(await JobDto(job, db, catalogo, arm, ct));
            }
            catch (ErroDoEstudio e) { return Results.BadRequest(new { erro = e.Message }); }
        }).RequireRateLimiting("estudio-ia");

        g.MapPost("/local", async (LocalRequest req, ClaimsPrincipal user, EstudioGeracoes ger, AppDbContext db,
            Catalogo catalogo, EstudioArmazenamento arm, Ffmpeg ff, CancellationToken ct) =>
        {
            if (!ff.Disponivel) return Results.BadRequest(new { erro = "O ffmpeg não está instalado neste servidor." });
            try
            {
                var job = await ger.CriarLocal(user.UserId(), req.App ?? req.Operacao, req.Operacao, req.Parametros ?? [], req.Entradas ?? [], ct);
                return Results.Ok(await JobDto(job, db, catalogo, arm, ct));
            }
            catch (ErroDoEstudio e) { return Results.BadRequest(new { erro = e.Message }); }
        });

        g.MapGet("/geracoes", async (string? app, string? status, bool? ativos, int? limite, DateTime? antes,
            ClaimsPrincipal user, AppDbContext db, Catalogo catalogo, EstudioArmazenamento arm, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var q = db.EstudioJobs.AsNoTracking().Where(j => j.UserId == uid && !j.Oculto);
            if (!string.IsNullOrWhiteSpace(app)) q = q.Where(j => j.App == app);
            if (!string.IsNullOrWhiteSpace(status)) q = q.Where(j => j.Status == status);
            if (ativos == true) q = q.Where(j => j.Status == "fila" || j.Status == "rodando");
            if (antes is { } a) q = q.Where(j => j.CriadoEm < a);
            var jobs = await q.OrderByDescending(j => j.CriadoEm).Take(Math.Clamp(limite ?? 30, 1, 100)).ToListAsync(ct);
            return Results.Ok(await JobDtos(jobs, db, catalogo, arm, ct));
        });

        g.MapGet("/geracoes/{id}", async (string id, ClaimsPrincipal user, AppDbContext db, Catalogo catalogo, EstudioArmazenamento arm, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var job = await db.EstudioJobs.AsNoTracking().FirstOrDefaultAsync(j => j.Id == id && j.UserId == uid, ct);
            return job is null ? Results.NotFound() : Results.Ok(await JobDto(job, db, catalogo, arm, ct));
        });

        g.MapPost("/geracoes/{id}/cancelar", async (string id, ClaimsPrincipal user, AppDbContext db, EstudioProcessador proc,
            Catalogo catalogo, EstudioArmazenamento arm, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var job = await db.EstudioJobs.FirstOrDefaultAsync(j => j.Id == id && j.UserId == uid, ct);
            if (job is null) return Results.NotFound();
            await proc.Cancelar(job, ct);
            return Results.Ok(await JobDto(job, db, catalogo, arm, ct));
        });

        g.MapDelete("/geracoes/{id}", async (string id, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var job = await db.EstudioJobs.FirstOrDefaultAsync(j => j.Id == id && j.UserId == uid, ct);
            if (job is null) return Results.NotFound();
            job.Oculto = true;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }

    // ---------- documentos das ferramentas ----------

    private static void MapQuadros(RouteGroupBuilder g)
    {
        g.MapGet("/quadros", async (string? tipo, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var q = db.EstudioQuadros.AsNoTracking().Where(x => x.UserId == uid && x.DeletedAt == null);
            if (!string.IsNullOrWhiteSpace(tipo)) q = q.Where(x => x.Tipo == tipo);
            return Results.Ok(await q.OrderByDescending(x => x.UpdatedAt)
                .Select(x => new QuadroResumoDto(x.Id, x.Tipo, x.Nome, x.Thumb, x.CreatedAt, x.UpdatedAt)).ToListAsync(ct));
        });

        g.MapGet("/quadros/{id}", async (string id, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var x = await db.EstudioQuadros.AsNoTracking().FirstOrDefaultAsync(q => q.Id == id && q.UserId == uid && q.DeletedAt == null, ct);
            return x is null ? Results.NotFound() : Results.Ok(new QuadroDto(x.Id, x.Tipo, x.Nome, x.Data, x.Thumb, x.CreatedAt, x.UpdatedAt));
        });

        g.MapPut("/quadros/{id}", async (string id, QuadroUpsertRequest req, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            if (!TiposDeQuadro.Contains(req.Tipo)) return Results.BadRequest(new { erro = "Tipo inválido." });
            if (id.Length is 0 or > 64) return Results.BadRequest(new { erro = "Id inválido." });
            if (req.Data.Length > 8_000_000) return Results.BadRequest(new { erro = "Documento grande demais." });
            try { JsonDocument.Parse(req.Data).Dispose(); }
            catch (JsonException) { return Results.BadRequest(new { erro = "O conteúdo não é JSON." }); }
            var uid = user.UserId();
            var x = await db.EstudioQuadros.FirstOrDefaultAsync(q => q.Id == id, ct);
            if (x is not null && x.UserId != uid) return Results.NotFound();
            if (x is null) db.EstudioQuadros.Add(x = new EstudioQuadro { Id = id, UserId = uid, CreatedAt = DateTime.UtcNow });
            x.Tipo = req.Tipo;
            x.Nome = string.IsNullOrWhiteSpace(req.Nome) ? "Sem nome" : req.Nome.Trim()[..Math.Min(req.Nome.Trim().Length, 300)];
            x.Data = req.Data;
            x.Thumb = req.Thumb is { Length: < 400_000 } t && t.StartsWith("data:image/") ? t : x.Thumb;
            x.UpdatedAt = DateTime.UtcNow;
            x.DeletedAt = null;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new QuadroDto(x.Id, x.Tipo, x.Nome, x.Data, x.Thumb, x.CreatedAt, x.UpdatedAt));
        });

        g.MapDelete("/quadros/{id}", async (string id, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var x = await db.EstudioQuadros.FirstOrDefaultAsync(q => q.Id == id && q.UserId == uid && q.DeletedAt == null, ct);
            if (x is null) return Results.NotFound();
            x.DeletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }

    // ---------- apoio ----------

    public static MidiaDto Dto(EstudioMidia m, EstudioArmazenamento arm) => new(
        m.Id, m.Tipo, m.Nome, m.ContentType, arm.Link(m.Id), m.Thumb, m.Tamanho, m.Largura, m.Altura, m.DuracaoSeg,
        m.Origem, m.JobId, m.ModeloId, m.Prompt, m.Pasta, m.Favorito, m.CriadoEm);

    public static async Task<JobDto> JobDto(EstudioJob j, AppDbContext db, Catalogo catalogo, EstudioArmazenamento arm, CancellationToken ct) =>
        (await JobDtos([j], db, catalogo, arm, ct))[0];

    public static async Task<List<JobDto>> JobDtos(List<EstudioJob> jobs, AppDbContext db, Catalogo catalogo, EstudioArmazenamento arm, CancellationToken ct)
    {
        var resultados = jobs.ToDictionary(j => j.Id, j => JsonSerializer.Deserialize<List<string>>(j.Resultado) ?? []);
        var ids = resultados.Values.SelectMany(v => v).Distinct().ToList();
        var midias = ids.Count == 0 ? [] : await db.EstudioMidias.AsNoTracking()
            .Where(m => ids.Contains(m.Id) && m.DeletedAt == null).ToDictionaryAsync(m => m.Id, ct);
        return jobs.Select(j => new JobDto(
            j.Id, j.App, j.ModeloId, catalogo.Modelo(j.ModeloId)?.Nome ?? (j.ModeloId == "ffmpeg" ? "ffmpeg" : null), j.Operacao, j.Provedor, j.Status,
            j.Mensagem, j.Erro, j.PosicaoFila, j.CustoEstimadoCentavos, j.LinkExterno,
            JsonNode.Parse(j.Parametros)?.AsObject() ?? [],
            JsonSerializer.Deserialize<Dictionary<string, List<string>>>(j.Entradas) ?? [],
            resultados[j.Id].Where(midias.ContainsKey).Select(id => Dto(midias[id], arm)).ToList(),
            j.CriadoEm, j.ConcluidoEm)).ToList();
    }

    private static PedidoGeracao Pedido(GeracaoRequest r) => new(r.Modelo ?? "", r.Operacao ?? "", r.Parametros, r.Entradas, r.App, r.Pipeline);

    private static Task<EstudioMidia?> Achar(AppDbContext db, string uid, string id, CancellationToken ct) =>
        db.EstudioMidias.FirstOrDefaultAsync(m => m.Id == id && m.UserId == uid && m.DeletedAt == null, ct);

    private static string? Pasta(string? p) => string.IsNullOrWhiteSpace(p) ? null : p.Trim()[..Math.Min(p.Trim().Length, 120)];

    private static string Origem(string? o) => o?.Trim().ToLowerInvariant() switch
    {
        null or "" => "upload",
        var x when x.Length <= 20 && x.All(char.IsAsciiLetterOrDigit) => x,
        _ => "upload",
    };

    private static (byte[] Bytes, string Tipo) DataUrl(string dataUrl)
    {
        var virgula = dataUrl.IndexOf(',');
        if (!dataUrl.StartsWith("data:") || virgula < 0 || !dataUrl[..virgula].EndsWith(";base64"))
            throw new ErroDoEstudio("Data URL inválida.");
        var tipo = dataUrl[5..dataUrl.IndexOf(';')];
        return (Convert.FromBase64String(dataUrl[(virgula + 1)..]), tipo);
    }
}
