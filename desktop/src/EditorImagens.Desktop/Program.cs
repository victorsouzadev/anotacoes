using System.IO;
using Velopack;

namespace EditorImagens.Desktop;

public static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        // Instalação, atualização e desinstalação passam por aqui antes de tudo.
        VelopackApp.Build()
            .OnAfterInstallFastCallback(_ => Associacao.Registrar())
            .OnAfterUpdateFastCallback(_ => Associacao.Registrar())
            .OnBeforeUninstallFastCallback(_ => Associacao.Remover())
            .Run();

        var arquivo = args.Select(Path.GetFullPath).FirstOrDefault(File.Exists);

        // Uma janela só: abrir outro .edimg com o programa já aberto manda o
        // caminho pra janela que existe, em vez de subir um segundo servidor.
        using var instancia = new InstanciaUnica();
        if (!instancia.Primeira)
        {
            instancia.Encaminhar(arquivo ?? "");
            return;
        }

        var app = new App(arquivo, instancia);
        app.Run();
    }
}
