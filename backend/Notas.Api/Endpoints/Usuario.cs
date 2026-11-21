using System.Security.Claims;

namespace Notas.Api.Endpoints;

public static class UsuarioDoToken
{
    /// <summary>Id do usuário logado (sub do JWT do núcleo).</summary>
    public static string UserId(this ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? user.FindFirstValue("sub")
        ?? throw new InvalidOperationException("Token sem sub");
}
