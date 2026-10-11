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
    IOptions<OpenRouterOptions> openRouter) : IChatModeloCliente
{
    public async Task<JsonObject> EnviarAsync(CredenciaisLlm cred, JsonObject corpo, CancellationToken ct)
    {
        var anth = cred.Provedor == "anthropic";
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
        if (!res.IsSuccessStatusCode)
        {
            var motivo = (int)res.StatusCode switch
            {
                401 or 403 => "o provedor de IA recusou a chave configurada",
                429 => "limite de uso do provedor de IA atingido; tente de novo em instantes",
                _ => $"o provedor de IA respondeu HTTP {(int)res.StatusCode}",
            };
            throw new ChatIndisponivelException($"Não foi possível responder: {motivo}.");
        }
        return JsonNode.Parse(texto) as JsonObject
               ?? throw new ChatIndisponivelException("Resposta inesperada do provedor de IA.");
    }
}

// Chat sobre as finanças do usuário. O modelo não recebe os dados de antemão:
// recebe a lista de consultas (FerramentasFinanceiras) e pede o que precisa;
// o laço executa cada pedido e devolve o resultado até o modelo responder.
public class ChatFinanceiro(ILlmExtractorFactory llm, IChatModeloCliente cliente, FerramentasFinanceiras ferramentas,
    FinancasClock clock)
{
    private const int MaxRodadas = 10;
    private const int MaxTokens = 4096;

    public async Task<RespostaChat> ResponderAsync(string userId, IReadOnlyList<MensagemChat> historico,
        CancellationToken ct)
    {
        var cred = await llm.ResolverCredenciaisAsync(userId, ct);
        if (cred.Provedor == "heuristico" || string.IsNullOrWhiteSpace(cred.Chave))
            throw new ChatIndisponivelException(
                "O chat precisa de um provedor de IA. Configure uma chave da OpenRouter ou da Anthropic em Configurações de IA.");

        var consultas = new List<string>();
        return cred.Provedor == "anthropic"
            ? await AnthropicAsync(userId, cred, historico, consultas, ct)
            : await OpenAiAsync(userId, cred, historico, consultas, ct);
    }

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

    // ------------------------------------------------------------ Anthropic

    private async Task<RespostaChat> AnthropicAsync(string userId, CredenciaisLlm cred,
        IReadOnlyList<MensagemChat> historico, List<string> consultas, CancellationToken ct)
    {
        var mensagens = new JsonArray(historico.Select(m => (JsonNode)new JsonObject
        {
            ["role"] = m.Papel == "assistente" ? "assistant" : "user",
            ["content"] = m.Texto,
        }).ToArray());
        var tools = new JsonArray(FerramentasFinanceiras.Definicoes.Select(d => (JsonNode)new JsonObject
        {
            ["name"] = d.Nome, ["description"] = d.Descricao, ["input_schema"] = d.Parametros.DeepClone(),
        }).ToArray());

        for (var rodada = 0; rodada < MaxRodadas; rodada++)
        {
            var corpo = new JsonObject
            {
                ["model"] = cred.Modelo, ["max_tokens"] = MaxTokens, ["system"] = PromptDoSistema(),
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
                    ["content"] = await ferramentas.ExecutarAsync(userId, nome, bloco["input"] as JsonObject, ct),
                });
            }
            mensagens.Add(new JsonObject { ["role"] = "user", ["content"] = resultados });
        }
        throw new ChatIndisponivelException("A pergunta exigiu consultas demais. Tente algo mais específico.");
    }

    // -------------------------------------------- OpenRouter (formato OpenAI)

    private async Task<RespostaChat> OpenAiAsync(string userId, CredenciaisLlm cred,
        IReadOnlyList<MensagemChat> historico, List<string> consultas, CancellationToken ct)
    {
        var mensagens = new JsonArray { new JsonObject { ["role"] = "system", ["content"] = PromptDoSistema() } };
        foreach (var m in historico)
            mensagens.Add(new JsonObject { ["role"] = m.Papel == "assistente" ? "assistant" : "user", ["content"] = m.Texto });
        var tools = new JsonArray(FerramentasFinanceiras.Definicoes.Select(d => (JsonNode)new JsonObject
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
                        : await ferramentas.ExecutarAsync(userId, nome, args, ct),
                });
            }
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
