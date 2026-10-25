using System.Diagnostics;
using System.IO;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Win32;
using Notas.Api.Endpoints;

namespace EditorImagens.Desktop;

public record SalvarProjetoRequest(string? Caminho, string Nome, string Dados, bool ComoNovo);
public record CaminhoRequest(string Caminho);
public record RecenteDto(string Caminho, string Nome, DateTime? AlteradoEm, bool Existe);

/// <summary>
/// O que só o programa desktop sabe fazer: arquivos no disco, impressora,
/// Silhouette Studio, fontes do Windows, pasta monitorada. Tudo exige a chave
/// da janela (X-Desktop-Key), além de escutar só em 127.0.0.1.
/// </summary>
public static class DesktopEndpoints
{
    public const string ExtensaoProjeto = ".edimg";

    public static void MapDesktopEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/desktop").AddEndpointFilter(async (ctx, next) =>
        {
            var config = ctx.HttpContext.RequestServices.GetRequiredService<IConfiguration>();
            return DesktopAuthEndpoints.ChaveConfere(ctx.HttpContext, config)
                ? await next(ctx)
                : Results.Json(new { error = "Chave do desktop inválida." }, statusCode: 401);
        });

        g.MapGet("/info", (DesktopHost host) => Results.Ok(new
        {
            versao = Versao.Atual,
            motorIa = host.Modelos.Motor,
            recorte = host.Modelos.TemRecorte,
            ampliacao = host.Modelos.TemAmpliacao,
            arquivoInicial = host.ConsumirArquivoInicial(),
        }));

        // ---------- projetos (.edimg) ----------

        g.MapPost("/projeto/abrir", async (DesktopHost host) =>
        {
            var caminho = await host.NaJanela(() =>
            {
                var dlg = new OpenFileDialog
                {
                    Filter = "Projeto do Editor de Imagens|*" + ExtensaoProjeto,
                    InitialDirectory = PastaProjetos(host),
                };
                return dlg.ShowDialog(host.Janela) == true ? dlg.FileName : null;
            });
            return caminho is null ? Results.NoContent() : Ler(host, caminho);
        });

        g.MapPost("/projeto/ler", (CaminhoRequest req, DesktopHost host) => Ler(host, req.Caminho));

        g.MapPost("/projeto/salvar", async (SalvarProjetoRequest req, DesktopHost host) =>
        {
            var caminho = req.ComoNovo || string.IsNullOrEmpty(req.Caminho) ? null : req.Caminho;
            if (caminho is not null && !caminho.EndsWith(ExtensaoProjeto, StringComparison.OrdinalIgnoreCase))
                return Results.BadRequest(new { error = "Só dá pra salvar projeto em arquivo .edimg." });
            caminho ??= await host.NaJanela(() =>
            {
                var dlg = new SaveFileDialog
                {
                    Filter = "Projeto do Editor de Imagens|*" + ExtensaoProjeto,
                    FileName = ArquivoProjeto.NomeDeArquivo(req.Nome) + ExtensaoProjeto,
                    InitialDirectory = PastaProjetos(host),
                    AddExtension = true,
                    OverwritePrompt = true,
                };
                return dlg.ShowDialog(host.Janela) == true ? dlg.FileName : null;
            });
            if (caminho is null) return Results.NoContent();
            try
            {
                ArquivoProjeto.Gravar(caminho, req.Nome, req.Dados, Versao.Atual);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                return Results.Json(new { error = $"Não consegui gravar o arquivo: {ex.Message}" }, statusCode: 409);
            }
            host.Config.UltimaPastaProjetos = Path.GetDirectoryName(caminho);
            host.Config.LembrarRecente(caminho);
            return Results.Ok(new { caminho, nome = req.Nome });
        });

        g.MapGet("/recentes", (DesktopHost host) => Results.Ok(host.Config.Recentes.Select(c =>
        {
            var existe = File.Exists(c);
            return new RecenteDto(c, Path.GetFileNameWithoutExtension(c), existe ? File.GetLastWriteTime(c) : null, existe);
        })));

        g.MapPost("/recentes/remover", (CaminhoRequest req, DesktopHost host) =>
        {
            host.Config.Recentes.RemoveAll(r => string.Equals(r, req.Caminho, StringComparison.OrdinalIgnoreCase));
            host.Config.Salvar();
            return Results.NoContent();
        });

        g.MapPost("/mostrar", (CaminhoRequest req) =>
        {
            if (File.Exists(req.Caminho))
                Process.Start("explorer.exe", $"/select,\"{req.Caminho}\"");
            else if (Directory.Exists(req.Caminho))
                Process.Start("explorer.exe", $"\"{req.Caminho}\"");
            else
                return Results.NotFound(new { error = "O arquivo não está mais lá." });
            return Results.NoContent();
        });

        g.MapImpressaoEndpoints();
        g.MapStudioEndpoints();
        g.MapFontesEndpoints();
        g.MapPastaMonitoradaEndpoints();
    }

    private static string PastaProjetos(DesktopHost host) =>
        host.Config.UltimaPastaProjetos is { } p && Directory.Exists(p) ? p : Pastas.Documentos("Projetos");

    private static IResult Ler(DesktopHost host, string caminho)
    {
        if (!caminho.EndsWith(ExtensaoProjeto, StringComparison.OrdinalIgnoreCase))
            return Results.BadRequest(new { error = "Isso não é um projeto do editor (.edimg)." });
        if (!File.Exists(caminho))
            return Results.NotFound(new { error = "O arquivo não está mais lá." });
        try
        {
            var projeto = ArquivoProjeto.Ler(caminho);
            host.Config.LembrarRecente(caminho);
            return Results.Ok(projeto);
        }
        catch (Exception ex) when (ex is InvalidDataException or JsonException or IOException)
        {
            return Results.Json(new { error = "Não consegui ler esse projeto: o arquivo está danificado ou é de outro programa." }, statusCode: 422);
        }
    }
}
