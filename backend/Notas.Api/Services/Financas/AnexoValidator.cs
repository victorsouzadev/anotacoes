using System.Text;
using Notas.Api.Services.Financas.Llm;

namespace Notas.Api.Services.Financas;

// Regras sobre os arquivos aceitos na importação. Ficam separadas do endpoint
// para poderem ser testadas sem subir a API.
public static class AnexoValidator
{
    // O que os modelos com visão da OpenRouter leem, mais os formatos de texto que
    // bancos exportam.
    private static readonly Dictionary<string, string[]> TiposAceitos = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/jpeg"] = new[] { ".jpg", ".jpeg" },
        ["image/png"] = new[] { ".png" },
        ["image/webp"] = new[] { ".webp" },
        ["image/heic"] = new[] { ".heic" },
        ["application/pdf"] = new[] { ".pdf" },
        ["text/csv"] = new[] { ".csv" },
        ["text/plain"] = new[] { ".txt", ".ofx", ".qif" },
        ["application/vnd.ms-excel"] = new[] { ".csv" },
    };

    public static IReadOnlyCollection<string> ExtensoesAceitas { get; } =
        TiposAceitos.Values.SelectMany(e => e).Distinct().OrderBy(e => e).ToList();

    public static string DescricaoDosTiposAceitos =>
        "imagem (JPG, PNG, WEBP, HEIC), PDF, CSV, TXT, OFX ou QIF";

    // O tipo declarado pelo navegador não é confiável — um mesmo .csv chega como
    // text/csv, application/vnd.ms-excel ou application/octet-stream dependendo do
    // sistema. A extensão do nome desempata.
    public static bool TryResolverTipo(string nomeArquivo, string? contentType, out string mimeType, out string? erro)
    {
        mimeType = "";
        erro = null;

        var extensao = Path.GetExtension(nomeArquivo ?? "").ToLowerInvariant();

        if (!string.IsNullOrWhiteSpace(contentType))
        {
            var declarado = contentType.Split(';')[0].Trim();
            if (TiposAceitos.ContainsKey(declarado))
            {
                mimeType = declarado.ToLowerInvariant();
                return true;
            }
        }

        var porExtensao = TiposAceitos.FirstOrDefault(kv => kv.Value.Contains(extensao));
        if (porExtensao.Key is not null)
        {
            mimeType = porExtensao.Key.ToLowerInvariant();
            return true;
        }

        erro = $"Tipo de arquivo não suportado em '{nomeArquivo}'. Envie {DescricaoDosTiposAceitos}.";
        return false;
    }

    // Um arquivo de texto que não é UTF-8 válido chegaria ao prompt como um
    // amontoado de caracteres de substituição; melhor recusar com uma mensagem clara.
    public static bool ConteudoEhTextoLegivel(AnexoExtracao anexo)
    {
        if (!anexo.EhTexto) return true;
        if (anexo.Conteudo.Length == 0) return false;

        try
        {
            var strict = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);
            strict.GetString(anexo.Conteudo);
            return true;
        }
        catch (DecoderFallbackException)
        {
            return false;
        }
    }
}
