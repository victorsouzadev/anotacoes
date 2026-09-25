using System.IO;
using System.Printing;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Xps;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace EditorImagens.Desktop;

public record ImprimirRequest(string Impressora, string Imagem, double LarguraMm, double AlturaMm, int Copias = 1);
public record CalibracaoPaginaRequest(string Impressora, double LarguraMm, double AlturaMm);
public record CalibracaoRequest(string Impressora, double DxMm, double DyMm, double EscalaX, double EscalaY);
public record ImpressoraDto(string Nome, bool Padrao, Calibracao Calibracao);

/// <summary>
/// Impressão direta em tamanho real. O navegador imprime o PDF "ajustado à
/// página" por padrão, e 2% de escala já desencontra o corte; aqui a folha vai
/// pro driver com a medida exata, mais a calibração de cada impressora (o
/// quanto ela desloca e estica o que imprime).
/// </summary>
public static class Impressao
{
    /// <summary>Onde fica a cruz da página de calibração e o tamanho das réguas, em mm.</summary>
    public const double CruzMm = 20, ReguaHMm = 150, ReguaVMm = 200;

    public static void MapImpressaoEndpoints(this RouteGroupBuilder g)
    {
        g.MapGet("/impressoras", async (DesktopHost host) => Results.Ok(await host.NaJanela(() =>
        {
            using var servidor = new LocalPrintServer();
            var padrao = TentarPadrao(servidor);
            return servidor.GetPrintQueues([EnumeratedPrintQueueTypes.Local, EnumeratedPrintQueueTypes.Connections])
                .Select(f => f.FullName)
                .OrderBy(n => n)
                .Select(n => new ImpressoraDto(n, n == padrao, host.Config.Calibracoes.GetValueOrDefault(n) ?? new Calibracao()))
                .ToList();
        })));

        g.MapPost("/imprimir", async (ImprimirRequest req, DesktopHost host) =>
        {
            if (!DataUrl.Tentar(req.Imagem, out var bytes)) return Results.BadRequest(new { error = "Imagem inválida." });
            if (req.LarguraMm is <= 0 or > 1500 || req.AlturaMm is <= 0 or > 1500) return Results.BadRequest(new { error = "Tamanho de página inválido." });
            var cal = host.Config.Calibracoes.GetValueOrDefault(req.Impressora) ?? new Calibracao();
            return await host.NaJanela(() =>
            {
                var imagem = Decodificar(bytes);
                var img = new Image { Source = imagem, Stretch = Stretch.Fill, Width = Dip(req.LarguraMm * cal.EscalaX), Height = Dip(req.AlturaMm * cal.EscalaY) };
                RenderOptions.SetBitmapScalingMode(img, BitmapScalingMode.HighQuality);
                return Enviar(req.Impressora, req.LarguraMm, req.AlturaMm, Math.Clamp(req.Copias, 1, 99), (img, Dip(cal.DxMm), Dip(cal.DyMm)));
            });
        });

        g.MapPost("/imprimir-calibracao", async (CalibracaoPaginaRequest req, DesktopHost host) =>
            await host.NaJanela(() => Enviar(req.Impressora, req.LarguraMm, req.AlturaMm, 1, PaginaCalibracao())));

        g.MapPut("/calibracao", (CalibracaoRequest req, DesktopHost host) =>
        {
            if (Math.Abs(req.DxMm) > 30 || Math.Abs(req.DyMm) > 30 || req.EscalaX is < 0.9 or > 1.1 || req.EscalaY is < 0.9 or > 1.1)
                return Results.BadRequest(new { error = "Valores fora do razoável: confira as medidas." });
            host.Config.Calibracoes[req.Impressora] = new Calibracao { DxMm = req.DxMm, DyMm = req.DyMm, EscalaX = req.EscalaX, EscalaY = req.EscalaY };
            host.Config.Salvar();
            return Results.NoContent();
        });
    }

    private static double Dip(double mm) => mm / 25.4 * 96;

    private static string? TentarPadrao(LocalPrintServer s)
    {
        try
        {
            return LocalPrintServer.GetDefaultPrintQueue().FullName;
        }
        catch (PrintQueueException)
        {
            return null;
        }
    }

    private static BitmapSource Decodificar(byte[] bytes)
    {
        var bmp = new BitmapImage();
        bmp.BeginInit();
        bmp.CacheOption = BitmapCacheOption.OnLoad;
        bmp.StreamSource = new MemoryStream(bytes);
        bmp.EndInit();
        bmp.Freeze();
        return bmp;
    }

    /// <summary>
    /// Uma página do tamanho do papel (FixedPage: coordenadas a partir da borda
    /// do papel, não da margem da impressora), com o conteúdo na posição dada.
    /// </summary>
    private static IResult Enviar(string impressora, double larguraMm, double alturaMm, int copias, (UIElement conteudo, double x, double y) item)
    {
        using var servidor = new LocalPrintServer();
        var fila = servidor.GetPrintQueues([EnumeratedPrintQueueTypes.Local, EnumeratedPrintQueueTypes.Connections])
            .FirstOrDefault(f => f.FullName == impressora);
        if (fila is null) return Results.NotFound(new { error = $"Não achei a impressora \"{impressora}\"." });

        var paisagem = larguraMm > alturaMm;
        var ticket = fila.DefaultPrintTicket.Clone();
        // O papel vai sempre em pé no driver; a folha deitada vira orientação paisagem.
        ticket.PageMediaSize = new PageMediaSize(Dip(Math.Min(larguraMm, alturaMm)), Dip(Math.Max(larguraMm, alturaMm)));
        ticket.PageOrientation = paisagem ? PageOrientation.Landscape : PageOrientation.Portrait;
        ticket.CopyCount = copias;
        ticket.PageScalingFactor = 100;
        var validado = fila.MergeAndValidatePrintTicket(fila.UserPrintTicket ?? fila.DefaultPrintTicket, ticket).ValidatedPrintTicket;

        var pagina = new FixedPage { Width = Dip(larguraMm), Height = Dip(alturaMm), Background = Brushes.White };
        FixedPage.SetLeft(item.conteudo, item.x);
        FixedPage.SetTop(item.conteudo, item.y);
        pagina.Children.Add(item.conteudo);
        var tamanho = new Size(pagina.Width, pagina.Height);
        pagina.Measure(tamanho);
        pagina.Arrange(new Rect(tamanho));
        pagina.UpdateLayout();
        var conteudo = new PageContent();
        ((System.Windows.Markup.IAddChild)conteudo).AddChild(pagina);
        var doc = new FixedDocument();
        doc.DocumentPaginator.PageSize = tamanho;
        doc.Pages.Add(conteudo);

        try
        {
            XpsDocumentWriter escritor = PrintQueue.CreateXpsDocumentWriter(fila);
            escritor.Write(doc, validado);
        }
        catch (Exception ex) when (ex is PrintJobException or PrintQueueException or InvalidOperationException)
        {
            return Results.Json(new { error = $"A impressora recusou: {ex.Message}" }, statusCode: 409);
        }
        return Results.Ok(new { impressora, paisagem });
    }

    /// <summary>
    /// Cruz a 20 mm das bordas de cima e da esquerda, régua de 150 mm na
    /// horizontal e de 200 mm na vertical, saindo da cruz. Mede-se com régua
    /// e digita no editor; ele calcula o deslocamento e a escala.
    /// </summary>
    private static (UIElement, double, double) PaginaCalibracao()
    {
        var c = new Canvas();
        var tinta = Brushes.Black;
        var k = Dip(1);
        void Linha(double x1, double y1, double x2, double y2, double esp = 0.25) =>
            c.Children.Add(new Line { X1 = x1 * k, Y1 = y1 * k, X2 = x2 * k, Y2 = y2 * k, Stroke = tinta, StrokeThickness = esp * k });
        void Texto(string t, double x, double y, double tam = 3.2)
        {
            var tb = new TextBlock { Text = t, FontSize = tam * k, Foreground = tinta, FontFamily = new FontFamily("Segoe UI") };
            Canvas.SetLeft(tb, x * k);
            Canvas.SetTop(tb, y * k);
            c.Children.Add(tb);
        }
        // cruz
        Linha(CruzMm - 8, CruzMm, CruzMm + 8, CruzMm);
        Linha(CruzMm, CruzMm - 8, CruzMm, CruzMm + 8);
        // réguas com marcas a cada 10 mm
        Linha(CruzMm, CruzMm, CruzMm + ReguaHMm, CruzMm, 0.35);
        Linha(CruzMm, CruzMm, CruzMm, CruzMm + ReguaVMm, 0.35);
        for (var d = 10; d <= ReguaHMm; d += 10) Linha(CruzMm + d, CruzMm - (d % 50 == 0 ? 4 : 2), CruzMm + d, CruzMm);
        for (var d = 10; d <= ReguaVMm; d += 10) Linha(CruzMm - (d % 50 == 0 ? 4 : 2), CruzMm + d, CruzMm, CruzMm + d);
        Texto("A — da borda esquerda do papel até o centro da cruz (o certo é 20 mm)", CruzMm + 6, CruzMm + 6);
        Texto("B — da borda de cima do papel até o centro da cruz (o certo é 20 mm)", CruzMm + 6, CruzMm + 11);
        Texto($"C — comprimento da régua de cima (o certo é {ReguaHMm:0} mm)", CruzMm + 6, CruzMm + 16);
        Texto($"D — comprimento da régua da esquerda (o certo é {ReguaVMm:0} mm)", CruzMm + 6, CruzMm + 21);
        Texto("Meça com régua, em milímetros, e digite os quatro números no editor.", CruzMm + 6, CruzMm + 30, 3.6);
        Texto("Imprima com o mesmo papel e a mesma bandeja que vai usar nos trabalhos.", CruzMm + 6, CruzMm + 36, 3.2);
        return (c, 0, 0);
    }
}

public static class DataUrl
{
    /// <summary>Aceita "data:...;base64,xxx" ou só o base64.</summary>
    public static bool Tentar(string? valor, out byte[] bytes)
    {
        bytes = [];
        if (string.IsNullOrEmpty(valor)) return false;
        var i = valor.IndexOf(',');
        var b64 = valor.StartsWith("data:", StringComparison.Ordinal) && i > 0 ? valor[(i + 1)..] : valor;
        try
        {
            bytes = Convert.FromBase64String(b64);
            return bytes.Length > 0;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
