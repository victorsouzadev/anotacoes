using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.Json;

namespace EditorImagens.Desktop;

public record ProjetoArquivoDto(string Caminho, string Nome, string Dados);

/// <summary>O arquivo de projeto do desktop. Sem nada de WPF: os testes compilam este arquivo junto.</summary>
public static class ArquivoProjeto
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// O .edimg é um ZIP: projeto.json (nome e versão do formato) e dados.json
    /// (o mesmo JSON que o site guarda na conta). Dá pra abrir num descompactador
    /// e ver o que tem dentro.
    /// </summary>
    public static ProjetoArquivoDto Ler(string caminho)
    {
        using var zip = ZipFile.OpenRead(caminho);
        var dados = LerTexto(zip, "dados.json") ?? throw new InvalidDataException("dados.json ausente");
        var meta = LerTexto(zip, "projeto.json");
        var nome = meta is null ? null : JsonDocument.Parse(meta).RootElement.TryGetProperty("nome", out var n) ? n.GetString() : null;
        return new ProjetoArquivoDto(caminho, nome ?? Path.GetFileNameWithoutExtension(caminho), dados);
    }

    public static void Gravar(string caminho, string nome, string dados, string versao)
    {
        // grava ao lado e troca no fim: queda de energia no meio não estraga o arquivo que existia
        var tmp = caminho + ".salvando";
        using (var zip = ZipFile.Open(tmp, ZipArchiveMode.Create))
        {
            EscreverTexto(zip, "projeto.json", JsonSerializer.Serialize(new { formato = 1, nome, salvoEm = DateTime.Now, programa = "Editor de Imagens " + versao }, Json));
            EscreverTexto(zip, "dados.json", dados);
        }
        File.Move(tmp, caminho, overwrite: true);
    }

    private static string? LerTexto(ZipArchive zip, string nome)
    {
        var e = zip.GetEntry(nome);
        if (e is null) return null;
        using var r = new StreamReader(e.Open(), Encoding.UTF8);
        return r.ReadToEnd();
    }

    private static void EscreverTexto(ZipArchive zip, string nome, string texto)
    {
        using var w = new StreamWriter(zip.CreateEntry(nome, CompressionLevel.Optimal).Open(), new UTF8Encoding(false));
        w.Write(texto);
    }

    /// <summary>Tira do nome o que o Windows não aceita em arquivo.</summary>
    public static string NomeDeArquivo(string nome)
    {
        var invalidos = Path.GetInvalidFileNameChars();
        var limpo = new string(nome.Select(c => invalidos.Contains(c) ? '-' : c).ToArray()).Trim().TrimEnd('.');
        return string.IsNullOrEmpty(limpo) ? "projeto" : limpo.Length > 120 ? limpo[..120] : limpo;
    }
}
