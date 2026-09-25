using System.IO;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Win32;

namespace EditorImagens.Desktop;

public record GravarProntaRequest(string Nome, string Dados);

/// <summary>
/// Pasta monitorada do modo Redes sociais: cada foto que chega na pasta (do
/// celular sincronizado, do cartão da câmera...) é avisada à página, que aplica
/// o look do lote e devolve o resultado pra subpasta "prontas". A página só lê
/// e grava dentro dessa pasta.
/// </summary>
public static class PastaMonitorada
{
    private static readonly string[] Extensoes = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];
    private const string Saida = "prontas";

    private static FileSystemWatcher? vigia;
    private static string? pasta;

    public static void MapPastaMonitoradaEndpoints(this RouteGroupBuilder g)
    {
        g.MapPost("/pasta/escolher", async (DesktopHost host) =>
        {
            var escolhida = await host.NaJanela(() =>
            {
                var dlg = new OpenFolderDialog { Title = "Pasta onde as fotos vão chegar" };
                return dlg.ShowDialog(host.Janela) == true ? dlg.FolderName : null;
            });
            return escolhida is null ? Results.NoContent() : Results.Ok(new { caminho = escolhida });
        });

        g.MapPost("/pasta/monitorar", (CaminhoRequest req, DesktopHost host) =>
        {
            if (!Directory.Exists(req.Caminho)) return Results.NotFound(new { error = "A pasta não existe." });
            Parar();
            pasta = Path.GetFullPath(req.Caminho);
            var saida = Directory.CreateDirectory(Path.Combine(pasta, Saida)).FullName;
            vigia = new FileSystemWatcher(pasta) { IncludeSubdirectories = false, NotifyFilter = NotifyFilters.FileName | NotifyFilters.Size };
            vigia.Created += (_, e) => _ = AvisarQuandoPronta(host, e.FullPath);
            vigia.Renamed += (_, e) => _ = AvisarQuandoPronta(host, e.FullPath);
            vigia.EnableRaisingEvents = true;
            var prontas = Directory.EnumerateFiles(saida).Select(Path.GetFileNameWithoutExtension).ToHashSet(StringComparer.OrdinalIgnoreCase);
            // o que já estava na pasta e ainda não tem versão pronta
            var pendentes = Directory.EnumerateFiles(pasta).Where(EhFoto)
                .Where(f => !prontas.Any(p => p!.StartsWith(Path.GetFileNameWithoutExtension(f), StringComparison.OrdinalIgnoreCase)))
                .OrderBy(File.GetCreationTime).ToList();
            return Results.Ok(new { caminho = pasta, saida, pendentes });
        });

        g.MapPost("/pasta/parar", () =>
        {
            Parar();
            return Results.NoContent();
        });

        g.MapPost("/pasta/ler", (CaminhoRequest req) =>
        {
            var c = Path.GetFullPath(req.Caminho);
            if (pasta is null || !string.Equals(Path.GetDirectoryName(c), pasta, StringComparison.OrdinalIgnoreCase) || !EhFoto(c))
                return Results.Json(new { error = "Fora da pasta monitorada." }, statusCode: 403);
            return File.Exists(c) ? Results.File(c, "application/octet-stream", Path.GetFileName(c)) : Results.NotFound();
        });

        g.MapPost("/pasta/gravar", (GravarProntaRequest req) =>
        {
            if (pasta is null) return Results.Json(new { error = "Nenhuma pasta monitorada." }, statusCode: 409);
            if (!DataUrl.Tentar(req.Dados, out var bytes)) return Results.BadRequest(new { error = "Arquivo inválido." });
            var destino = Path.Combine(pasta, Saida, ArquivoProjeto.NomeDeArquivo(req.Nome));
            File.WriteAllBytes(destino, bytes);
            return Results.Ok(new { caminho = destino });
        });
    }

    private static bool EhFoto(string caminho) => Extensoes.Contains(Path.GetExtension(caminho).ToLowerInvariant());

    private static void Parar()
    {
        vigia?.Dispose();
        vigia = null;
        pasta = null;
    }

    /// <summary>O arquivo aparece antes de terminar de ser copiado: espera ele
    /// abrir pra leitura exclusiva (a cópia acabou) antes de avisar.</summary>
    private static async Task AvisarQuandoPronta(DesktopHost host, string caminho)
    {
        if (!EhFoto(caminho)) return;
        for (var i = 0; i < 60; i++)
        {
            try
            {
                using (File.Open(caminho, FileMode.Open, FileAccess.Read, FileShare.None)) { }
                host.Postar(new { tipo = "pasta-foto", caminho });
                return;
            }
            catch (FileNotFoundException)
            {
                return;
            }
            catch (IOException)
            {
                await Task.Delay(500);
            }
        }
    }
}
