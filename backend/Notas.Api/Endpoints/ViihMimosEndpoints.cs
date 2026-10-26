using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Notas.Api.Data;

namespace Notas.Api.Endpoints;

/// <summary>
/// Ligação com o painel da Viih Mimos: a precificação do hub lê e grava as fichas
/// no banco do painel (o mesmo que o painel e o app usam), não no navegador.
/// </summary>
public class ViihMimosOptions
{
    public const string SectionName = "ViihMimos";

    /// <summary>Endereço do painel, ex.: https://admin.viihmimos.com.br</summary>
    public string Url { get; set; } = "";

    /// <summary>A HUB_CHAVE do .env do painel.</summary>
    public string Chave { get; set; } = "";

    /// <summary>E-mails (separados por vírgula) que usam a precificação. Vazio = ninguém:
    /// o cadastro do hub é aberto, então estar logado não basta.</summary>
    public string Usuarios { get; set; } = "";

    public bool Ligado => Url.Length > 0 && Chave.Length >= 32;

    public bool Pode(string? email) =>
        !string.IsNullOrWhiteSpace(email) &&
        Usuarios.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(u => string.Equals(u, email, StringComparison.OrdinalIgnoreCase));
}

public static class ViihMimosEndpoints
{
    public const string ClienteHttp = "ViihMimos";

    public static void MapViihMimosEndpoints(this IEndpointRouteBuilder app)
    {
        var grupo = app.MapGroup("/api/precificacao").RequireAuthorization();

        // A tela pergunta antes: sem ligação, ela avisa em vez de mostrar uma lista vazia.
        grupo.MapGet("/estado", async (ClaimsPrincipal user, AppDbContext db, IOptions<ViihMimosOptions> opt) =>
            Results.Ok(new { ligado = opt.Value.Ligado && await PodeUsar(user, db, opt.Value) }));

        // Tudo o mais vai igual para /api/precos/... do painel, com a chave.
        grupo.MapMethods("/{**caminho}", ["GET", "POST", "PUT", "DELETE"], async (string caminho, HttpContext http, ClaimsPrincipal user, AppDbContext db,
            IOptions<ViihMimosOptions> opt, IHttpClientFactory fabrica, CancellationToken ct) =>
        {
            var o = opt.Value;
            if (!o.Ligado || !await PodeUsar(user, db, o)) return Results.NotFound();
            if (caminho.Contains("..")) return Results.BadRequest();

            using var pedido = new HttpRequestMessage(new HttpMethod(http.Request.Method),
                $"{o.Url.TrimEnd('/')}/api/precos/{caminho}{http.Request.QueryString}");
            pedido.Headers.Add("X-Chave-Hub", o.Chave);
            if (http.Request.ContentLength > 0 || http.Request.Headers.TransferEncoding.Count > 0)
            {
                pedido.Content = new StreamContent(http.Request.Body);
                pedido.Content.Headers.TryAddWithoutValidation("Content-Type", http.Request.ContentType ?? "application/json");
            }

            try
            {
                using var resposta = await fabrica.CreateClient(ClienteHttp).SendAsync(pedido, ct);
                var corpo = await resposta.Content.ReadAsByteArrayAsync(ct);
                // 401 do painel é chave errada, não login do hub vencido: não pode deslogar a pessoa.
                var status = (int)resposta.StatusCode == 401 ? 502 : (int)resposta.StatusCode;
                if (corpo.Length == 0) return Results.StatusCode(status);
                http.Response.StatusCode = status;
                return Results.Bytes(corpo, resposta.Content.Headers.ContentType?.ToString() ?? "application/json");
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                return Results.Json(new { erro = "O painel da Viih Mimos não respondeu." }, statusCode: 502);
            }
        });
    }

    private static async Task<bool> PodeUsar(ClaimsPrincipal user, AppDbContext db, ViihMimosOptions opt)
    {
        if (string.IsNullOrWhiteSpace(opt.Usuarios)) return false;
        var id = user.UserId();
        var email = await db.Users.AsNoTracking().Where(u => u.Id == id).Select(u => u.Email).FirstOrDefaultAsync();
        return opt.Pode(email);
    }
}
