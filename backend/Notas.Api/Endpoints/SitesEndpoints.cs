using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Notas.Api.Data;
using Notas.Api.Dtos;
using Notas.Api.Services.Seguranca;
using Notas.Api.Services.Sites;

namespace Notas.Api.Endpoints;

/// <summary>
/// Ferramenta "Publicar": envia um ZIP (front estático e/ou API C# publicada) e ganha uma
/// URL própria. Só quem está em Sites:Publicadores usa. Ver docs/poc-multi-app/DISCOVERY.md.
/// </summary>
public static partial class SitesEndpoints
{
    // Operações que esperam o container (reiniciar, parar, excluir) podem incluir o
    // download da imagem aspnet na primeira vez.
    private static readonly TimeSpan EsperaMaxima = TimeSpan.FromMinutes(5);

    // Variáveis que a plataforma define e o usuário não pode sobrescrever.
    private static readonly HashSet<string> VariaveisReservadas = new(StringComparer.OrdinalIgnoreCase)
    {
        "ASPNETCORE_URLS", "ASPNETCORE_HTTP_PORTS", "HOME", "PATH", "DOTNET_gcServer", "DOTNET_RUNNING_IN_CONTAINER",
    };

    [GeneratedRegex("^[A-Za-z_][A-Za-z0-9_]{0,127}$")]
    private static partial Regex ChaveValida();

    public static void MapSitesEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/sites/permissao", async (ClaimsPrincipal user, AppDbContext db, IOptions<SitesOptions> opt) =>
            Results.Ok(new { podePublicar = await PodePublicar(user, db, opt.Value), urlModelo = opt.Value.Url("{slug}") }))
            .RequireAuthorization();

        var group = app.MapGroup("/api/sites").RequireAuthorization()
            .AddEndpointFilter(async (ctx, next) =>
            {
                var http = ctx.HttpContext;
                var db = http.RequestServices.GetRequiredService<AppDbContext>();
                var opt = http.RequestServices.GetRequiredService<IOptions<SitesOptions>>().Value;
                if (!await PodePublicar(http.User, db, opt))
                    return Results.Json(new { error = "Sua conta não pode publicar sites." }, statusCode: 403);
                return await next(ctx);
            });

        group.MapGet("/", async (ClaimsPrincipal user, AppDbContext db, IOptions<SitesOptions> opt) =>
        {
            var sites = await db.Sites.AsNoTracking()
                .Where(s => s.OwnerUserId == user.UserId())
                .OrderBy(s => s.Nome)
                .ToListAsync();
            var ids = sites.Select(s => s.Id).ToList();
            var deps = await db.Deployments.AsNoTracking().Where(d => ids.Contains(d.SiteId)).ToListAsync();
            return Results.Ok(sites.Select(s =>
            {
                var doSite = deps.Where(d => d.SiteId == s.Id).OrderByDescending(d => d.Versao).ToList();
                var atual = doSite.FirstOrDefault(d => d.Id == s.CurrentDeploymentId);
                var ultimo = doSite.FirstOrDefault();
                return new SiteDto(s.Id, s.Slug, s.Nome, opt.Value.Url(s.Slug), s.Parado, s.CriadoEm,
                    atual is null ? null : ToDto(atual, comLog: false),
                    ultimo is null ? null : ToDto(ultimo, comLog: false));
            }));
        });

        group.MapPost("/", async (CriarSiteRequest req, ClaimsPrincipal user, AppDbContext db, IOptions<SitesOptions> opt) =>
        {
            var slug = req.Slug?.Trim().ToLowerInvariant() ?? "";
            var nome = req.Nome?.Trim() ?? "";
            if (SlugRegras.Validar(slug) is { } erro)
                return Results.BadRequest(new { error = erro });
            if (nome.Length is 0 or > 100)
                return Results.BadRequest(new { error = "Dê um nome de até 100 caracteres." });
            if (await db.Sites.AnyAsync(s => s.Slug == slug))
                return Results.Conflict(new { error = "Esse endereço já está em uso." });

            var site = new Site { OwnerUserId = user.UserId(), Slug = slug, Nome = nome };
            db.Sites.Add(site);
            await db.SaveChangesAsync();
            return Results.Created($"/api/sites/{site.Id}", await Detalhe(site, db, opt.Value));
        });

        group.MapGet("/{id}", async (string id, ClaimsPrincipal user, AppDbContext db, IOptions<SitesOptions> opt) =>
            await DoUsuario(id, user, db) is { } site ? Results.Ok(await Detalhe(site, db, opt.Value)) : Results.NotFound());

        // Corpo = o ZIP cru (Content-Type application/zip), sem multipart: o front manda o Blob direto.
        group.MapPost("/{id}/deployments", async (string id, HttpContext http, ClaimsPrincipal user, AppDbContext db,
            SitesArmazenamento disco, FilaSites fila, IOptions<SitesOptions> opt, CancellationToken ct) =>
        {
            var site = await DoUsuario(id, user, db);
            if (site is null) return Results.NotFound();
            var limites = opt.Value;

            // O teto global do Kestrel é 10 MB; este endpoint aceita o ZIP inteiro.
            if (http.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } tamanho)
                tamanho.MaxRequestBodySize = limites.MaxZipBytes;
            if (http.Request.ContentLength > limites.MaxZipBytes)
                return Results.Json(new { error = $"O ZIP passa do limite de {limites.MaxZipBytes / (1024 * 1024)} MB." }, statusCode: 413);

            var versao = (await db.Deployments.Where(d => d.SiteId == site.Id).MaxAsync(d => (int?)d.Versao, ct) ?? 0) + 1;
            var dep = new Deployment { SiteId = site.Id, Versao = versao };
            var pasta = disco.PastaDeploy(site.Slug, dep.Id);
            var temporario = Path.Combine(Path.GetTempPath(), $"site-{dep.Id}.zip");
            try
            {
                long recebido;
                await using (var arquivo = new FileStream(temporario, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 81920, FileOptions.DeleteOnClose))
                {
                    recebido = await CopiarComLimite(http.Request.Body, arquivo, limites.MaxZipBytes, ct);
                    if (recebido == 0) return Results.BadRequest(new { error = "Envie o ZIP no corpo da requisição." });
                    arquivo.Position = 0;
                    var info = PacoteExtrator.Extrair(arquivo, pasta, limites);
                    dep.Tipo = info.TemApi ? DeploymentTipo.DotNet : DeploymentTipo.Estatico;
                    dep.TemWeb = info.TemWeb;
                    dep.Entrada = info.Entrada;
                    dep.RuntimeVersao = info.RuntimeVersao;
                    dep.Health = info.Health;
                    dep.MemoriaMb = info.TemApi ? info.MemoriaMb ?? limites.MemoriaPadraoMb : 0;
                    dep.TamanhoBytes = info.TamanhoDescompactado;
                }
                dep.Log = $"[{DateTime.UtcNow:HH:mm:ss}] Recebido: {recebido / 1024} KB compactado, " +
                    $"{dep.TamanhoBytes / 1024} KB extraído ({Descrever(dep)}).";
            }
            catch (PacoteInvalidoException e)
            {
                if (Directory.Exists(pasta)) Directory.Delete(pasta, recursive: true);
                return Results.BadRequest(new { error = e.Message });
            }
            catch (LimiteExcedidoException)
            {
                if (Directory.Exists(pasta)) Directory.Delete(pasta, recursive: true);
                return Results.Json(new { error = $"O ZIP passa do limite de {limites.MaxZipBytes / (1024 * 1024)} MB." }, statusCode: 413);
            }

            db.Deployments.Add(dep);
            await db.SaveChangesAsync(ct);
            fila.Enfileirar(new TarefaSite(AcaoSite.Publicar, site.Id, dep.Id));
            return Results.Accepted($"/api/sites/{site.Id}", ToDto(dep, comLog: true));
        });

        group.MapPost("/{id}/deployments/{depId}/ativar", async (string id, string depId, AtivarVersaoRequest? req,
            ClaimsPrincipal user, AppDbContext db, FilaSites fila) =>
        {
            var site = await DoUsuario(id, user, db);
            if (site is null) return Results.NotFound();
            var dep = await db.Deployments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == depId && d.SiteId == site.Id);
            if (dep is null) return Results.NotFound();
            if (dep.Status is DeploymentStatus.Enviado or DeploymentStatus.Iniciando)
                return Results.Conflict(new { error = "Essa versão ainda está sendo publicada." });
            fila.Enfileirar(new TarefaSite(AcaoSite.Publicar, site.Id, dep.Id, req?.RestaurarBanco ?? false));
            return Results.Accepted($"/api/sites/{site.Id}");
        });

        group.MapGet("/{id}/logs", async (string id, int? linhas, ClaimsPrincipal user, AppDbContext db, IDeployer deployer, CancellationToken ct) =>
        {
            var site = await DoUsuario(id, user, db);
            if (site is null) return Results.NotFound();
            try
            {
                var texto = await deployer.LogsAsync(site.Slug, Math.Clamp(linhas ?? 200, 1, 2000), ct);
                return Results.Text(texto, "text/plain; charset=utf-8");
            }
            catch (DeployerException e)
            {
                return Results.Json(new { error = e.Message }, statusCode: 502);
            }
        });

        group.MapGet("/{id}/variaveis", async (string id, ClaimsPrincipal user, AppDbContext db, IProtetorDeSegredos protetor) =>
        {
            var site = await DoUsuario(id, user, db);
            if (site is null) return Results.NotFound();
            var vars = await db.SiteVariaveis.AsNoTracking().Where(v => v.SiteId == site.Id).OrderBy(v => v.Chave).ToListAsync();
            return Results.Ok(vars.Select(v => new VariavelDto(v.Chave, protetor.Desproteger(v.ValorCifrado) ?? "")));
        });

        group.MapPut("/{id}/variaveis", async (string id, List<VariavelDto> req, ClaimsPrincipal user, AppDbContext db,
            IProtetorDeSegredos protetor, FilaSites fila) =>
        {
            var site = await DoUsuario(id, user, db);
            if (site is null) return Results.NotFound();
            if (req.Count > 100) return Results.BadRequest(new { error = "No máximo 100 variáveis." });
            var chaves = new HashSet<string>(StringComparer.Ordinal);
            foreach (var v in req)
            {
                if (!ChaveValida().IsMatch(v.Chave ?? ""))
                    return Results.BadRequest(new { error = $"Nome de variável inválido: \"{v.Chave}\". Use letras, números e _ (ex.: Email__Senha)." });
                if (VariaveisReservadas.Contains(v.Chave!) || v.Chave!.StartsWith("DOTNET_", StringComparison.OrdinalIgnoreCase))
                    return Results.BadRequest(new { error = $"A variável {v.Chave} é definida pela plataforma." });
                if ((v.Valor ?? "").Length > 8192 || (v.Valor ?? "").Contains('\0'))
                    return Results.BadRequest(new { error = $"Valor inválido em {v.Chave}." });
                if (!chaves.Add(v.Chave))
                    return Results.BadRequest(new { error = $"Variável repetida: {v.Chave}." });
            }

            await db.SiteVariaveis.Where(v => v.SiteId == site.Id).ExecuteDeleteAsync();
            db.SiteVariaveis.AddRange(req.Select(v => new SiteVariavel
            {
                SiteId = site.Id,
                Chave = v.Chave,
                ValorCifrado = protetor.Proteger(v.Valor ?? ""),
            }));
            await db.SaveChangesAsync();

            // Variável nova só vale num container novo.
            var atual = site.CurrentDeploymentId is null ? null
                : await db.Deployments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == site.CurrentDeploymentId);
            if (atual is { Tipo: DeploymentTipo.DotNet } && !site.Parado)
            {
                var erro = await Esperar(fila.Enfileirar(new TarefaSite(AcaoSite.Reiniciar, site.Id)));
                if (erro is not null) return Results.Json(new { error = "Variáveis salvas, mas o app não subiu: " + erro }, statusCode: 502);
            }
            return Results.NoContent();
        });

        group.MapPost("/{id}/reiniciar", (string id, ClaimsPrincipal user, AppDbContext db, FilaSites fila) =>
            Operar(id, AcaoSite.Reiniciar, user, db, fila));

        group.MapPost("/{id}/parar", (string id, ClaimsPrincipal user, AppDbContext db, FilaSites fila) =>
            Operar(id, AcaoSite.Parar, user, db, fila));

        group.MapDelete("/{id}", (string id, ClaimsPrincipal user, AppDbContext db, FilaSites fila) =>
            Operar(id, AcaoSite.Excluir, user, db, fila));
    }

    private static async Task<IResult> Operar(string id, AcaoSite acao, ClaimsPrincipal user, AppDbContext db, FilaSites fila)
    {
        var site = await DoUsuario(id, user, db);
        if (site is null) return Results.NotFound();
        var erro = await Esperar(fila.Enfileirar(new TarefaSite(acao, site.Id)));
        return erro is null ? Results.NoContent() : Results.Json(new { error = erro }, statusCode: 502);
    }

    private static async Task<string?> Esperar(TarefaSite tarefa)
    {
        try { return await tarefa.Conclusao.Task.WaitAsync(EsperaMaxima); }
        catch (TimeoutException) { return "A operação ainda está em andamento; confira em instantes."; }
    }

    private static async Task<bool> PodePublicar(ClaimsPrincipal user, AppDbContext db, SitesOptions opt)
    {
        if (string.IsNullOrWhiteSpace(opt.Publicadores)) return false;
        var id = user.UserId();
        var email = await db.Users.AsNoTracking().Where(u => u.Id == id).Select(u => u.Email).FirstOrDefaultAsync();
        return opt.PodePublicar(email);
    }

    private static Task<Site?> DoUsuario(string id, ClaimsPrincipal user, AppDbContext db) =>
        db.Sites.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id && s.OwnerUserId == user.UserId());

    private static async Task<SiteDetalheDto> Detalhe(Site site, AppDbContext db, SitesOptions opt)
    {
        var versoes = await db.Deployments.AsNoTracking()
            .Where(d => d.SiteId == site.Id)
            .OrderByDescending(d => d.Versao)
            .ToListAsync();
        return new SiteDetalheDto(site.Id, site.Slug, site.Nome, opt.Url(site.Slug), site.Parado, site.CriadoEm,
            site.CurrentDeploymentId, versoes.Select(d => ToDto(d, comLog: true)).ToList());
    }

    private static DeploymentDto ToDto(Deployment d, bool comLog) => new(
        d.Id, d.Versao, d.Tipo.ToString(), d.Status.ToString(), d.TemWeb, d.RuntimeVersao, d.Entrada,
        d.TamanhoBytes, d.TemBackupBanco, d.CriadoEm, d.TerminadoEm, comLog ? d.Log : "");

    private static string Descrever(Deployment d) => d.Tipo == DeploymentTipo.Estatico
        ? "site estático"
        : $"API .NET {d.RuntimeVersao} ({d.Entrada})" + (d.TemWeb ? " + front" : "");

    private sealed class LimiteExcedidoException : Exception;

    private static async Task<long> CopiarComLimite(Stream origem, Stream destino, long limite, CancellationToken ct)
    {
        var buffer = new byte[81920];
        long total = 0;
        int lidos;
        while ((lidos = await origem.ReadAsync(buffer, ct)) > 0)
        {
            total += lidos;
            if (total > limite) throw new LimiteExcedidoException();
            await destino.WriteAsync(buffer.AsMemory(0, lidos), ct);
        }
        return total;
    }
}
