using Velopack;
using Velopack.Sources;

namespace EditorImagens.Desktop;

/// <summary>
/// Procura versão nova nas Releases do GitHub quando há internet. Sem internet
/// (o normal aqui) não faz nada. Achando, baixa em segundo plano e aplica
/// quando o programa fechar — sem perguntar e sem interromper o trabalho.
/// </summary>
public static class Atualizacao
{
    public const string Repositorio = "https://github.com/victorsouzadev/anotacoes";

    public static void VerificarEmSegundoPlano() => _ = Task.Run(async () =>
    {
        try
        {
            var um = new UpdateManager(new GithubSource(Repositorio, null, false));
            if (!um.IsInstalled) return; // rodando do Visual Studio / pasta solta
            var nova = await um.CheckForUpdatesAsync();
            if (nova is null) return;
            await um.DownloadUpdatesAsync(nova);
            um.WaitExitThenApplyUpdates(nova.TargetFullRelease, silent: true, restart: false);
        }
        catch (Exception ex)
        {
            // offline, GitHub fora, repositório privado: fica pra próxima abertura
            Registro.Aviso("Atualização: " + ex.Message);
        }
    });
}
