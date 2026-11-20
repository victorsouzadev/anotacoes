using Notas.Api.Data;
using Notas.Api.Services.Plugins;

namespace Notas.Api.Endpoints;

public static class PluginsEndpoints
{
    /// <summary><c>GET /api/plugins</c> (spec 029): módulos do núcleo e plug-ins, com o estado do último health.</summary>
    public static void MapPluginsEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/plugins", async (AppDbContext db, CancellationToken ct) =>
            Results.Ok(await RegistroDePlugins.Listar(db, Environment.GetEnvironmentVariable("App__Versao") ?? "desconhecida", ct)))
            .RequireAuthorization();
    }
}
