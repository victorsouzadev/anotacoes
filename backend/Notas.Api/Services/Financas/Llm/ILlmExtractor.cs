namespace Notas.Api.Services.Financas.Llm;

// Um arquivo enviado junto com o texto: foto de cupom, PDF de extrato, CSV de fatura.
public record AnexoExtracao(string NomeArquivo, string MimeType, byte[] Conteudo)
{
    public bool EhImagem => MimeType.StartsWith("image/", StringComparison.OrdinalIgnoreCase);
    public bool EhPdf => MimeType.Equals("application/pdf", StringComparison.OrdinalIgnoreCase);

    // Arquivos de texto (CSV, OFX, TXT) não precisam ir como anexo binário: o
    // conteúdo entra direto no prompt, o que é mais barato e funciona em qualquer
    // modelo, inclusive nos que não leem imagem.
    public bool EhTexto => !EhImagem && !EhPdf;

    public string ComoDataUrl() => $"data:{MimeType};base64,{Convert.ToBase64String(Conteudo)}";
}

// Entrada da extração: texto livre, arquivos, ou os dois juntos.
public record EntradaExtracao(string Texto, IReadOnlyList<AnexoExtracao> Anexos)
{
    public static EntradaExtracao DeTexto(string texto) => new(texto, Array.Empty<AnexoExtracao>());

    public bool TemAnexos => Anexos.Count > 0;

    // Um cupom rende um lançamento; um extrato rende dezenas. Só faz sentido pedir
    // vários ao modelo quando há arquivo — texto digitado é sempre um lançamento.
    public bool EsperaVarios => TemAnexos;
}

// Abstração sobre o provedor de LLM usado para extrair dados estruturados
// de um texto livre (e, quando houver, dos arquivos anexados).
public interface ILlmExtractor
{
    /// <summary>Nome do provedor, para diagnóstico e para a interface saber o que está ativo.</summary>
    string Provedor { get; }

    /// <summary>Se o provedor consegue ler imagens e PDFs, e não apenas texto.</summary>
    bool SuportaAnexos { get; }

    Task<IReadOnlyList<ExtracaoLlmResult>> ExtrairAsync(
        EntradaExtracao entrada, DateOnly dataEnvio, CancellationToken cancellationToken = default);
}
