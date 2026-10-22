using System.Security.Claims;
using Notas.Api.Services.Dieta.Ia;
using Notas.Api.Services.Financas.Chat;

namespace Notas.Api.Endpoints;

public record DietaChatRequest(List<MensagemChat>? Mensagens, string? Imagem);
public record DietaReconhecerRequest(string? Modo, string? Texto, string? Imagem);

/// <summary>IA da Dieta: chat que consulta e altera a dieta, e reconhecimento de alimentos por foto ou texto.</summary>
public static class DietaIaEndpoints
{
    private const int MaxMensagens = 30;
    private const int MaxCaracteres = 4000;
    // Data URL de uma foto reduzida no app (~1024 px, JPEG): sobra folga com 4 MB.
    private const int MaxImagem = 4 * 1024 * 1024;

    public static void MapDietaIaEndpoints(this IEndpointRouteBuilder app)
    {
        // A conversa fica no aparelho; cada chamada manda o histórico e recebe a resposta da última pergunta.
        app.MapPost("/api/dieta/chat", async (DietaChatRequest req, ClaimsPrincipal user, ChatDieta chat, CancellationToken ct) =>
        {
            var mensagens = (req.Mensagens ?? [])
                .Where(m => !string.IsNullOrWhiteSpace(m.Texto))
                .Select(m => new MensagemChat(m.Papel == "assistente" ? "assistente" : "usuario",
                    m.Texto.Length > MaxCaracteres ? m.Texto[..MaxCaracteres] : m.Texto))
                .TakeLast(MaxMensagens).ToList();
            while (mensagens.Count > 0 && mensagens[0].Papel != "usuario") mensagens.RemoveAt(0);
            if (mensagens.Count == 0 || mensagens[^1].Papel != "usuario")
                return Results.BadRequest(new { error = "Envie uma pergunta." });
            if (ImagemInvalida(req.Imagem)) return Results.BadRequest(new { error = "Imagem inválida (JPEG/PNG/WebP em data URL, até 4 MB)." });
            return await Tratar(() => chat.ResponderAsync(user.UserId(), mensagens, req.Imagem, ct), ct);
        }).RequireAuthorization().RequireRateLimiting("dieta-ia");

        // modo: prato (foto do prato), texto (descrição) ou rotulo (foto da tabela nutricional).
        app.MapPost("/api/dieta/ia/reconhecer", async (DietaReconhecerRequest req, ClaimsPrincipal user, ReconhecedorDeAlimento rec, CancellationToken ct) =>
        {
            // "embalagem" é o nome novo de "rotulo" (frente, verso ou tabela da embalagem): mesmo caminho.
            var modo = req.Modo == "embalagem" ? "rotulo" : req.Modo ?? "";
            var texto = req.Texto?.Trim();
            if (modo is not ("prato" or "texto" or "rotulo")
                || (modo == "texto" && string.IsNullOrEmpty(texto))
                || (modo != "texto" && req.Imagem is null)
                || ImagemInvalida(req.Imagem) || texto?.Length > 1000)
                return Results.BadRequest(new { error = "Envie a foto (prato ou rótulo) ou a descrição do que comeu." });
            return await Tratar(() => rec.ReconhecerAsync(user.UserId(), modo, texto, modo == "texto" ? null : req.Imagem, ct), ct);
        }).RequireAuthorization().RequireRateLimiting("dieta-ia");
    }

    private static bool ImagemInvalida(string? img) =>
        img is not null && (img.Length > MaxImagem || !(img.StartsWith("data:image/jpeg;base64,") || img.StartsWith("data:image/png;base64,") || img.StartsWith("data:image/webp;base64,")));

    private static async Task<IResult> Tratar<T>(Func<Task<T>> acao, CancellationToken ct)
    {
        try
        {
            return Results.Ok(await acao());
        }
        catch (ChatIndisponivelException e)
        {
            return Results.BadRequest(new { error = e.Message });
        }
        catch (HttpRequestException)
        {
            return Results.BadRequest(new { error = "Não foi possível falar com o provedor de IA. Tente de novo." });
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            return Results.BadRequest(new { error = "O provedor de IA demorou demais para responder. Tente de novo." });
        }
    }
}
