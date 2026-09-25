using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api.Services.Sites;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>Deployer de mentira: guarda o que foi pedido, sem Docker.</summary>
public class DeployerFalso : IDeployer
{
    public readonly List<(string Slug, IniciarApp App)> Iniciados = [];
    public readonly HashSet<string> Rodando = [];
    public readonly List<string> Removidos = [];

    public Task IniciarAsync(string slug, IniciarApp app, CancellationToken ct)
    {
        lock (this) { Iniciados.Add((slug, app)); Rodando.Add(slug); }
        return Task.CompletedTask;
    }

    public Task RemoverAsync(string slug, CancellationToken ct)
    {
        lock (this) { Removidos.Add(slug); Rodando.Remove(slug); }
        return Task.CompletedTask;
    }

    public Task<string> LogsAsync(string slug, int linhas, CancellationToken ct) =>
        Task.FromResult("Unhandled exception. System.Exception: boom\n");

    public readonly List<string> Dumps = [];
    public readonly List<(string Banco, string Conteudo)> Restaurados = [];
    public readonly HashSet<string> FalharDump = [];

    public async Task DumpPostgresAsync(string banco, Stream destino, CancellationToken ct)
    {
        string conteudo;
        lock (this)
        {
            if (FalharDump.Contains(banco)) throw new DeployerException("pg_dump: connection refused");
            Dumps.Add(banco);
            conteudo = $"DUMP-{banco}-{Dumps.Count(d => d == banco)}";
        }
        await destino.WriteAsync(System.Text.Encoding.UTF8.GetBytes(conteudo), ct);
    }

    public async Task RestaurarPostgresAsync(string banco, Stream dump, CancellationToken ct)
    {
        var conteudo = await new StreamReader(dump).ReadToEndAsync(ct);
        lock (this) Restaurados.Add((banco, conteudo));
    }

    public Task<IReadOnlyList<string>> RodandoAsync(CancellationToken ct)
    {
        lock (this) return Task.FromResult<IReadOnlyList<string>>(Rodando.ToList());
    }
}

/// <summary>Postgres de mentira: guarda os bancos criados e as senhas.</summary>
public class PostgresFalso : IPostgresProvisionador
{
    public readonly Dictionary<string, string> Bancos = [];
    public readonly List<string> Removidos = [];

    public Task CriarAsync(string nome, string senha, CancellationToken ct) { lock (this) Bancos[nome] = senha; return Task.CompletedTask; }
    public Task TrocarSenhaAsync(string nome, string senha, CancellationToken ct) { lock (this) Bancos[nome] = senha; return Task.CompletedTask; }
    public Task RemoverAsync(string nome, CancellationToken ct) { lock (this) { Bancos.Remove(nome); Removidos.Add(nome); } return Task.CompletedTask; }
    public readonly List<string> Recriados = [];
    public Task RecriarBancoAsync(string nome, CancellationToken ct) { lock (this) Recriados.Add(nome); return Task.CompletedTask; }
}

/// <summary>Responde "saudável" a não ser que a DLL em teste esteja marcada para falhar.</summary>
public class SaudeFalsa(DeployerFalso deployer) : IVerificadorSaude
{
    public Task<string?> VerificarAsync(string slug, string caminho, bool exige2xx, CancellationToken ct)
    {
        IniciarApp? ultimo;
        lock (deployer) ultimo = deployer.Iniciados.LastOrDefault(x => x.Slug == slug).App;
        return Task.FromResult(ultimo?.Entrada == "Quebrado.dll" ? "GET / respondeu 502" : null);
    }
}

public class SitesApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"notas-sites-{Guid.NewGuid():N}.db");
    public string RaizSites { get; } = Path.Combine(Path.GetTempPath(), $"notas-sites-{Guid.NewGuid():N}");
    public string EmailDono { get; } = $"dono_{Guid.NewGuid():N}@example.com";
    public DeployerFalso Deployer { get; } = new();
    public PostgresFalso Postgres { get; } = new();
    /// <summary>Um login por e-mail: o limitador de /api/auth derruba a suíte se cada teste registrar de novo.</summary>
    public Dictionary<string, string> Tokens { get; } = [];

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("JWT_SECRET", "test-secret-key-for-integration-tests-only-0123456789");
        builder.UseSetting("ConnectionStrings:Db", $"Data Source={_dbPath}");
        builder.UseSetting("Sites:Raiz", RaizSites);
        builder.UseSetting("Sites:Publicadores", "outro@example.com, " + EmailDono.ToUpperInvariant());
        builder.UseSetting("Sites:HealthTimeoutSegundos", "1");
        builder.UseSetting("Sites:MaxDescompactadoBytes", (2 * 1024 * 1024).ToString());
        builder.UseSetting("Sites:MaxAppsRodando", "1000");
        builder.UseSetting("Sites:PostgresAdmin", "Host=falso;Username=postgres;Password=x");
        builder.ConfigureTestServices(s =>
        {
            s.AddSingleton<IDeployer>(Deployer);
            s.AddSingleton<IVerificadorSaude>(new SaudeFalsa(Deployer));
            s.AddSingleton<IPostgresProvisionador>(Postgres);
        });
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public new Task DisposeAsync()
    {
        base.Dispose();
        SqliteConnection.ClearAllPools();
        foreach (var f in new[] { _dbPath, _dbPath + "-wal", _dbPath + "-shm" })
            if (File.Exists(f)) File.Delete(f);
        if (Directory.Exists(RaizSites)) Directory.Delete(RaizSites, recursive: true);
        return Task.CompletedTask;
    }
}

public class SitesTests(SitesApiFactory factory) : IClassFixture<SitesApiFactory>, IAsyncLifetime
{
    private HttpClient _dono = null!;

    public async Task InitializeAsync()
    {
        _dono = await Cliente(factory.EmailDono);
    }

    public Task DisposeAsync()
    {
        _dono.Dispose();
        return Task.CompletedTask;
    }

    private async Task<HttpClient> Cliente(string email)
    {
        string? token;
        lock (factory.Tokens) factory.Tokens.TryGetValue(email, out token);
        token ??= await Registrar(email);
        lock (factory.Tokens) factory.Tokens[email] = token;
        var c = factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    private async Task<string> Registrar(string email)
    {
        var anon = factory.CreateClient();
        var res = await anon.PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        if (res.StatusCode == HttpStatusCode.Conflict)
            res = await anon.PostAsJsonAsync("/api/auth/login", new { email, password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
    }

    private static string NovoSlug() => "s" + Guid.NewGuid().ToString("N")[..10];

    private async Task<JsonElement> CriarSite(string? slug = null)
    {
        var res = await _dono.PostAsJsonAsync("/api/sites", new { nome = "Meu app", slug = slug ?? NovoSlug() });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static byte[] Zip(params (string Nome, string Conteudo)[] arquivos)
    {
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (nome, conteudo) in arquivos)
            {
                var e = zip.CreateEntry(nome);
                using var w = new StreamWriter(e.Open());
                w.Write(conteudo);
            }
        }
        return ms.ToArray();
    }

    private static (string, string)[] AppDotNet(string nome = "App", string versao = "9.0.0", bool comWeb = true)
    {
        var lista = new List<(string, string)>
        {
            ($"api/{nome}.dll", "MZ"),
            ($"api/{nome}.runtimeconfig.json",
                """{"runtimeOptions":{"tfm":"net9.0","framework":{"name":"Microsoft.AspNetCore.App","version":"VERSAO"}}}""".Replace("VERSAO", versao)),
        };
        if (comWeb) lista.Add(("web/index.html", "<h1>oi</h1>"));
        return lista.ToArray();
    }

    private async Task<HttpResponseMessage> Enviar(string siteId, byte[] zip)
    {
        var conteudo = new ByteArrayContent(zip);
        conteudo.Headers.ContentType = new MediaTypeHeaderValue("application/zip");
        return await _dono.PostAsync($"/api/sites/{siteId}/deployments", conteudo);
    }

    /// <summary>Espera a fila terminar a última versão e devolve o detalhe do site.</summary>
    private async Task<JsonElement> EsperarFila(string siteId)
    {
        for (var i = 0; i < 100; i++)
        {
            var site = await _dono.GetFromJsonAsync<JsonElement>($"/api/sites/{siteId}");
            var ocupado = site.GetProperty("versoes").EnumerateArray()
                .Any(v => v.GetProperty("status").GetString() is "Enviado" or "Iniciando");
            if (!ocupado) return site;
            await Task.Delay(50);
        }
        throw new TimeoutException("A fila não terminou.");
    }

    private static JsonElement Versao(JsonElement site, int n) =>
        site.GetProperty("versoes").EnumerateArray().First(v => v.GetProperty("versao").GetInt32() == n);

    private string PastaSite(string slug) => Path.Combine(factory.RaizSites, slug);

    [Fact]
    public async Task Quem_nao_esta_na_lista_nao_publica()
    {
        using var outro = await Cliente($"x_{Guid.NewGuid():N}@example.com");
        var perm = await outro.GetFromJsonAsync<JsonElement>("/api/sites/permissao");
        Assert.False(perm.GetProperty("podePublicar").GetBoolean());
        Assert.Equal(HttpStatusCode.Forbidden, (await outro.GetAsync("/api/sites")).StatusCode);

        var minha = await _dono.GetFromJsonAsync<JsonElement>("/api/sites/permissao");
        Assert.True(minha.GetProperty("podePublicar").GetBoolean());
    }

    [Theory]
    [InlineData("ab")]
    [InlineData("-abc")]
    [InlineData("abc-")]
    [InlineData("a--b")]
    [InlineData("com_underline")]
    [InlineData("www")]
    [InlineData("api")]
    public async Task Slug_invalido_ou_reservado_e_recusado(string slug)
    {
        var res = await _dono.PostAsJsonAsync("/api/sites", new { nome = "x", slug });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Slug_repetido_da_conflito()
    {
        var slug = NovoSlug();
        await CriarSite(slug);
        var res = await _dono.PostAsJsonAsync("/api/sites", new { nome = "x", slug });
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
    }

    [Fact]
    public async Task Site_estatico_vai_ao_ar_sem_container()
    {
        var site = await CriarSite();
        var id = site.GetProperty("id").GetString()!;
        var slug = site.GetProperty("slug").GetString()!;
        Assert.Equal($"http://{slug}.191-252-177-244.sslip.io:8090", site.GetProperty("url").GetString());

        var res = await Enviar(id, Zip(("index.html", "<h1>v1</h1>"), ("assets/app.js", "console.log(1)")));
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);

        var detalhe = await EsperarFila(id);
        var v1 = Versao(detalhe, 1);
        Assert.True(v1.GetProperty("status").GetString() == "NoAr", v1.GetProperty("log").GetString());
        Assert.Equal("Estatico", v1.GetProperty("tipo").GetString());
        Assert.Equal(v1.GetProperty("id").GetString(), detalhe.GetProperty("currentDeploymentId").GetString());

        // O Caddy serve <slug>/current/web: o link aponta para a versão e o conteúdo foi para web/.
        var atual = Path.Combine(PastaSite(slug), "current");
        Assert.Equal(Path.Combine("deploys", v1.GetProperty("id").GetString()!), new DirectoryInfo(atual).LinkTarget);
        Assert.Equal("<h1>v1</h1>", File.ReadAllText(Path.Combine(atual, "web", "index.html")));
        Assert.True(File.Exists(Path.Combine(atual, "web", "assets", "app.js")));
        Assert.DoesNotContain(factory.Deployer.Iniciados, x => x.Slug == slug);
    }

    [Fact]
    public async Task Republicar_troca_a_versao_e_permite_voltar()
    {
        var site = await CriarSite();
        var id = site.GetProperty("id").GetString()!;
        var slug = site.GetProperty("slug").GetString()!;
        await Enviar(id, Zip(("web/index.html", "v1")));
        await EsperarFila(id);
        await Enviar(id, Zip(("web/index.html", "v2")));
        var detalhe = await EsperarFila(id);

        var atual = Path.Combine(PastaSite(slug), "current", "web", "index.html");
        Assert.Equal("v2", File.ReadAllText(atual));
        Assert.Equal("Substituido", Versao(detalhe, 1).GetProperty("status").GetString());

        var v1 = Versao(detalhe, 1).GetProperty("id").GetString();
        var res = await _dono.PostAsJsonAsync($"/api/sites/{id}/deployments/{v1}/ativar", new { restaurarBanco = false });
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        detalhe = await EsperarFila(id);
        await Task.Delay(100);
        detalhe = await _dono.GetFromJsonAsync<JsonElement>($"/api/sites/{id}");
        Assert.Equal("v1", File.ReadAllText(atual));
        Assert.Equal(v1, detalhe.GetProperty("currentDeploymentId").GetString());
        Assert.Equal("NoAr", Versao(detalhe, 1).GetProperty("status").GetString());
        Assert.Equal("Substituido", Versao(detalhe, 2).GetProperty("status").GetString());
    }

    [Fact]
    public async Task Pasta_unica_por_fora_do_zip_e_ignorada()
    {
        var site = await CriarSite();
        var id = site.GetProperty("id").GetString()!;
        await Enviar(id, Zip(AppDotNet().Select(x => ("meu-app/" + x.Item1, x.Item2)).ToArray()));
        var v1 = Versao(await EsperarFila(id), 1);
        Assert.Equal("DotNet", v1.GetProperty("tipo").GetString());
        Assert.True(v1.GetProperty("temWeb").GetBoolean());
    }

    [Fact]
    public async Task Api_dotnet_sobe_container_com_runtime_e_entrada_do_pacote()
    {
        var site = await CriarSite();
        var id = site.GetProperty("id").GetString()!;
        var slug = site.GetProperty("slug").GetString()!;

        var res = await Enviar(id, Zip([.. AppDotNet("Recados", "8.0.11"), ("publicar.json", """{ "memoriaMb": 256 }""")]));
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        var v1 = Versao(await EsperarFila(id), 1);
        Assert.True(v1.GetProperty("status").GetString() == "NoAr", v1.GetProperty("log").GetString());
        Assert.Equal("8.0", v1.GetProperty("runtimeVersao").GetString());

        var (_, app) = factory.Deployer.Iniciados.Last(x => x.Slug == slug);
        Assert.Equal("Recados.dll", app.Entrada);
        Assert.Equal("8.0", app.Runtime);
        Assert.Equal(256, app.MemoriaMb);
        Assert.Equal(v1.GetProperty("id").GetString(), app.DeployId);
        Assert.True(Directory.Exists(Path.Combine(PastaSite(slug), "data")));
    }

    [Fact]
    public async Task Runtimeconfig_solto_na_raiz_vira_api()
    {
        var site = await CriarSite();
        var id = site.GetProperty("id").GetString()!;
        await Enviar(id, Zip(AppDotNet(comWeb: false).Select(x => (x.Item1["api/".Length..], x.Item2)).ToArray()));
        var v1 = Versao(await EsperarFila(id), 1);
        Assert.Equal("DotNet", v1.GetProperty("tipo").GetString());
        Assert.False(v1.GetProperty("temWeb").GetBoolean());
    }

    [Fact]
    public async Task Versao_que_nao_responde_falha_e_a_anterior_volta_com_o_banco()
    {
        var site = await CriarSite();
        var id = site.GetProperty("id").GetString()!;
        var slug = site.GetProperty("slug").GetString()!;
        await Enviar(id, Zip(AppDotNet()));
        var v1Id = Versao(await EsperarFila(id), 1).GetProperty("id").GetString();

        // O app v1 gravou algo no banco.
        var banco = Path.Combine(PastaSite(slug), "data", "app.db");
        Executar(banco, "CREATE TABLE recados(texto TEXT); INSERT INTO recados VALUES ('antes');");

        await Enviar(id, Zip(AppDotNet("Quebrado")));
        var detalhe = await EsperarFila(id);
        var v2 = Versao(detalhe, 2);
        Assert.Equal("Falhou", v2.GetProperty("status").GetString());
        Assert.Contains("boom", v2.GetProperty("log").GetString());
        Assert.Contains("Voltando para a v1", v2.GetProperty("log").GetString());
        Assert.Equal(v1Id, detalhe.GetProperty("currentDeploymentId").GetString());
        Assert.Equal("NoAr", Versao(detalhe, 1).GetProperty("status").GetString());
        Assert.Equal("App.dll", factory.Deployer.Iniciados.Last(x => x.Slug == slug).App.Entrada);
        Assert.Equal("antes", Consultar(banco, "SELECT texto FROM recados"));
    }

    [Fact]
    public async Task Voltar_versao_pode_restaurar_o_banco()
    {
        var site = await CriarSite();
        var id = site.GetProperty("id").GetString()!;
        var slug = site.GetProperty("slug").GetString()!;
        var banco = Path.Combine(PastaSite(slug), "data", "app.db");

        await Enviar(id, Zip(AppDotNet()));
        var v1Id = Versao(await EsperarFila(id), 1).GetProperty("id").GetString();
        Executar(banco, "CREATE TABLE t(v TEXT); INSERT INTO t VALUES ('v1');");

        await Enviar(id, Zip(AppDotNet()));
        var v2 = Versao(await EsperarFila(id), 2);
        Assert.True(v2.GetProperty("temBackupBanco").GetBoolean());
        Executar(banco, "UPDATE t SET v = 'estragado-pela-v2';");

        var res = await _dono.PostAsJsonAsync($"/api/sites/{id}/deployments/{v1Id}/ativar", new { restaurarBanco = true });
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        await Task.Delay(100);
        var detalhe = await EsperarFila(id);
        Assert.Equal(v1Id, detalhe.GetProperty("currentDeploymentId").GetString());
        Assert.Equal("v1", Consultar(banco, "SELECT v FROM t"));
    }

    [Fact]
    public async Task Variaveis_sao_cifradas_e_chegam_ao_container()
    {
        var site = await CriarSite();
        var id = site.GetProperty("id").GetString()!;
        var slug = site.GetProperty("slug").GetString()!;
        await Enviar(id, Zip(AppDotNet()));
        await EsperarFila(id);

        var res = await _dono.PutAsJsonAsync($"/api/sites/{id}/variaveis", new[] { new { chave = "Email__Senha", valor = "s3gr3do" } });
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        Assert.Equal("s3gr3do", factory.Deployer.Iniciados.Last(x => x.Slug == slug).App.Variaveis["Email__Senha"]);

        var lista = await _dono.GetFromJsonAsync<JsonElement>($"/api/sites/{id}/variaveis");
        Assert.Equal("s3gr3do", lista[0].GetProperty("valor").GetString());

        var reservada = await _dono.PutAsJsonAsync($"/api/sites/{id}/variaveis", new[] { new { chave = "ASPNETCORE_URLS", valor = "x" } });
        Assert.Equal(HttpStatusCode.BadRequest, reservada.StatusCode);
        var invalida = await _dono.PutAsJsonAsync($"/api/sites/{id}/variaveis", new[] { new { chave = "a b", valor = "x" } });
        Assert.Equal(HttpStatusCode.BadRequest, invalida.StatusCode);
    }

    [Fact]
    public async Task Parar_e_excluir_removem_container_e_arquivos()
    {
        var site = await CriarSite();
        var id = site.GetProperty("id").GetString()!;
        var slug = site.GetProperty("slug").GetString()!;
        await Enviar(id, Zip(AppDotNet()));
        await EsperarFila(id);
        Assert.Contains(slug, factory.Deployer.Rodando);

        Assert.Equal(HttpStatusCode.NoContent, (await _dono.PostAsync($"/api/sites/{id}/parar", null)).StatusCode);
        Assert.DoesNotContain(slug, factory.Deployer.Rodando);
        Assert.True((await _dono.GetFromJsonAsync<JsonElement>($"/api/sites/{id}")).GetProperty("parado").GetBoolean());

        Assert.Equal(HttpStatusCode.NoContent, (await _dono.PostAsync($"/api/sites/{id}/reiniciar", null)).StatusCode);
        Assert.Contains(slug, factory.Deployer.Rodando);

        Assert.Equal(HttpStatusCode.NoContent, (await _dono.DeleteAsync($"/api/sites/{id}")).StatusCode);
        Assert.False(Directory.Exists(PastaSite(slug)));
        Assert.Equal(HttpStatusCode.NotFound, (await _dono.GetAsync($"/api/sites/{id}")).StatusCode);
    }

    [Fact]
    public async Task Zip_com_caminho_para_fora_e_recusado()
    {
        var id = (await CriarSite()).GetProperty("id").GetString()!;
        var res = await Enviar(id, Zip(("web/index.html", "x"), ("../../fora.txt", "x")));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.False(File.Exists(Path.Combine(factory.RaizSites, "fora.txt")));
    }

    [Fact]
    public async Task Zip_com_link_simbolico_e_recusado()
    {
        var id = (await CriarSite()).GetProperty("id").GetString()!;
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            zip.CreateEntry("web/index.html");
            var link = zip.CreateEntry("web/segredo");
            link.ExternalAttributes = unchecked((int)(0xA1FF_0000));
            using var w = new StreamWriter(link.Open());
            w.Write("/etc/passwd");
        }
        var res = await Enviar(id, ms.ToArray());
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("link simbólico", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Zip_bomb_e_recusado()
    {
        var id = (await CriarSite()).GetProperty("id").GetString()!;
        // 3 MB de zeros compactam para poucos KB; o limite do teste é 2 MB descompactado.
        var res = await Enviar(id, Zip(("web/index.html", new string('0', 3 * 1024 * 1024))));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("limite", await res.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("não sou zip", "ZIP válido")]
    [InlineData(null, "Não encontrei o que publicar")]
    public async Task Pacote_sem_formato_conhecido_e_recusado(string? corpo, string mensagem)
    {
        var id = (await CriarSite()).GetProperty("id").GetString()!;
        var bytes = corpo is null ? Zip(("leiame.txt", "oi")) : Encoding.UTF8.GetBytes(corpo);
        var res = await Enviar(id, bytes);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains(mensagem, await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Dois_runtimeconfig_sem_entrada_pede_publicar_json()
    {
        var id = (await CriarSite()).GetProperty("id").GetString()!;
        var res = await Enviar(id, Zip([.. AppDotNet("A"), .. AppDotNet("B", comWeb: false)]));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("entrada", await res.Content.ReadAsStringAsync());

        res = await Enviar(id, Zip([.. AppDotNet("A"), .. AppDotNet("B", comWeb: false), ("publicar.json", """{"entrada":"B.dll"}""")]));
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
    }

    [Fact]
    public async Task Runtime_nao_suportado_e_recusado()
    {
        var id = (await CriarSite()).GetProperty("id").GetString()!;
        var res = await Enviar(id, Zip(AppDotNet(versao: "6.0.0")));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("6.0", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Site_de_outro_usuario_nao_aparece()
    {
        var id = (await CriarSite()).GetProperty("id").GetString()!;
        // "outro@example.com" também publica, mas não é dono deste site.
        using var outro = await Cliente("outro@example.com");
        Assert.Equal(HttpStatusCode.NotFound, (await outro.GetAsync($"/api/sites/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outro.DeleteAsync($"/api/sites/{id}")).StatusCode);
    }

    [Fact]
    public async Task Postgres_cria_banco_usuario_e_senha_e_entrega_ao_app()
    {
        var slug = NovoSlug();
        var res = await _dono.PostAsJsonAsync("/api/sites", new { nome = "Com PG", slug, criarPostgres = true });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var id = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;

        var pg = await _dono.GetFromJsonAsync<JsonElement>($"/api/sites/{id}/postgres");
        Assert.True(pg.GetProperty("criado").GetBoolean());
        var nome = "site_" + slug;
        Assert.Equal(nome, pg.GetProperty("banco").GetString());
        Assert.Equal(nome, pg.GetProperty("usuario").GetString());
        Assert.Equal("postgres", pg.GetProperty("host").GetString());
        var senha = pg.GetProperty("senha").GetString()!;
        Assert.Matches("^[a-f0-9]{64}$", senha);
        Assert.Equal(senha, factory.Postgres.Bancos[nome]);
        Assert.Contains($"Password={senha}", pg.GetProperty("connectionString").GetString());

        // O app recebe a connection string e as variáveis do libpq.
        await Enviar(id, Zip(AppDotNet()));
        await EsperarFila(id);
        var vars = factory.Deployer.Iniciados.Last(x => x.Slug == slug).App.Variaveis;
        Assert.Equal(senha, vars["PGPASSWORD"]);
        Assert.Equal(nome, vars["PGDATABASE"]);
        Assert.Contains($"Database={nome}", vars["ConnectionStrings__Postgres"]);

        // O usuário não consegue sobrescrever as credenciais pelas variáveis.
        var sobrescrever = await _dono.PutAsJsonAsync($"/api/sites/{id}/variaveis", new[] { new { chave = "PGPASSWORD", valor = "x" } });
        Assert.Equal(HttpStatusCode.BadRequest, sobrescrever.StatusCode);
    }

    [Fact]
    public async Task Postgres_troca_senha_reinicia_o_app_e_pode_ser_apagado()
    {
        var site = await CriarSite();
        var id = site.GetProperty("id").GetString()!;
        var slug = site.GetProperty("slug").GetString()!;
        await Enviar(id, Zip(AppDotNet()));
        await EsperarFila(id);

        var criado = await _dono.PostAsync($"/api/sites/{id}/postgres", null);
        Assert.Equal(HttpStatusCode.OK, criado.StatusCode);
        var senha1 = (await criado.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("senha").GetString();
        // Criar de novo é idempotente: mesma senha.
        var denovo = await (await _dono.PostAsync($"/api/sites/{id}/postgres", null)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(senha1, denovo.GetProperty("senha").GetString());
        Assert.Equal(senha1, factory.Deployer.Iniciados.Last(x => x.Slug == slug).App.Variaveis["PGPASSWORD"]);

        var trocada = await (await _dono.PostAsync($"/api/sites/{id}/postgres/senha", null)).Content.ReadFromJsonAsync<JsonElement>();
        var senha2 = trocada.GetProperty("senha").GetString();
        Assert.NotEqual(senha1, senha2);
        Assert.Equal(senha2, factory.Postgres.Bancos["site_" + slug]);
        Assert.Equal(senha2, factory.Deployer.Iniciados.Last(x => x.Slug == slug).App.Variaveis["PGPASSWORD"]);

        Assert.Equal(HttpStatusCode.NoContent, (await _dono.DeleteAsync($"/api/sites/{id}/postgres")).StatusCode);
        Assert.Contains("site_" + slug, factory.Postgres.Removidos);
        Assert.False(factory.Deployer.Iniciados.Last(x => x.Slug == slug).App.Variaveis.ContainsKey("PGPASSWORD"));
        Assert.False((await _dono.GetFromJsonAsync<JsonElement>($"/api/sites/{id}/postgres")).GetProperty("criado").GetBoolean());
    }

    [Fact]
    public async Task Excluir_site_apaga_o_banco_postgres()
    {
        var slug = NovoSlug();
        var res = await _dono.PostAsJsonAsync("/api/sites", new { nome = "x", slug, criarPostgres = true });
        var id = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
        Assert.Equal(HttpStatusCode.NoContent, (await _dono.DeleteAsync($"/api/sites/{id}")).StatusCode);
        Assert.Contains("site_" + slug, factory.Postgres.Removidos);
        Assert.False(factory.Postgres.Bancos.ContainsKey("site_" + slug));
    }

    private async Task<(string Id, string Slug, string Banco)> SiteComPostgres()
    {
        var slug = NovoSlug();
        var res = await _dono.PostAsJsonAsync("/api/sites", new { nome = "PG", slug, criarPostgres = true });
        var id = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
        return (id, slug, "site_" + slug);
    }

    [Fact]
    public async Task Cada_deploy_faz_pg_dump_antes_da_troca()
    {
        var (id, slug, banco) = await SiteComPostgres();
        await Enviar(id, Zip(AppDotNet()));
        var v1 = Versao(await EsperarFila(id), 1);
        Assert.True(v1.GetProperty("temBackupPostgres").GetBoolean());
        Assert.Contains("pg_dump de " + banco, v1.GetProperty("log").GetString());
        var arquivo = Path.Combine(PastaSite(slug), "backups", v1.GetProperty("id").GetString() + ".pgdump");
        Assert.Equal($"DUMP-{banco}-1", File.ReadAllText(arquivo));

        // Site estático não tem app: nada de dump.
        var estatico = (await CriarSite()).GetProperty("id").GetString()!;
        await Enviar(estatico, Zip(("index.html", "x")));
        Assert.False(Versao(await EsperarFila(estatico), 1).GetProperty("temBackupPostgres").GetBoolean());
    }

    [Fact]
    public async Task Versao_que_falha_devolve_o_postgres_ao_dump_de_antes()
    {
        var (id, slug, banco) = await SiteComPostgres();
        await Enviar(id, Zip(AppDotNet()));
        await EsperarFila(id);
        await Enviar(id, Zip(AppDotNet("Quebrado")));
        var v2 = Versao(await EsperarFila(id), 2);
        Assert.Equal("Falhou", v2.GetProperty("status").GetString());
        Assert.Contains("pg_restore", v2.GetProperty("log").GetString());

        // Recriou o banco e restaurou o dump feito antes da v2 (o segundo dump deste banco).
        Assert.Contains(banco, factory.Postgres.Recriados);
        Assert.Equal((banco, $"DUMP-{banco}-2"), factory.Deployer.Restaurados.Last(r => r.Banco == banco));
        Assert.Equal("App.dll", factory.Deployer.Iniciados.Last(x => x.Slug == slug).App.Entrada);
    }

    [Fact]
    public async Task Voltar_versao_com_banco_restaura_o_postgres()
    {
        var (id, _, banco) = await SiteComPostgres();
        await Enviar(id, Zip(AppDotNet()));
        var v1Id = Versao(await EsperarFila(id), 1).GetProperty("id").GetString();
        await Enviar(id, Zip(AppDotNet()));
        await EsperarFila(id);

        var res = await _dono.PostAsJsonAsync($"/api/sites/{id}/deployments/{v1Id}/ativar", new { restaurarBanco = true });
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        await Task.Delay(100);
        var detalhe = await EsperarFila(id);
        Assert.Equal(v1Id, detalhe.GetProperty("currentDeploymentId").GetString());
        // O dump de antes da v2 (a versão que estava no ar).
        Assert.Equal((banco, $"DUMP-{banco}-2"), factory.Deployer.Restaurados.Last(r => r.Banco == banco));
        Assert.Contains("devolvido ao estado de antes da v2", Versao(detalhe, 1).GetProperty("log").GetString());
    }

    [Fact]
    public async Task Pg_dump_que_falha_cancela_o_deploy_sem_tocar_na_versao_no_ar()
    {
        var (id, slug, banco) = await SiteComPostgres();
        await Enviar(id, Zip(AppDotNet()));
        var v1Id = Versao(await EsperarFila(id), 1).GetProperty("id").GetString();
        var subidasAntes = factory.Deployer.Iniciados.Count(x => x.Slug == slug);

        lock (factory.Deployer) factory.Deployer.FalharDump.Add(banco);
        try
        {
            await Enviar(id, Zip(AppDotNet()));
            var detalhe = await EsperarFila(id);
            var v2 = Versao(detalhe, 2);
            Assert.Equal("Falhou", v2.GetProperty("status").GetString());
            Assert.Contains("nada foi trocado", v2.GetProperty("log").GetString());
            Assert.Equal(v1Id, detalhe.GetProperty("currentDeploymentId").GetString());
            Assert.Equal("NoAr", Versao(detalhe, 1).GetProperty("status").GetString());
            // O container da v1 nem foi reiniciado.
            Assert.Equal(subidasAntes, factory.Deployer.Iniciados.Count(x => x.Slug == slug));
            Assert.Contains(slug, factory.Deployer.Rodando);
        }
        finally
        {
            lock (factory.Deployer) factory.Deployer.FalharDump.Remove(banco);
        }
    }

    private static void Executar(string banco, string sql)
    {
        using var c = new SqliteConnection($"Data Source={banco};Pooling=False");
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    private static string? Consultar(string banco, string sql)
    {
        using var c = new SqliteConnection($"Data Source={banco};Pooling=False");
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        return cmd.ExecuteScalar() as string;
    }
}
