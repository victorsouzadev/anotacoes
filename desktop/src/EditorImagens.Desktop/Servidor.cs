using System.IO;
using System.Security.Cryptography;
using EditorImagens.Ia;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api;
using Notas.Api.Services.Imagens;
using Notas.Api.Services.Seguranca;

namespace EditorImagens.Desktop;

/// <summary>
/// A mesma API do site, rodando dentro do programa: escuta só em 127.0.0.1,
/// numa porta livre, com o banco SQLite na pasta de dados. Nada sai do PC — as
/// IAs são os modelos locais (<see cref="IaLocalFactory"/>).
/// </summary>
public sealed class Servidor : IAsyncDisposable
{
    private readonly WebApplication app;

    public string Url { get; }
    /// <summary>Muda a cada abertura; só a janela do programa conhece.</summary>
    public string Chave { get; }

    private Servidor(WebApplication app, string url, string chave)
    {
        this.app = app;
        Url = url;
        Chave = chave;
    }

    public static async Task<Servidor> IniciarAsync(DesktopHost host)
    {
        var chave = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        McpLocal.Garantir(host.Config);
        // A porta do MCP é fixa (o Claude guarda o endereço); se outro programa a ocupar, o
        // Estúdio abre do mesmo jeito, só sem o MCP local.
        try
        {
            return await Subir(host, chave, $"http://127.0.0.1:0;http://127.0.0.1:{McpLocal.Porta}", mcp: true);
        }
        catch (IOException)
        {
            return await Subir(host, chave, "http://127.0.0.1:0", mcp: false);
        }
    }

    private static async Task<Servidor> Subir(DesktopHost host, string chave, string urls, bool mcp)
    {
        var app = NotasApp.Build(["--urls", urls], new NotasAppOptions
        {
            Desktop = true,
            ContentRoot = Pastas.Programa,
            WebRoot = Directory.Exists(Pastas.Site) ? Pastas.Site : null,
            ConfigureBuilder = b => b.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["JWT_SECRET"] = host.Config.JwtSecret,
                ["ConnectionStrings:Db"] = $"Data Source={Pastas.Banco}",
                ["Desktop:Enabled"] = "true",
                ["Desktop:Key"] = chave,
                // o projeto inteiro, com as fotos, vai pro disco por aqui
                ["Kestrel:MaxBodyBytes"] = (1024L * 1024 * 1024).ToString(),
                ["Estudio:Raiz"] = Pastas.Estudio,
                ["Estudio:Ffmpeg"] = File.Exists(Pastas.Ffmpeg) ? Pastas.Ffmpeg : "ffmpeg",
                ["Estudio:Ffprobe"] = File.Exists(Pastas.Ffprobe) ? Pastas.Ffprobe : "ffprobe",
                ["Mcp:TokenFile"] = Pastas.McpToken,
            }),
            ConfigureServices = s =>
            {
                s.AddSingleton(host);
                s.AddSingleton(host.Modelos);
                s.AddScoped<IUpscalerFactory, IaLocalFactory>();
                // Chaves de API cifradas pelo Windows (lê também as que o AES gravou antes).
                s.AddSingleton<IProtetorDeSegredos, ProtetorDpapi>();
            },
            MapExtra = a => a.MapDesktopEndpoints(),
        });
        try
        {
            await app.StartAsync();
        }
        catch
        {
            await app.DisposeAsync();
            throw;
        }
        // A janela usa a porta aleatória (só ela conhece a chave); a fixa fica para o MCP.
        var url = app.Urls.First(u => !u.EndsWith($":{McpLocal.Porta}")).TrimEnd('/');
        host.McpAtivo = mcp;
        return new Servidor(app, url, chave);
    }

    public async ValueTask DisposeAsync()
    {
        using var limite = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        try
        {
            await app.StopAsync(limite.Token);
        }
        catch (OperationCanceledException) { }
        await app.DisposeAsync();
    }
}
