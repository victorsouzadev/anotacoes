using System.Text.Json;

namespace Notas.Api.Services.Financas.Llm;

// Converte a resposta textual do modelo na lista de lançamentos extraídos.
// Fica fora dos extratores porque OpenRouter e Anthropic recebem a mesma
// instrução de formato e podem devolver as mesmas variações.
public static class RespostaLlmParser
{
    public static IReadOnlyList<ExtracaoLlmResult> Parse(string texto, JsonSerializerOptions opcoes, ILogger logger)
    {
        var json = ExtrairJson(texto);

        try
        {
            using var doc = JsonDocument.Parse(json);
            var raiz = doc.RootElement;

            // O prompt pede {"lancamentos": [...]}, mas um modelo pode devolver o
            // objeto solto quando encontra um único lançamento, ou um array puro.
            // Aceitar as três formas evita jogar fora uma extração boa por causa
            // do invólucro.
            var elemento = raiz.ValueKind == JsonValueKind.Object && raiz.TryGetProperty("lancamentos", out var lista)
                ? lista
                : raiz;

            if (elemento.ValueKind == JsonValueKind.Array)
            {
                var resultados = new List<ExtracaoLlmResult>();
                foreach (var item in elemento.EnumerateArray())
                {
                    var convertido = item.Deserialize<ExtracaoLlmResult>(opcoes);
                    if (convertido is not null) resultados.Add(convertido);
                }

                if (resultados.Count == 0)
                {
                    throw new ExtracaoInvalidaException("Não encontrei nenhum lançamento no que foi enviado.");
                }
                return resultados;
            }

            var unico = elemento.Deserialize<ExtracaoLlmResult>(opcoes)
                ?? throw new ExtracaoInvalidaException("Não foi possível desserializar a resposta do LLM.");
            return new[] { unico };
        }
        catch (JsonException ex)
        {
            logger.LogError(ex, "JSON inválido retornado pelo LLM: {Json}", json);
            throw new ExtracaoInvalidaException("O serviço de interpretação retornou uma resposta inválida.");
        }
    }

    // O prompt manda responder só com JSON, mas alguns modelos envolvem a resposta
    // em bloco de código markdown. Recorta do primeiro delimitador de abertura até
    // o último de fechamento correspondente.
    public static string ExtrairJson(string texto)
    {
        var limpo = texto.Trim();

        if (limpo.StartsWith("```", StringComparison.Ordinal))
        {
            var primeiraQuebra = limpo.IndexOf('\n');
            if (primeiraQuebra > 0) limpo = limpo[(primeiraQuebra + 1)..];

            var fim = limpo.LastIndexOf("```", StringComparison.Ordinal);
            if (fim >= 0) limpo = limpo[..fim];

            limpo = limpo.Trim();
        }

        var inicioObjeto = limpo.IndexOf('{');
        var inicioArray = limpo.IndexOf('[');

        // Vale o delimitador que aparecer primeiro: a resposta pode ser um objeto
        // com "lancamentos" ou um array direto.
        var abre = inicioObjeto < 0 ? inicioArray
            : inicioArray < 0 ? inicioObjeto
            : Math.Min(inicioObjeto, inicioArray);

        if (abre < 0) return limpo;

        var fecha = limpo[abre] == '{' ? limpo.LastIndexOf('}') : limpo.LastIndexOf(']');
        if (fecha < abre) return limpo;

        return limpo[abre..(fecha + 1)];
    }
}
