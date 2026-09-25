using System.IO;
using System.Windows;
using System.Windows.Threading;
using EditorImagens.Ia;

namespace EditorImagens.Desktop;

public sealed class App : Application
{
    private readonly string? arquivoInicial;
    private readonly InstanciaUnica instancia;
    private Servidor? servidor;
    private ModelosLocais? modelos;

    public App(string? arquivoInicial, InstanciaUnica instancia)
    {
        this.arquivoInicial = arquivoInicial;
        this.instancia = instancia;
        ShutdownMode = ShutdownMode.OnMainWindowClose;
        DispatcherUnhandledException += (_, e) =>
        {
            Registro.Erro(e.Exception);
            MessageBox.Show($"Algo deu errado:\n\n{e.Exception.Message}\n\nO detalhe ficou em {Registro.Arquivo}.",
                "Editor de Imagens", MessageBoxButton.OK, MessageBoxImage.Error);
            e.Handled = true;
        };
    }

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        // Mantém o duplo clique no .edimg apontando pra versão instalada agora.
        Associacao.Registrar();
        var config = Configuracao.Carregar();
        modelos = new ModelosLocais(Pastas.Modelos);
        var host = new DesktopHost(config, Dispatcher, modelos, arquivoInicial);
        try
        {
            servidor = await Servidor.IniciarAsync(host);
        }
        catch (Exception ex)
        {
            Registro.Erro(ex);
            MessageBox.Show($"Não consegui iniciar o editor:\n\n{ex.Message}", "Editor de Imagens", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
            return;
        }

        var janela = new MainWindow(servidor, host);
        host.Janela = janela;
        MainWindow = janela;
        janela.Show();

        instancia.Recebido += caminho => Dispatcher.BeginInvoke(() => janela.AbrirDeFora(caminho));
        instancia.Escutar();
        Atualizacao.VerificarEmSegundoPlano();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try
        {
            servidor?.DisposeAsync().AsTask().Wait(TimeSpan.FromSeconds(4));
        }
        catch (AggregateException) { }
        modelos?.Dispose();
        base.OnExit(e);
    }
}

/// <summary>Erros inesperados num arquivo de texto na pasta de dados.</summary>
public static class Registro
{
    public static string Arquivo => Path.Combine(Pastas.Dados, "erros.log");

    public static void Erro(Exception ex) => Escrever(ex.ToString());

    public static void Aviso(string texto) => Escrever(texto);

    private static void Escrever(string texto)
    {
        try
        {
            File.AppendAllText(Arquivo, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {texto}\r\n\r\n");
        }
        catch (IOException) { }
    }
}
