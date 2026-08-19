namespace Notas.Api.Services.Financas.Llm;

// Abstração sobre o provedor de LLM usado para extrair dados estruturados
// de um texto livre de lançamento financeiro.
public interface ILlmExtractor
{
    Task<ExtracaoLlmResult> ExtrairAsync(string textoLivre, DateOnly dataEnvio, CancellationToken cancellationToken = default);
}
