using System.Text.Json.Serialization;

namespace Notas.Api.Services.Financas.Llm;

// Contrato de saída do LLM. Todos os campos são opcionais na desserialização para
// que o validador consiga reportar exatamente o que veio faltando, em vez de
// estourar uma exceção de parsing.
public class ExtracaoLlmResult
{
    [JsonPropertyName("descricao")]
    public string? Descricao { get; set; }

    [JsonPropertyName("valor")]
    public decimal? Valor { get; set; }

    [JsonPropertyName("tipo")]
    public string? Tipo { get; set; }

    [JsonPropertyName("categoria")]
    public string? Categoria { get; set; }

    [JsonPropertyName("data")]
    public string? Data { get; set; }

    [JsonPropertyName("forma_pagamento")]
    public string? FormaPagamento { get; set; }

    [JsonPropertyName("confianca")]
    public float? Confianca { get; set; }

    [JsonPropertyName("observacoes")]
    public string? Observacoes { get; set; }
}

// O texto do usuário não pôde ser interpretado como um lançamento. Culpa da
// entrada — vira 422 para o cliente.
public class ExtracaoInvalidaException : Exception
{
    public ExtracaoInvalidaException(string message) : base(message)
    {
    }
}

// O provedor de LLM falhou, expirou ou está mal configurado. Não é culpa do texto
// do usuário — vira 502/503, e não 422, para não dizer "não entendi" quando na
// verdade a API caiu.
public class LlmIndisponivelException : Exception
{
    public LlmIndisponivelException(string message, Exception? inner = null) : base(message, inner)
    {
    }
}
