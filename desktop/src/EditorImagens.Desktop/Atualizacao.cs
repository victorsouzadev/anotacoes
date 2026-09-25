using System.Reflection;
using Velopack;
using Velopack.Sources;

namespace EditorImagens.Desktop;

/// <summary>
/// Procura versão nova quando há internet: no site (/downloads/windows, o
/// mesmo lugar do botão de baixar), ou nas Releases do GitHub se o programa foi
/// compilado sem o endereço. Sem internet (o normal aqui) não faz nada. Achando,
/// baixa em segundo plano e aplica quando o programa fechar — sem perguntar e
/// sem interromper o trabalho.
/// </summary>
public static class Atualizacao
{
    public const string Repositorio = "https://github.com/victorsouzadev/anotacoes";

    public static string? UrlDoSite { get; } = typeof(Atualizacao).Assembly
        .GetCustomAttributes<AssemblyMetadataAttribute>()
        .FirstOrDefault(a => a.Key == "UpdateUrl")?.Value;

    public static void VerificarEmSegundoPlano() => _ = Task.Run(async () =>
    {
        try
        {
            IUpdateSource fonte = string.IsNullOrEmpty(UrlDoSite)
                ? new GithubSource(Repositorio, null, false)
                : new SimpleWebSource(UrlDoSite);
            var um = new UpdateManager(fonte);
            if (!um.IsInstalled) return; // rodando do Visual Studio / pasta solta
            var nova = await um.CheckForUpdatesAsync();
            if (nova is null) return;
            await um.DownloadUpdatesAsync(nova);
            um.WaitExitThenApplyUpdates(nova.TargetFullRelease, silent: true, restart: false);
        }
        catch (Exception ex)
        {
            // offline ou servidor fora: fica pra próxima abertura
            Registro.Aviso("Atualização: " + ex.Message);
        }
    });
}
