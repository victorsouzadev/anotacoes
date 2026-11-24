using Hub.Plugin;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Notas.Api.Data;
using Notas.Api.Services.Painel;
using Notas.Api.Services.Sites;

namespace Notas.Api.Endpoints;

/// <summary>
/// Painel de plug-ins (spec 040, contracts/painel-api.md): sessão do hub e administrador. O token de MCP (outra audiência)
/// e o segredo de serviço dos plug-ins não passam pela autenticação, então a IA fica de fora (FR-013).
/// </summary>
public static class PainelPluginsEndpoints
{
    public static void MapPainelPluginsEndpoints(this IEndpointRouteBuilder app)
    {
        var raiz = app.MapGroup("/api/painel/plugins").RequireAuthorization();

        // Única rota aberta a toda conta com login: diz se o card aparece no hub.
        raiz.MapGet("/permissao", async (HttpContext http, AppDbContext db, IOptions<PainelOptions> o) =>
            Results.Ok(new { administrador = await Administra(http, db, o.Value) }));

        var g = raiz.MapGroup("").AddEndpointFilter(async (ctx, proximo) =>
        {
            var http = ctx.HttpContext;
            var db = http.RequestServices.GetRequiredService<AppDbContext>();
            var o = http.RequestServices.GetRequiredService<IOptions<PainelOptions>>().Value;
            return await Administra(http, db, o) ? await proximo(ctx) : Results.StatusCode(StatusCodes.Status403Forbidden);
        });

        g.MapGet("/", async (ListaDoPainel lista, CancellationToken ct) => Results.Ok(await lista.Listar(ct)));

        g.MapGet("/{id}/versoes", async (string id, ListaDoPainel lista, CancellationToken ct) =>
        {
            if (!RegrasDoManifesto.IdPermitido(id)) return Results.NotFound();
            try { return await lista.Versoes(id, ct) is { } v ? Results.Ok(v) : Results.NotFound(); }
            catch (Exception e) when (e is GithubException or DeployerException) { return Results.Json(new { falta = e.Message }, statusCode: 503); }
        });
    }

    private static async Task<bool> Administra(HttpContext http, AppDbContext db, PainelOptions o)
    {
        var id = http.User.UserId();
        // O e-mail vem do banco, não do token.
        var email = await db.Users.AsNoTracking().Where(u => u.Id == id).Select(u => u.Email).FirstOrDefaultAsync(http.RequestAborted);
        return o.Administra(email);
    }
}
