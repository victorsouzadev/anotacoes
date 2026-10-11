using System.Security.Claims;
using Notas.Api.Services.Financas.Chat;

namespace Notas.Api.Endpoints;

public record ChatFinanceiroRequest(List<MensagemChat>? Mensagens);

public static class ChatFinanceiroEndpoints
{
    private const int MaxMensagens = 30;
    private const int MaxCaracteres = 4000;

    public static void MapChatFinanceiroEndpoints(this IEndpointRouteBuilder app)
    {
        // POST /api/financas/chat — recebe a conversa inteira (o histórico fica no
        // navegador) e devolve a resposta do assistente para a última pergunta.
        app.MapPost("/api/financas/chat", async (ChatFinanceiroRequest req, ClaimsPrincipal user, ChatFinanceiro chat,
            CancellationToken ct) =>
        {
            var mensagens = (req.Mensagens ?? [])
                .Where(m => !string.IsNullOrWhiteSpace(m.Texto))
                .Select(m => new MensagemChat(m.Papel == "assistente" ? "assistente" : "usuario",
                    m.Texto.Length > MaxCaracteres ? m.Texto[..MaxCaracteres] : m.Texto))
                .TakeLast(MaxMensagens)
                .ToList();
            // A conversa precisa começar pelo usuário e terminar numa pergunta dele.
            while (mensagens.Count > 0 && mensagens[0].Papel != "usuario") mensagens.RemoveAt(0);
            if (mensagens.Count == 0 || mensagens[^1].Papel != "usuario")
                return Results.BadRequest(new { erro = "Envie uma pergunta." });

            try
            {
                return Results.Ok(await chat.ResponderAsync(user.UserId(), mensagens, ct));
            }
            catch (ChatIndisponivelException e)
            {
                return Results.BadRequest(new { erro = e.Message });
            }
            catch (HttpRequestException)
            {
                return Results.BadRequest(new { erro = "Não foi possível falar com o provedor de IA. Tente de novo." });
            }
            catch (TaskCanceledException) when (!ct.IsCancellationRequested)
            {
                return Results.BadRequest(new { erro = "O provedor de IA demorou demais para responder. Tente de novo." });
            }
        }).RequireAuthorization().RequireRateLimiting("financas-ia");
    }
}
