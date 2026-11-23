using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api.Data;
using Notas.Api.Services.Agente;
using Notas.Api.Services.Plugins;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>Spec 039 (T007): leituras do núcleo para o plug-in agente.</summary>
public class AgenteNucleoTests : IClassFixture<AgenteNucleoTests.Fabrica>
{
    private const string SegredoAgente = "segredo-de-servico-do-plugin-agente-0123456789";
    private const string SegredoOutro = "segredo-de-servico-de-outro-plugin-0123456789ab";

    public class DeployerFalso : IDeployerDoAgente
    {
        public readonly List<string> Pedidos = [];

        public Task<string?> LogsAsync(string id, int linhas, CancellationToken ct)
        {
            lock (Pedidos) Pedidos.Add($"logs {id} {linhas}");
            return Task.FromResult<string?>("info: subiu\nHost=pg;Password=segredo-falso\nerro: health 500");
        }

        public Task<JsonElement?> HealthAsync(string id, CancellationToken ct)
        {
            lock (Pedidos) Pedidos.Add($"health {id}");
            return Task.FromResult<JsonElement?>(JsonSerializer.SerializeToElement(new { id, status = 500, corpo = new string('x', 5000), ms = 12 }));
        }
    }

    public class Fabrica : TasksApiFactory, IAsyncLifetime
    {
        public readonly DeployerFalso Deployer = new();
        public readonly string Lock = Path.Combine(Path.GetTempPath(), $"plugins-{Guid.NewGuid():N}.lock");

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            File.WriteAllText(Lock, "exemplo: ghcr.io/victorsouzadev/hub-exemplo@v1\n# agente: ghcr.io/victorsouzadev/hub-agente@v1\n");
            builder.UseSetting("Plugins:Lock", Lock);
            builder.ConfigureTestServices(s => s.AddSingleton<IDeployerDoAgente>(Deployer));
        }

        // O construtor dos testes grava pelo EF: a conexão fica no pool e prende o arquivo no Windows.
        Task IAsyncLifetime.DisposeAsync()
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            File.Delete(Lock);
            return base.DisposeAsync();
        }
    }

    private readonly Fabrica _f;

    public AgenteNucleoTests(Fabrica f)
    {
        _f = f;
        using var s = f.Services.CreateScope();
        var db = s.ServiceProvider.GetRequiredService<AppDbContext>();
        foreach (var (id, segredo) in new[] { ("agente", SegredoAgente), ("exemplo", SegredoOutro) })
            if (!db.PluginsEstado.Any(p => p.Id == id))
                db.PluginsEstado.Add(new PluginEstado
                {
                    Id = id, Versao = "v1", NoAr = true,
                    Manifesto = $$"""{"id":"{{id}}","nome":"{{id}}","icone":"grid","rota":"/{{id}}","porta":8080,"health":"/{{id}}/api/health"}""",
                    SegredoServicoHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(segredo))).ToLowerInvariant(),
                });
        db.SaveChanges();
    }

    private HttpClient Cliente(string segredo)
    {
        var c = _f.CreateClient();
        c.DefaultRequestHeaders.Authorization = new("Bearer", segredo);
        return c;
    }

    [Fact]
    public async Task Com_o_segredo_do_agente_le_tudo()
    {
        var c = Cliente(SegredoAgente);
        var plugins = await c.GetFromJsonAsync<JsonElement>("/api/core/agente/plugins");
        Assert.Contains(plugins.EnumerateArray(), p => p.GetProperty("id").GetString() == "exemplo");

        var lockLido = await c.GetFromJsonAsync<JsonElement>("/api/core/agente/lock");
        Assert.Equal(2, lockLido.GetProperty("linhas").GetArrayLength());

        var health = await c.GetFromJsonAsync<JsonElement>("/api/core/agente/plugins/exemplo/health");
        Assert.Equal(500, health.GetProperty("status").GetInt32());
        Assert.Equal(2048, health.GetProperty("corpo").GetString()!.Length);

        var logs = await c.GetStringAsync("/api/core/agente/plugins/exemplo/logs?linhas=5000");
        Assert.DoesNotContain("segredo-falso", logs);
        Assert.Contains("erro: health 500", logs);
        Assert.Contains("logs exemplo 200", _f.Deployer.Pedidos);

        var perm = await c.GetAsync("/api/core/agente/plugins/exemplo/permissoes");
        Assert.Equal(HttpStatusCode.OK, perm.StatusCode);
    }

    [Theory]
    [InlineData("/api/core/agente/plugins")]
    [InlineData("/api/core/agente/lock")]
    [InlineData("/api/core/agente/plugins/exemplo/health")]
    [InlineData("/api/core/agente/plugins/exemplo/logs")]
    [InlineData("/api/core/agente/plugins/exemplo/permissoes")]
    public async Task Outro_plugin_ou_sem_segredo_recebe_401(string rota)
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await Cliente(SegredoOutro).GetAsync(rota)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync(rota)).StatusCode);
    }

    [Theory]
    [InlineData("/api/core/agente/plugins/fora/health")]
    [InlineData("/api/core/agente/plugins/fora/logs")]
    [InlineData("/api/core/agente/plugins/fora/permissoes")]
    public async Task Id_fora_do_lock_recebe_404_sem_chamar_o_deployer(string rota)
    {
        Assert.Equal(HttpStatusCode.NotFound, (await Cliente(SegredoAgente).GetAsync(rota)).StatusCode);
        Assert.DoesNotContain(_f.Deployer.Pedidos, p => p.Contains("fora"));
    }

    [Fact]
    public async Task Nao_existe_rota_de_escrita() =>
        Assert.Equal(HttpStatusCode.MethodNotAllowed,
            (await Cliente(SegredoAgente).PostAsync("/api/core/agente/plugins/exemplo/logs", null)).StatusCode);

    [Fact]
    public void Ids_do_lock_contam_os_comentados() =>
        Assert.Equal(new HashSet<string> { "a", "b" },
            Notas.Api.Endpoints.AgenteNucleoEndpoints.IdsDoLock("a: x/y@1\n# b: x/z@2 # desligado\nlixo\n"));
}
