using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.Win32;

namespace EditorImagens.Desktop;

/// <summary>
/// A janela: um WebView2 (o Edge embutido do Windows) com o editor servido pelo
/// servidor local. Os downloads da página viram o "Salvar como" do Windows.
/// </summary>
public sealed class MainWindow : Window
{
    private readonly Servidor servidor;
    private readonly DesktopHost host;
    private readonly WebView2 web = new();
    private bool podeFechar;
    // Vários downloads em sequência (um lote, por exemplo) perguntam a pasta uma
    // vez só: os seguintes vão pra mesma pasta.
    private DateTime ultimoDialogo = DateTime.MinValue;

    public MainWindow(Servidor servidor, DesktopHost host)
    {
        this.servidor = servidor;
        this.host = host;
        Title = "Editor de Imagens";
        Icon = BitmapFrame.Create(new Uri("pack://application:,,,/icone.ico"));
        Width = host.Config.JanelaLargura ?? 1400;
        Height = host.Config.JanelaAltura ?? 900;
        MinWidth = 900;
        MinHeight = 600;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        if (host.Config.JanelaMaximizada) WindowState = WindowState.Maximized;
        Content = web;
        Loaded += async (_, _) => await IniciarAsync();
    }

    private async Task IniciarAsync()
    {
        CoreWebView2Environment env;
        try
        {
            env = await CoreWebView2Environment.CreateAsync(null, Pastas.WebView);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(this, "Falta o componente WebView2 do Windows. Instale o \"Microsoft Edge WebView2 Runtime\" (grátis, da Microsoft) e abra de novo.",
                Title, MessageBoxButton.OK, MessageBoxImage.Error);
            AbrirFora("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
            podeFechar = true;
            Close();
            return;
        }
        await web.EnsureCoreWebView2Async(env);
        var core = web.CoreWebView2;
#if !DEBUG
        core.Settings.AreDevToolsEnabled = false;
        // F5, Ctrl+P, Ctrl+F... do navegador: aqui é um programa, não uma aba.
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
#endif
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;

        var desktop = JsonSerializer.Serialize(new { key = servidor.Chave, versao = Versao.Atual }, DesktopHost.Json);
        await core.AddScriptToExecuteOnDocumentCreatedAsync($"window.__editorDesktop = {desktop};");

        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            AbrirFora(e.Uri);
        };
        core.NavigationStarting += (_, e) =>
        {
            if (Interno(e.Uri)) return;
            e.Cancel = true;
            AbrirFora(e.Uri);
        };
        core.DownloadStarting += AoBaixar;
        core.Navigate(servidor.Url + "/imagens");
    }

    private bool Interno(string uri) =>
        uri.StartsWith(servidor.Url + "/", StringComparison.OrdinalIgnoreCase) || uri == servidor.Url
        || uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase)
        || uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase)
        || uri.StartsWith("blob:", StringComparison.OrdinalIgnoreCase);

    private static void AbrirFora(string uri)
    {
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var u) || (u.Scheme != "https" && u.Scheme != "http" && u.Scheme != "mailto")) return;
        Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
    }

    public void Postar(string json) => web.CoreWebView2?.PostWebMessageAsJson(json);

    /// <summary>Outra instância (duplo clique num .edimg) mandou um arquivo.</summary>
    public void AbrirDeFora(string caminho)
    {
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        if (!string.IsNullOrEmpty(caminho)) host.Postar(new { tipo = "abrir", caminho });
    }

    private void AoBaixar(object? sender, CoreWebView2DownloadStartingEventArgs e)
    {
        var adiar = e.GetDeferral();
        Dispatcher.BeginInvoke(() =>
        {
            try
            {
                e.Handled = true; // sem a bandeja de downloads do Edge
                var nome = Path.GetFileName(e.ResultFilePath);
                var pasta = host.Config.UltimaPastaExportacao;
                string? destino;
                if (pasta is not null && Directory.Exists(pasta) && DateTime.UtcNow - ultimoDialogo < TimeSpan.FromSeconds(4))
                {
                    destino = NomeLivre(Path.Combine(pasta, nome));
                }
                else
                {
                    var dlg = new SaveFileDialog
                    {
                        FileName = nome,
                        InitialDirectory = pasta is not null && Directory.Exists(pasta) ? pasta : Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),
                        Filter = Filtro(Path.GetExtension(nome)),
                        AddExtension = true,
                        OverwritePrompt = true,
                    };
                    destino = dlg.ShowDialog(this) == true ? dlg.FileName : null;
                }
                if (destino is null)
                {
                    e.Cancel = true;
                    return;
                }
                ultimoDialogo = DateTime.UtcNow;
                host.Config.UltimaPastaExportacao = Path.GetDirectoryName(destino);
                host.Config.Salvar();
                e.ResultFilePath = destino;
                var op = e.DownloadOperation;
                op.StateChanged += (_, _) =>
                {
                    if (op.State == CoreWebView2DownloadState.Completed)
                        host.Postar(new { tipo = "baixado", caminho = destino, nome = Path.GetFileName(destino) });
                };
            }
            finally
            {
                adiar.Complete();
            }
        });
    }

    private static string NomeLivre(string caminho)
    {
        if (!File.Exists(caminho)) return caminho;
        var dir = Path.GetDirectoryName(caminho)!;
        var nome = Path.GetFileNameWithoutExtension(caminho);
        var ext = Path.GetExtension(caminho);
        for (var i = 2; ; i++)
        {
            var c = Path.Combine(dir, $"{nome} ({i}){ext}");
            if (!File.Exists(c)) return c;
        }
    }

    private static string Filtro(string ext) => ext.ToLowerInvariant() switch
    {
        ".png" => "Imagem PNG|*.png",
        ".jpg" or ".jpeg" => "Imagem JPEG|*.jpg;*.jpeg",
        ".webp" => "Imagem WebP|*.webp",
        ".pdf" => "PDF|*.pdf",
        ".svg" => "SVG|*.svg",
        ".dxf" => "DXF (Silhouette Studio)|*.dxf",
        ".zip" => "Arquivo ZIP|*.zip",
        ".edimg" => "Projeto do Editor de Imagens|*.edimg",
        _ => "Todos os arquivos|*.*",
    } + "|Todos os arquivos|*.*";

    protected override async void OnClosing(CancelEventArgs e)
    {
        if (podeFechar || web.CoreWebView2 is null)
        {
            LembrarTamanho();
            base.OnClosing(e);
            return;
        }
        e.Cancel = true;
        var alterado = "false";
        try
        {
            alterado = await web.CoreWebView2.ExecuteScriptAsync("typeof window.__editorAlterado === 'function' ? window.__editorAlterado() : false");
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.Runtime.InteropServices.COMException) { }
        if (alterado == "true" && MessageBox.Show(this, "Há alterações que não foram salvas. Fechar mesmo assim?", Title,
                MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No) != MessageBoxResult.Yes)
            return;
        podeFechar = true;
        Close();
    }

    private void LembrarTamanho()
    {
        host.Config.JanelaMaximizada = WindowState == WindowState.Maximized;
        if (WindowState == WindowState.Normal)
        {
            host.Config.JanelaLargura = Width;
            host.Config.JanelaAltura = Height;
        }
        host.Config.Salvar();
    }
}

public static class Versao
{
    public static string Atual { get; } =
        typeof(Versao).Assembly.GetName().Version?.ToString(3) ?? "1.0.0";
}
