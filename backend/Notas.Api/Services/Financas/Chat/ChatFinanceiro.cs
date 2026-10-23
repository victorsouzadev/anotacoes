using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Notas.Api.Services.Financas.Llm;

namespace Notas.Api.Services.Financas.Chat;

public record MensagemChat(string Papel, string Texto);

public record RespostaChat(string Resposta, List<string> Consultas);

public class ChatIndisponivelException(string mensagem) : Exception(mensagem);

/// <summary>Faz a chamada HTTP ao provedor. Separado para os testes trocarem por um falso.</summary>
public interface IChatModeloCliente
{
    Task<JsonObject> EnviarAsync(CredenciaisLlm credenciais, JsonObject corpo, CancellationToken ct);
}

public class ChatModeloCliente(IHttpClientFactory httpFactory, IOptions<AnthropicOptions> anthropic,
    IOptions<OpenRouterOptions> openRouter, ILogger<ChatModeloCliente> log) : IChatModeloCliente
{
    // 429 e 502/503 costumam ser passageiros (limite por minuto do provedor por trás da OpenRouter): tenta de novo
    // algumas vezes antes de desistir, respeitando o Retry-After quando vier.
    private static readonly TimeSpan[] Esperas = [TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(5)];

    public async Task<JsonObject> EnviarAsync(CredenciaisLlm cred, JsonObject corpo, CancellationToken ct)
    {
        var anth = cred.Provedor == "anthropic";
        // OpenRouter: se o modelo escolhido estiver sem capacidade, ela passa para o próximo da lista sozinha.
        if (!anth && corpo["models"] is null && openRouter.Value.ModelosReserva is { Length: > 0 } reserva)
            corpo["models"] = new JsonArray([.. new[] { cred.Modelo }.Concat(reserva).Where(m => !string.IsNullOrWhiteSpace(m))
                .Distinct().Take(3).Select(m => (JsonNode)JsonValue.Create(m)!)]);

        for (var tentativa = 0; ; tentativa++)
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, anth ? anthropic.Value.BaseUrl : openRouter.Value.BaseUrl);
            if (anth)
            {
                req.Headers.Add("x-api-key", cred.Chave);
                req.Headers.Add("anthropic-version", anthropic.Value.ApiVersion);
            }
            else
            {
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", cred.Chave);
                req.Headers.Add("X-Title", "Notas Financas");
            }
            req.Content = new StringContent(corpo.ToJsonString(), Encoding.UTF8, "application/json");

            using var res = await httpFactory.CreateClient(nameof(ChatModeloCliente)).SendAsync(req, ct);
            var texto = await res.Content.ReadAsStringAsync(ct);
            if (res.IsSuccessStatusCode)
                return JsonNode.Parse(texto) as JsonObject
                       ?? throw new ChatIndisponivelException("Resposta inesperada do provedor de IA.");

            var status = (int)res.StatusCode;
            log.LogWarning("Provedor de IA ({Provedor}, {Modelo}) respondeu HTTP {Status} na tentativa {Tentativa}: {Corpo}",
                cred.Provedor, cred.Modelo, status, tentativa + 1, texto.Length > 600 ? texto[..600] : texto);
            if (status is 429 or 502 or 503 && tentativa < Esperas.Length)
            {
                var espera = res.Headers.RetryAfter?.Delta is { } d && d <= TimeSpan.FromSeconds(10) ? d : Esperas[tentativa];
                await Task.Delay(espera, ct);
                continue;
            }
            var detalhe = MensagemDoProvedor(texto);
            var motivo = status switch
            {
                401 or 403 => "o provedor de IA recusou a chave configurada",
                402 => "sem créditos no provedor de IA (OpenRouter); adicione créditos ou troque a chave",
                429 => "o provedor de IA está limitando as chamadas agora; tente de novo em alguns minutos",
                _ => $"o provedor de IA respondeu HTTP {status}",
            };
            throw new ChatIndisponivelException($"Não foi possível responder: {motivo}." + (detalhe is null ? "" : $" ({detalhe})"));
        }
    }

    /// <summary>A mensagem de erro que a OpenRouter/Anthropic manda ({"error":{"message":...}}), encurtada.</summary>
    private static string? MensagemDoProvedor(string corpo)
    {
        try
        {
            var m = JsonNode.Parse(corpo)?["error"]?["message"]?.GetValue<string>()?.Trim();
            return string.IsNullOrEmpty(m) ? null : m.Length > 160 ? m[..160] + "…" : m;
        }
        catch (Exception) { return null; }
    }
}

/// <summary>Executa a ferramenta que o modelo pediu e devolve o resultado (JSON) que volta para ele.</summary>
public delegate Task<string> ExecutarFerramenta(string nome, JsonObject? args, CancellationToken ct);

/// <summary>
/// O laço de chat com ferramentas, igual para Anthropic e OpenRouter: o modelo recebe as definições, pede o que
/// precisa, o laço executa e devolve o resultado até vir a resposta. Usado pelos chats de Finanças e da Dieta.
/// </summary>
public class ChatComFerramentas(ILlmExtractorFactory llm, IChatModeloCliente cliente)
{
    private const int MaxRodadas = 10;
    // O raciocínio dos modelos que "pensam" sai do mesmo max_tokens da resposta: com 4096 a resposta podia vir cortada.
    private const int MaxTokens = 12000;

    public async Task<RespostaChat> ResponderAsync(string userId, IReadOnlyList<MensagemChat> historico, string prompt,
        IReadOnlyList<DefinicaoFerramenta> definicoes, ExecutarFerramenta executar, CancellationToken ct, string? imagem = null,
        Func<bool>? encerrar = null)
    {
        var cred = await llm.ResolverCredenciaisAsync(userId, ct);
        if (cred.Provedor == "heuristico" || string.IsNullOrWhiteSpace(cred.Chave))
            throw new ChatIndisponivelException(
                "O chat precisa de um provedor de IA. Configure uma chave da OpenRouter ou da Anthropic em Configurações de IA.");
        if (imagem is not null && cred.Provedor != "openrouter")
            throw new ChatIndisponivelException("Para mandar foto no chat, configure uma chave da OpenRouter (o provedor que lê imagens).");

        var consultas = new List<string>();
        return cred.Provedor == "anthropic"
            ? await AnthropicAsync(cred, historico, prompt, definicoes, executar, consultas, encerrar, ct)
            : await OpenAiAsync(cred, historico, prompt, definicoes, executar, consultas, imagem, encerrar, ct);
    }

    // ------------------------------------------------------------ Anthropic

    private async Task<RespostaChat> AnthropicAsync(CredenciaisLlm cred, IReadOnlyList<MensagemChat> historico, string prompt,
        IReadOnlyList<DefinicaoFerramenta> definicoes, ExecutarFerramenta executar, List<string> consultas, Func<bool>? encerrar,
        CancellationToken ct)
    {
        var mensagens = new JsonArray(historico.Select(m => (JsonNode)new JsonObject
        {
            ["role"] = m.Papel == "assistente" ? "assistant" : "user",
            ["content"] = m.Texto,
        }).ToArray());
        var tools = new JsonArray(definicoes.Select(d => (JsonNode)new JsonObject
        {
            ["name"] = d.Nome, ["description"] = d.Descricao, ["input_schema"] = d.Parametros.DeepClone(),
        }).ToArray());

        for (var rodada = 0; rodada < MaxRodadas; rodada++)
        {
            var corpo = new JsonObject
            {
                ["model"] = cred.Modelo, ["max_tokens"] = MaxTokens, ["system"] = prompt,
                ["tools"] = tools.DeepClone(), ["messages"] = mensagens.DeepClone(),
            };
            var res = await cliente.EnviarAsync(cred, corpo, ct);
            var conteudo = res["content"] as JsonArray ?? [];

            if (res["stop_reason"]?.GetValue<string>() != "tool_use")
            {
                var texto = string.Join("\n", conteudo.OfType<JsonObject>()
                    .Where(b => b["type"]?.GetValue<string>() == "text")
                    .Select(b => b["text"]?.GetValue<string>()));
                return new RespostaChat(Finalizar(texto, res["stop_reason"]?.GetValue<string>() == "max_tokens"), consultas);
            }

            mensagens.Add(new JsonObject { ["role"] = "assistant", ["content"] = conteudo.DeepClone() });
            var resultados = new JsonArray();
            foreach (var bloco in conteudo.OfType<JsonObject>().Where(b => b["type"]?.GetValue<string>() == "tool_use"))
            {
                var nome = bloco["name"]!.GetValue<string>();
                consultas.Add(nome);
                resultados.Add(new JsonObject
                {
                    ["type"] = "tool_result",
                    ["tool_use_id"] = bloco["id"]!.GetValue<string>(),
                    ["content"] = await executar(nome, bloco["input"] as JsonObject, ct),
                });
            }
            mensagens.Add(new JsonObject { ["role"] = "user", ["content"] = resultados });
            // Ferramenta que encerra a vez (ex.: perguntar ao usuário): devolve o texto que veio junto da chamada.
            if (encerrar?.Invoke() == true)
                return new RespostaChat(string.Join("\n", conteudo.OfType<JsonObject>()
                    .Where(b => b["type"]?.GetValue<string>() == "text").Select(b => b["text"]?.GetValue<string>())).Trim(), consultas);
        }
        throw new ChatIndisponivelException("A pergunta exigiu consultas demais. Tente algo mais específico.");
    }

    // -------------------------------------------- OpenRouter (formato OpenAI)

    private async Task<RespostaChat> OpenAiAsync(CredenciaisLlm cred, IReadOnlyList<MensagemChat> historico, string prompt,
        IReadOnlyList<DefinicaoFerramenta> definicoes, ExecutarFerramenta executar, List<string> consultas, string? imagem,
        Func<bool>? encerrar, CancellationToken ct)
    {
        var mensagens = new JsonArray { new JsonObject { ["role"] = "system", ["content"] = prompt } };
        for (var i = 0; i < historico.Count; i++)
        {
            var m = historico[i];
            // A foto (se houver) vai junto da última pergunta, no formato multimodal da OpenRouter.
            JsonNode conteudo = imagem is not null && i == historico.Count - 1
                ? new JsonArray(
                    new JsonObject { ["type"] = "text", ["text"] = m.Texto },
                    new JsonObject { ["type"] = "image_url", ["image_url"] = new JsonObject { ["url"] = imagem } })
                : JsonValue.Create(m.Texto)!;
            mensagens.Add(new JsonObject { ["role"] = m.Papel == "assistente" ? "assistant" : "user", ["content"] = conteudo });
        }
        var tools = new JsonArray(definicoes.Select(d => (JsonNode)new JsonObject
        {
            ["type"] = "function",
            ["function"] = new JsonObject
            {
                ["name"] = d.Nome, ["description"] = d.Descricao, ["parameters"] = d.Parametros.DeepClone(),
            },
        }).ToArray());

        for (var rodada = 0; rodada < MaxRodadas; rodada++)
        {
            var corpo = new JsonObject
            {
                ["model"] = cred.Modelo, ["max_tokens"] = MaxTokens,
                ["tools"] = tools.DeepClone(), ["messages"] = mensagens.DeepClone(),
            };
            var res = await cliente.EnviarAsync(cred, corpo, ct);
            var escolha = (res["choices"] as JsonArray)?.FirstOrDefault() as JsonObject;
            if (escolha?["message"] is not JsonObject msg)
                throw new ChatIndisponivelException("Resposta inesperada do provedor de IA.");

            if (msg["tool_calls"] is not JsonArray chamadas || chamadas.Count == 0)
            {
                var texto = msg["content"] is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";
                return new RespostaChat(Finalizar(texto, escolha["finish_reason"]?.ToString() == "length"), consultas);
            }

            mensagens.Add(msg.DeepClone());
            foreach (var chamada in chamadas.OfType<JsonObject>())
            {
                var nome = chamada["function"]?["name"]?.GetValue<string>() ?? "";
                consultas.Add(nome);
                JsonObject? args = null;
                try { args = JsonNode.Parse(chamada["function"]?["arguments"]?.GetValue<string>() ?? "{}") as JsonObject; }
                catch (System.Text.Json.JsonException) { }
                mensagens.Add(new JsonObject
                {
                    ["role"] = "tool",
                    ["tool_call_id"] = chamada["id"]?.GetValue<string>(),
                    ["content"] = args is null
                        ? """{"erro":"argumentos em JSON inválido"}"""
                        : await executar(nome, args, ct),
                });
            }
            if (encerrar?.Invoke() == true)
                return new RespostaChat((msg["content"] is JsonValue tv && tv.TryGetValue<string>(out var parcial) ? parcial : "").Trim(), consultas);
        }
        throw new ChatIndisponivelException("A pergunta exigiu consultas demais. Tente algo mais específico.");
    }

    private static string Finalizar(string texto, bool cortado)
    {
        texto = texto.Trim();
        if (texto.Length == 0) texto = "Não consegui formular uma resposta. Tente reformular a pergunta.";
        return cortado ? texto + "\n\n_(resposta cortada por tamanho)_" : texto;
    }
}

// Chat sobre as finanças do usuário. O modelo não recebe os dados de antemão:
// recebe a lista de consultas (FerramentasFinanceiras) e pede o que precisa;
// o laço (ChatComFerramentas) executa cada pedido e devolve o resultado até o modelo responder.
public class ChatFinanceiro(ChatComFerramentas chat, FerramentasFinanceiras ferramentas, FinancasClock clock)
{
    public Task<RespostaChat> ResponderAsync(string userId, IReadOnlyList<MensagemChat> historico, CancellationToken ct) =>
        chat.ResponderAsync(userId, historico, PromptDoSistema(), FerramentasFinanceiras.Definicoes,
            (nome, args, c) => ferramentas.ExecutarAsync(userId, nome, args, c), ct);

    // Fixo, e não pela cultura: sem ICU (como no container) a cultura pt-BR não existe.
    private static readonly string[] DiasDaSemana =
        ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

    public string PromptDoSistema()
    {
        var hoje = clock.Hoje();
        return $"""
            Você é o assistente financeiro do app de finanças pessoais do usuário. Responda em português do Brasil,
            de forma direta, com valores em reais (R$ 1.234,56).

            Hoje é {DiasDaSemana[(int)hoje.DayOfWeek]}, {hoje.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)}.

            Você tem consultas aos dados reais do usuário. Use-as sempre que a pergunta depender dos números dele —
            nunca invente valores, e diga quando os dados não bastam para responder. Faça quantas consultas precisar,
            e prefira os totais das consultas a somar itens você mesmo.

            Conceitos do app:
            - Competência: o mês a que o lançamento pertence. Compras no cartão contam no mês da fatura.
              Resumos mensais usam competência; buscas por data usam a data da compra.
            - Lançamentos "fora dos totais" (pagamento de fatura, transferências entre contas) não entram em nenhuma soma.
            - Consumo: despesas sem investimentos e sem pagamento de fatura; é o melhor número para "quanto gastei".
            - Categorias: Alimentacao, Transporte, Moradia, Saude, Educacao, Lazer, Compras, ContasServicos, Salario,
              Investimentos, Outros.

            Seja conciso: comece pela resposta, depois os números que a sustentam. Use listas ou tabelas markdown curtas
            quando ajudar. Quando fizer sentido, sugira uma ação prática.
            """;
    }
}
