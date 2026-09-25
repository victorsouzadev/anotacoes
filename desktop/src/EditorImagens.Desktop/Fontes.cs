using System.IO;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Win32;

namespace EditorImagens.Desktop;

public record FonteDto(string Id, string Nome, long Bytes);

/// <summary>
/// As fontes instaladas no Windows, pra usar no texto da ilustração. O editor
/// transforma o texto em curva com o arquivo da fonte, então ele precisa do
/// .ttf/.otf de verdade — é o que estes endpoints entregam. Coleções (.ttc)
/// ficam de fora: o leitor de fontes do editor não abre.
/// </summary>
public static class Fontes
{
    /// <summary>Mesmo teto das fontes enviadas pelo site.</summary>
    public const long MaxBytes = 1536 * 1024;

    private static Dictionary<string, (string nome, string caminho)>? indice;

    public static void MapFontesEndpoints(this RouteGroupBuilder g)
    {
        g.MapGet("/fontes", () => Results.Ok(Indice()
            .Select(kv => new FonteDto(kv.Key, kv.Value.nome, new FileInfo(kv.Value.caminho).Length))
            .OrderBy(f => f.Nome, StringComparer.CurrentCultureIgnoreCase)));

        g.MapGet("/fontes/{id}", (string id) =>
        {
            if (!Indice().TryGetValue(id, out var f) || !File.Exists(f.caminho)) return Results.NotFound();
            var tipo = f.caminho.EndsWith(".otf", StringComparison.OrdinalIgnoreCase) ? "font/otf" : "font/ttf";
            return Results.File(f.caminho, tipo, Path.GetFileName(f.caminho));
        });
    }

    private static Dictionary<string, (string nome, string caminho)> Indice()
    {
        if (indice is not null) return indice;
        var sistema = Environment.GetFolderPath(Environment.SpecialFolder.Fonts);
        var mapa = new Dictionary<string, (string, string)>();
        foreach (var raiz in new[] { Registry.LocalMachine, Registry.CurrentUser })
        {
            using var k = raiz.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts");
            if (k is null) continue;
            foreach (var valor in k.GetValueNames())
            {
                if (k.GetValue(valor) is not string arquivo) continue;
                var caminho = Path.IsPathRooted(arquivo) ? arquivo : Path.Combine(sistema, arquivo);
                var ext = Path.GetExtension(caminho).ToLowerInvariant();
                if (ext is not (".ttf" or ".otf")) continue;
                var info = new FileInfo(caminho);
                if (!info.Exists || info.Length > MaxBytes) continue;
                var nome = valor.Replace(" (TrueType)", "").Replace(" (OpenType)", "").Trim();
                mapa[Id(caminho)] = (nome, caminho);
            }
        }
        return indice = mapa;
    }

    private static string Id(string caminho) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(caminho.ToLowerInvariant())))[..12].ToLowerInvariant();
}
