using System.IO;
using System.Security.Cryptography;
using EditorImagens.Ia;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api;
using Notas.Api.Services.Imagens;

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
        var app = NotasApp.Build(["--urls", "http://127.0.0.1:0"], new NotasAppOptions
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
            }),
            ConfigureServices = s =>
            {
                s.AddSingleton(host);
                s.AddSingleton(host.Modelos);
                s.AddScoped<IUpscalerFactory, IaLocalFactory>();
            },
            MapExtra = a => a.MapDesktopEndpoints(),
        });
        await app.StartAsync();
        var url = app.Urls.First().TrimEnd('/');
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
