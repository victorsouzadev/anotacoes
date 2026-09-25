using System.Diagnostics;
using System.IO;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Win32;

namespace EditorImagens.Desktop;

public record ArquivoDto(string Nome, string Dados);
public record AbrirStudioRequest(string Titulo, List<ArquivoDto> Arquivos, string? Abrir);

/// <summary>
/// "Abrir no Silhouette Studio": grava o pacote (PNG da impressão, DXF do corte,
/// passo a passo) numa pasta em Documentos e abre o DXF no Studio, se ele
/// estiver instalado. O Studio Basic não tem linha de comando pra mesclar a
/// imagem: ela fica na pasta, que abre junto, pro Arquivo › Mesclar.
/// </summary>
public static class Studio
{
    public static void MapStudioEndpoints(this RouteGroupBuilder g)
    {
        g.MapGet("/studio", () => Results.Ok(new { instalado = Encontrar() is not null }));

        g.MapPost("/abrir-studio", (AbrirStudioRequest req) =>
        {
            if (req.Arquivos is not { Count: > 0 and <= 20 }) return Results.BadRequest(new { error = "Nada pra gravar." });
            var pasta = Path.Combine(Pastas.Documentos("Silhouette"), $"{DateTime.Now:yyyy-MM-dd HHmm} {ArquivoProjeto.NomeDeArquivo(req.Titulo)}");
            Directory.CreateDirectory(pasta);
            foreach (var a in req.Arquivos)
            {
                if (!DataUrl.Tentar(a.Dados, out var bytes)) return Results.BadRequest(new { error = $"Arquivo inválido: {a.Nome}" });
                File.WriteAllBytes(Path.Combine(pasta, ArquivoProjeto.NomeDeArquivo(a.Nome)), bytes);
            }
            Process.Start("explorer.exe", $"\"{pasta}\"");

            var exe = Encontrar();
            var abrir = req.Abrir is null ? null : Path.Combine(pasta, ArquivoProjeto.NomeDeArquivo(req.Abrir));
            if (exe is not null)
            {
                var psi = new ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = pasta };
                if (abrir is not null && File.Exists(abrir)) psi.ArgumentList.Add(abrir);
                Process.Start(psi);
            }
            return Results.Ok(new { pasta, studio = exe is not null });
        });
    }

    /// <summary>Procura o executável do Studio: registro (App Paths) e as pastas de instalação de sempre.</summary>
    public static string? Encontrar()
    {
        foreach (var raiz in new[] { Registry.LocalMachine, Registry.CurrentUser })
        {
            using var k = raiz.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Silhouette Studio.exe");
            if (k?.GetValue("") is string p && File.Exists(p.Trim('"'))) return p.Trim('"');
        }
        foreach (var pf in new[] { Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86 })
        {
            var baseDir = Path.Combine(Environment.GetFolderPath(pf), "Silhouette America");
            if (!Directory.Exists(baseDir)) continue;
            var exe = Directory.EnumerateFiles(baseDir, "Silhouette Studio.exe", SearchOption.AllDirectories).FirstOrDefault();
            if (exe is not null) return exe;
        }
        return null;
    }
}
