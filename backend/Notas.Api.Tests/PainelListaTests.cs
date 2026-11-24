using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api.Auth;
using Notas.Api.Data;
using Notas.Api.Services.Painel;
using Notas.Api.Services.Plugins;
using Notas.Api.Services.Sites;
using Xunit;

namespace Notas.Api.Tests;

public class GithubFalso : IGithubDoPainel
{
    public bool Ligado { get; set; } = true;
    public bool ForaDoAr { get; set; }
    public bool Travado { get; set; }

    private async Task<T> R<T>(T v)
    {
        // Ignora o cancelamento de propósito: a lista não pode ficar presa.
        if (Travado) await Task.Delay(TimeSpan.FromSeconds(30));
        return ForaDoAr ? throw new GithubException("O GitHub não respondeu.") : v;
    }

    public Task<List<string>> IdsAsync(CancellationToken ct) => R<List<string>>(["exemplo2", "novo"]);
    public Task<List<CommitDoPlugin>> CommitsAsync(string id, CancellationToken ct) =>
        R<List<CommitDoPlugin>>([new("abc1234", "Muda", null), new("bbbbbbb", "Antes", null), new("ccccccc", "Vermelho", null)]);
    public Task<Dictionary<string, CiDoCommit>> CiAsync(string id, CancellationToken ct) => R(new Dictionary<string, CiDoCommit>
    {
        ["abc1234"] = new(Etapas.Feita), ["bbbbbbb"] = new(Etapas.Feita), ["ccccccc"] = new(Etapas.Falhou),
    });
    public Task<string?> ManifestoAsync(string id, string versao, CancellationToken ct) => R<string?>($$"""
        {"id":"{{id}}","nome":"Ferramenta nova","icone":"grid","contrato":1,"rota":"/{{id}}","porta":8080,"health":"/{{id}}/h",
         "tabelas":{"prefixo":"{{id}}_"} }
        """);
}

public class DeployerDoPainelFalso : IDeployerDoPainel
{
    public bool ForaDoAr { get; set; }

    private Task<T> R<T>(T v) => ForaDoAr ? Task.FromException<T>(new DeployerException("Deployer inacessível")) : Task.FromResult(v);

    public Task<PreparoDoPlugin> PreparoAsync(string id, CancellationToken ct) => R(new PreparoDoPlugin(false, false, null, false, false, null));
    public Task<bool> ImagemAsync(string id, string versao, CancellationToken ct) => R(versao == "abc1234");
    public Task<RecursosDoDeployer> RecursosAsync(CancellationToken ct) => R(new RecursosDoDeployer(1967, 200, [new("notas", 45, 256)], 17, 60));
}

public class FabricaDoPainel : TasksApiFactory, IAsyncLifetime
{
    public const string Admin = "dono@example.com";
    public const string Token = "github_pat_segredo_do_painel";
    public const string SegredoAgente = "segredo-de-servico-do-agente-no-painel-0123456789";
    public readonly GithubFalso Github = new();
    public readonly DeployerDoPainelFalso Deployer = new();
    private readonly string _pasta = Directory.CreateTempSubdirectory("painel").FullName;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        File.WriteAllText(Path.Combine(_pasta, "plugins.lock"),
            "notas: ghcr.io/victorsouzadev/hub-notas@1111111\nquebrado: ghcr.io/victorsouzadev/hub-quebrado@2222222\n" +
            "# velho: ghcr.io/victorsouzadev/hub-velho@abc1234\n# exemplo: ghcr.io/victorsouzadev/hub-exemplo@0000000\n");
        File.WriteAllText(Path.Combine(_pasta, "estado.json"), """
            {"notas":{"id":"notas","imagem":"x","versao":"1111111","versaoAnterior":"0000000","noAr":true,"ativo":true,"segredoServicoHash":"hash-secreto",
              "manifesto":{"id":"notas","nome":"Notas","icone":"pen","contrato":1,"rota":"/notas","porta":8080,"health":"/notas/h","tabelas":{"prefixo":"notas_"}}},
             "quebrado":{"id":"quebrado","imagem":"x","versao":"2222222","manifesto":null,"noAr":false,"ativo":true,"ultimaFalha":"2222222: não baixou a imagem"}}
            """);
        builder.UseSetting("Plugins:Lock", Path.Combine(_pasta, "plugins.lock"));
        builder.UseSetting("Plugins:Estado", Path.Combine(_pasta, "estado.json"));
        builder.UseSetting("Painel:Administradores", Admin);
        builder.UseSetting("Painel:GithubLeitura", Token);
        builder.ConfigureTestServices(s =>
        {
            s.AddSingleton<IGithubDoPainel>(Github);
            s.AddSingleton<IDeployerDoPainel>(Deployer);
            // O health de verdade não existe aqui: sem a rodada, vale o estado do deployer.
            var health = s.Single(d => d.ImplementationType == typeof(CacheDeHealth));
            s.Remove(health);
        });
    }

    public async Task<HttpClient> Entrar(string email)
    {
        var c = CreateClient();
        var corpo = new { email, password = "Sup3rSecret!" };
        var r = await c.PostAsJsonAsync("/api/auth/register", corpo);
        if (!r.IsSuccessStatusCode) r = await c.PostAsJsonAsync("/api/auth/login", corpo);
        var j = await r.Content.ReadFromJsonAsync<JsonElement>();
        c.DefaultRequestHeaders.Authorization = new("Bearer", j.GetProperty("accessToken").GetString());
        return c;
    }

    Task IAsyncLifetime.DisposeAsync()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(_pasta, true);
        return base.DisposeAsync();
    }
}

/// <summary>Spec 040 (T005): quem entra no painel.</summary>
public class PainelAcessoTests(FabricaDoPainel f) : IClassFixture<FabricaDoPainel>
{
    /// <summary>Todas as rotas do grupo, inclusive as que vierem depois.</summary>
    private List<(string Metodo, string Rota)> Rotas() => f.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
        .Where(e => (e.RoutePattern.RawText ?? "").TrimStart('/').StartsWith("api/painel"))
        .SelectMany(e => e.Metadata.GetMetadata<HttpMethodMetadata>()!.HttpMethods.Select(m =>
            (m, "/" + e.RoutePattern.RawText!.TrimStart('/').Replace("{id}", "notas").Replace("{op}", "x"))))
        .ToList();

    private static async Task<HttpStatusCode> Chamar(HttpClient c, (string Metodo, string Rota) r)
    {
        var req = new HttpRequestMessage(new HttpMethod(r.Metodo), r.Rota);
        if (r.Metodo != "GET") req.Content = JsonContent.Create(new { });
        return (await c.SendAsync(req)).StatusCode;
    }

    [Fact]
    public async Task Sem_sessao_com_token_de_mcp_ou_segredo_de_servico_recebe_401()
    {
        await f.Entrar(FabricaDoPainel.Admin);
        string mcp;
        using (var s = f.Services.CreateScope())
        {
            var db = s.ServiceProvider.GetRequiredService<AppDbContext>();
            var dono = db.Users.Single(u => u.Email == FabricaDoPainel.Admin);
            mcp = s.ServiceProvider.GetRequiredService<TokenService>().CreateAccessToken(dono.Id, dono.Email, "agente");
            if (!db.PluginsEstado.Any(p => p.Id == "agente"))
            {
                db.PluginsEstado.Add(new PluginEstado
                {
                    Id = "agente", Versao = "v1", NoAr = true,
                    Manifesto = """{"id":"agente","nome":"agente","icone":"grid","rota":"/agente","porta":8080,"health":"/agente/h"}""",
                    SegredoServicoHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(FabricaDoPainel.SegredoAgente))).ToLowerInvariant(),
                });
                db.SaveChanges();
            }
        }
        var rotas = Rotas();
        Assert.True(rotas.Count >= 3);
        foreach (var r in rotas)
            foreach (var t in new[] { null, mcp, FabricaDoPainel.SegredoAgente })
            {
                var c = f.CreateClient();
                if (t is not null) c.DefaultRequestHeaders.Authorization = new("Bearer", t);
                Assert.Equal(HttpStatusCode.Unauthorized, await Chamar(c, r));
            }
    }

    [Fact]
    public async Task Outra_conta_recebe_403_em_tudo_menos_na_permissao()
    {
        var c = await f.Entrar($"p_{Guid.NewGuid():N}@example.com");
        foreach (var r in Rotas().Where(r => !r.Rota.EndsWith("/permissao")))
            Assert.Equal(HttpStatusCode.Forbidden, await Chamar(c, r));
        Assert.False((await c.GetFromJsonAsync<JsonElement>("/api/painel/plugins/permissao")).GetProperty("administrador").GetBoolean());
    }

    [Fact]
    public async Task Administrador_entra()
    {
        var c = await f.Entrar(FabricaDoPainel.Admin);
        Assert.True((await c.GetFromJsonAsync<JsonElement>("/api/painel/plugins/permissao")).GetProperty("administrador").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/painel/plugins")).StatusCode);
    }

    [Fact]
    public void Nesta_entrega_so_ha_leitura() => Assert.All(Rotas(), r => Assert.Equal("GET", r.Metodo));
}

/// <summary>Spec 040 (T012): a lista junta as fontes e sobrevive a cada uma fora do ar.</summary>
public class PainelListaTests(FabricaDoPainel f) : IClassFixture<FabricaDoPainel>
{
    private async Task<JsonElement> Lista()
    {
        var c = await f.Entrar(FabricaDoPainel.Admin);
        var texto = await c.GetStringAsync("/api/painel/plugins");
        Assert.DoesNotContain(FabricaDoPainel.Token, texto);
        Assert.DoesNotContain("hash-secreto", texto);
        return JsonDocument.Parse(texto).RootElement;
    }

    private static JsonElement Do(JsonElement l, string id) => l.GetProperty("plugins").EnumerateArray().Single(p => p.GetProperty("id").GetString() == id);

    private static string Situacao(JsonElement l, string id) => Do(l, id).GetProperty("situacao").GetString()!;

    private static string Etapa(JsonElement l, string id, string nome) =>
        Do(l, id).GetProperty("etapas").EnumerateArray().Single(e => e.GetProperty("nome").GetString() == nome).GetProperty("estado").GetString()!;

    [Fact]
    public async Task Junta_registro_estado_github_e_banco()
    {
        var l = await Lista();
        Assert.Equal(("no-ar", "com-falha", "desligado", "incompleto"),
            (Situacao(l, "notas"), Situacao(l, "quebrado"), Situacao(l, "velho"), Situacao(l, "novo")));
        Assert.Equal(("feita", "feita", "pendente"), (Etapa(l, "novo", "imagem"), Etapa(l, "novo", "manifesto"), Etapa(l, "novo", "papel")));
        Assert.Equal("Ferramenta nova", Do(l, "novo").GetProperty("nome").GetString());
        Assert.Equal(45, Do(l, "notas").GetProperty("memoriaMb").GetInt32());
        Assert.DoesNotContain(l.GetProperty("plugins").EnumerateArray(), p => p.GetProperty("id").GetString() == "exemplo");
        Assert.Single(l.GetProperty("recursos").GetProperty("avisos").EnumerateArray());
    }

    [Fact]
    public async Task Sem_github_a_lista_do_registro_continua()
    {
        f.Github.ForaDoAr = true;
        try
        {
            var l = await Lista();
            Assert.Equal("no-ar", Situacao(l, "notas"));
            Assert.Equal("nao-conferida", Etapa(l, "velho", "ci"));
            Assert.Contains(l.GetProperty("avisos").EnumerateArray(), a => a.GetString()!.Contains("GitHub"));
        }
        finally { f.Github.ForaDoAr = false; }
    }

    [Fact]
    public async Task Sem_deployer_a_lista_continua()
    {
        f.Deployer.ForaDoAr = true;
        try
        {
            var l = await Lista();
            Assert.Equal("no-ar", Situacao(l, "notas"));
            Assert.Equal(("nao-conferida", "nao-conferida", "feita"), (Etapa(l, "novo", "papel"), Etapa(l, "novo", "imagem"), Etapa(l, "novo", "ci")));
        }
        finally { f.Deployer.ForaDoAr = false; }
    }

    [Fact]
    public async Task Github_travado_nao_passa_de_10_segundos()
    {
        f.Github.Travado = true;
        try
        {
            var t = Stopwatch.StartNew();
            var l = await Lista();
            Assert.Equal(("no-ar", "pendente"), (Situacao(l, "notas"), Etapa(l, "velho", "papel")));
            Assert.True(t.Elapsed < TimeSpan.FromSeconds(10), t.Elapsed.ToString());
        }
        finally { f.Github.Travado = false; }
    }

    [Fact]
    public async Task Versoes_so_com_ci_verde_e_imagem()
    {
        var c = await f.Entrar(FabricaDoPainel.Admin);
        var v = await c.GetFromJsonAsync<JsonElement>("/api/painel/plugins/novo/versoes");
        Assert.Equal("abc1234", Assert.Single(v.EnumerateArray()).GetProperty("versao").GetString());
        foreach (var id in new[] { "fora", "postgres" })
            Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync($"/api/painel/plugins/{id}/versoes")).StatusCode);
        f.Github.ForaDoAr = true;
        try { Assert.Equal(HttpStatusCode.ServiceUnavailable, (await c.GetAsync("/api/painel/plugins/novo/versoes")).StatusCode); }
        finally { f.Github.ForaDoAr = false; }
    }
}
