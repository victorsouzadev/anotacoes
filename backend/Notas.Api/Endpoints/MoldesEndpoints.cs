using System.Security.Claims;
using Notas.Api.Dtos;
using Notas.Api.Services.Moldes;

namespace Notas.Api.Endpoints;

/// <summary>
/// Gerador de Moldes. O gerador roda inteiro no navegador; o servidor só entra
/// quando precisa da IA (a chave mora aqui): reconhecer a embalagem de uma foto
/// e devolver o tipo de molde com as medidas estimadas.
/// </summary>
public static class MoldesEndpoints
{
    // Uma foto de celular reduzida pela tela (~1600 px em JPEG) fica bem abaixo disso.
    private const int MaxImagemBytes = 6 * 1024 * 1024;

    public static void MapMoldesEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/moldes/analisar", async (
            AnalisarEmbalagemRequest req, ClaimsPrincipal user, IAnalisadorDeEmbalagem analisador, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(req.Imagem) || !req.Imagem.StartsWith("data:image/", StringComparison.Ordinal))
            {
                return Results.BadRequest(new { erro = "Envie a foto como data URL de imagem." });
            }
            if (req.Imagem.Length > MaxImagemBytes)
            {
                return Results.BadRequest(new { erro = "Foto grande demais; reduza antes de enviar." });
            }
            var tipos = req.Tipos ?? new List<TipoMoldeDto>();
            if (tipos.Count == 0) return Results.BadRequest(new { erro = "Envie o catálogo de moldes." });
            if (tipos.Count > AnalisadorDeEmbalagem.MaxTipos)
            {
                return Results.BadRequest(new { erro = $"No máximo {AnalisadorDeEmbalagem.MaxTipos} tipos de molde." });
            }

            var r = await analisador.AnalisarAsync(user.UserId(), req.Imagem, tipos, req.MedidaConhecida, ct);
            return Results.Ok(r);
        }).RequireAuthorization();
    }
}
