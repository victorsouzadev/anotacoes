namespace Notas.Api.Services.Financas.Llm;

// Sugestões mostradas na tela de configurações. A lista é só um atalho — a
// OpenRouter aceita qualquer identificador de modelo, e o campo é livre.
//
// "LeImagens" é o que decide se a importação de foto de cupom e PDF vai
// funcionar: um modelo sem visão só serve para o lançamento por texto.
public record ModeloSugerido(string Id, string Nome, string Descricao, bool LeImagens);

public static class ModelosSugeridos
{
    // Os mesmos modelos que o app Android já oferece em Configurações, para as
    // duas pontas do projeto sugerirem as mesmas opções.
    public static readonly IReadOnlyList<ModeloSugerido> OpenRouter = new[]
    {
        new ModeloSugerido("anthropic/claude-haiku-4.5", "Claude Haiku 4.5",
            "Padrão. Rápido, barato e lê imagens e PDFs.", true),
        new ModeloSugerido("openai/gpt-4o-mini", "GPT-4o mini",
            "Alternativa barata, também lê imagens.", true),
        new ModeloSugerido("google/gemini-3.6-flash", "Gemini 3.6 Flash",
            "Boa com documentos longos, como extratos de várias páginas.", true),
        new ModeloSugerido("google/gemma-4-31b-it:free", "Gemma 4 31B (grátis)",
            "Sem custo, mas só interpreta texto — não lê cupom nem PDF.", false),
    };

    public static readonly IReadOnlyList<ModeloSugerido> Anthropic = new[]
    {
        new ModeloSugerido("claude-haiku-4-5-20251001", "Claude Haiku 4.5", "Rápido e barato.", false),
        new ModeloSugerido("claude-sonnet-5", "Claude Sonnet 5", "Mais preciso em textos ambíguos.", false),
    };

    public static IReadOnlyList<ModeloSugerido> Para(string provedor) =>
        provedor.Equals("anthropic", StringComparison.OrdinalIgnoreCase) ? Anthropic : OpenRouter;
}
