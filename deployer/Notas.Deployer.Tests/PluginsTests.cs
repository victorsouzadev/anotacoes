using System.Net;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Notas.Deployer;
using Xunit;

namespace Notas.Deployer.Tests;

public class PluginsTests
{
    public static Manifesto M(string id = "dieta", string? prefixo = null, List<string>? legadas = null, List<string>? rotas = null,
        int contrato = 1) =>
        new(id, "Dieta", "apple", null, contrato, "/" + id, 8080, $"/{id}/api/health", null, rotas,
            new TabelasManifesto(prefixo ?? id + "_", legadas), false, null, null);

    [Fact]
    public void Lock_le_ativos_desligados_e_ignora_lixo()
    {
        var l = Plugins.LerLock("""
            # id: imagem@versão
            dieta:  ghcr.io/victorsouzadev/hub-dieta@a81d004
            # treino: ghcr.io/victorsouzadev/hub-treino@77c01be   # congelado
            cerebro: ghcr.io/victorsouzadev/hub-cerebro@3f2a9c1  # comentário no fim
            isto não é linha
            """);
        Assert.Equal(["dieta", "treino", "cerebro"], l.Select(e => e.Id));
        Assert.True(l[0].Ativo);
        Assert.False(l[1].Ativo);
        Assert.Equal("ghcr.io/victorsouzadev/hub-cerebro:3f2a9c1", l[2].Referencia);
    }

    [Fact]
    public void Manifesto_valido_passa() => Assert.Empty(Plugins.Validar(M(rotas: ["/api/dieta", "/api/mcp/dieta"]), "dieta", []));

    [Theory]
    [InlineData("/api")]          // engloba /api/auth
    [InlineData("/api/auth/x")]   // dentro de reservada
    [InlineData("/.well-known")]
    [InlineData("/ops")]
    [InlineData("/api/core")]
    public void Rota_legada_nao_invade_reservada(string legada) =>
        Assert.Contains(Plugins.Validar(M(rotas: [legada]), "dieta", []), p => p.Contains("reservada"));

    [Fact]
    public void Recusa_rota_prefixo_contrato_e_id_errados()
    {
        var m = M() with { Rota = "/outra", Contrato = 2, Tabelas = new TabelasManifesto("core_", ["users"]) };
        var p = Plugins.Validar(m, "dieta", []);
        Assert.Contains(p, x => x.Contains("rota precisa ser /dieta"));
        Assert.Contains(p, x => x.Contains("contrato 2"));
        Assert.Contains(p, x => x.Contains("core_"));
        Assert.Contains(p, x => x.Contains("users"));
        Assert.Contains(Plugins.Validar(M("dieta"), "treino", []), x => x.Contains("difere"));
        Assert.Contains(Plugins.Validar(null, "dieta", []), x => x.Contains("plugin.json"));
    }

    [Theory]
    [InlineData("/data/db")]
    [InlineData("/data/core")]
    [InlineData("/data/../etc")]
    [InlineData("/etc")]
    [InlineData("/data/vault/sub")]
    public void Dados_so_em_pasta_propria(string d) =>
        Assert.Contains(Plugins.Validar(M() with { Dados = [d] }, "dieta", []), p => p.Contains("dados"));

    [Fact]
    public void Dados_montados_por_plugin_so_com_a_pasta_do_host_configurada()
    {
        var m = M("cerebro") with { Dados = ["/data/vault", "/data/hub"] };
        Assert.Empty(Plugins.Validar(m, "cerebro", []));
        var e = new EntradaLock("cerebro", "ghcr.io/x/hub-cerebro", "abc1234", true);
        SincronizadorDePlugins S(string? dados) => new(new ConfiguracaoPlugins { BancoNoHost = "/opt/h/data/db", DadosNoHost = dados },
            (_, _) => Task.FromResult(new Resultado(0, "", "")), new HttpClient(), NullLogger.Instance);

        var a = S("/opt/h/data/plugins/dados/").ArgumentosRun(e, m, "s");
        Assert.Contains("/opt/h/data/plugins/dados/cerebro/vault:/data/vault", a);
        Assert.Contains("/opt/h/data/plugins/dados/cerebro/hub:/data/hub", a);
        Assert.Equal(["/opt/h/data/db:/data/db"], S(null).ArgumentosRun(e, m, "s").Where(x => x.Contains(":/data/")));
    }

    [Fact]
    public void Env_do_plugin_entra_com_env_file_so_quando_existe()
    {
        var m = M("cerebro");
        var e = new EntradaLock("cerebro", "ghcr.io/x/hub-cerebro", "abc1234", true);
        var pasta = Path.Combine(Path.GetTempPath(), "env-" + Guid.NewGuid().ToString("N"));
        var cfg = new ConfiguracaoPlugins { Pasta = pasta, BancoNoHost = "/opt/h/data/db" };
        var s = new SincronizadorDePlugins(cfg, (_, _) => Task.FromResult(new Resultado(0, "", "")), new HttpClient(), NullLogger.Instance);

        Assert.DoesNotContain("--env-file", s.ArgumentosRun(e, m, "s"));

        Directory.CreateDirectory(cfg.PastaEnv);
        File.WriteAllText(cfg.ArquivoEnv("cerebro"), "Hub__McpToken=x\n");
        var a = s.ArgumentosRun(e, m, "s");
        var i = a.IndexOf("--env-file");
        Assert.Equal(Path.Combine(pasta, "env", "cerebro.env"), a[i + 1]);
        Assert.DoesNotContain(Path.Combine(pasta, "env", "outro.env"), a);
        Assert.Equal(e.Referencia, a[^1]);
    }

    [Fact]
    public void Contrato_anterior_ainda_vale() => Assert.Empty(Plugins.Validar(M(contrato: 0), "dieta", []));

    [Fact]
    public void Recusa_sobreposicao_com_outro_plugin()
    {
        var outro = M("treino", prefixo: "treino_", legadas: ["notes"], rotas: ["/api/treino"]);
        Assert.Contains(Plugins.Validar(M(prefixo: "treino_x_"), "dieta", [outro]), x => x.Contains("prefixo"));
        Assert.Contains(Plugins.Validar(M(legadas: ["notes"]), "dieta", [outro]), x => x.Contains("notes"));
        Assert.Contains(Plugins.Validar(M(rotas: ["/api/treino/sub"]), "dieta", [outro]), x => x.Contains("sobrepõe"));
        Assert.Empty(Plugins.Validar(M(rotas: ["/api/treinos"]), "dieta", [outro]));
    }

    [Fact]
    public void Caddy_manda_rota_e_legadas_sem_reescrever()
    {
        var c = Plugins.GerarCaddy(M(rotas: ["/api/dieta"]));
        Assert.Contains("handle /dieta {", c);
        Assert.Contains("handle /dieta/* {", c);
        Assert.Contains("handle /api/dieta/* {", c);
        Assert.Contains("reverse_proxy plugin-dieta:8080", c);
        Assert.DoesNotContain("handle_path", c);
        Assert.DoesNotContain("uri strip_prefix", c);
    }

    private static Dictionary<string, string> R(params (string chave, string tabela, string sql)[] x) =>
        x.ToDictionary(t => t.chave, t => t.tabela + "\u001f" + t.sql);

    [Fact]
    public void Esquema_so_pode_mudar_nas_tabelas_do_dono()
    {
        var m = M(legadas: ["dieta_antiga", "pesos"]);
        var antes = R(("table:notes", "notes", "CREATE TABLE notes(a)"), ("table:pesos", "pesos", "CREATE TABLE pesos(a)"));
        var proprio = R(("table:notes", "notes", "CREATE TABLE notes(a)"), ("table:pesos", "pesos", "CREATE TABLE pesos(a,b)"),
            ("table:dieta_x", "dieta_x", "CREATE TABLE dieta_x(a)"), ("table:__EFMigrationsHistory_dieta", "__EFMigrationsHistory_dieta", "x"),
            ("index:ix_dieta", "dieta_x", "CREATE INDEX ..."), ("table:__EFMigrationsLock", "__EFMigrationsLock", "x"));
        Assert.Empty(Plugins.MudancasForaDoDono(m, antes, proprio));

        var invasor = R(("table:notes", "notes", "CREATE TABLE notes(a,b)"), ("table:pesos", "pesos", "CREATE TABLE pesos(a)"),
            ("index:ix_users", "users", "CREATE INDEX ix_users"));
        Assert.Equal(["notes", "users"], Plugins.MudancasForaDoDono(m, antes, invasor));
        Assert.Equal(["notes"], Plugins.MudancasForaDoDono(m, antes, R(("table:pesos", "pesos", "CREATE TABLE pesos(a)"))));
    }
}

public class SincronizadorTests : IDisposable
{
    private readonly string _pasta = Path.Combine(Path.GetTempPath(), "plugins-" + Guid.NewGuid().ToString("N"));
    private readonly List<List<string>> _chamadas = [];
    private string _manifesto = """{"id":"exemplo","nome":"Exemplo","icone":"grid","contrato":1,"rota":"/exemplo","porta":8080,"health":"/exemplo/api/health","tabelas":{"prefixo":"exemplo_","legadas":[]}}""";
    private Action? _aoSubir;
    private HttpStatusCode _health = HttpStatusCode.OK;

    private string Banco => Path.Combine(_pasta, "notas.db");

    public SincronizadorTests()
    {
        Directory.CreateDirectory(_pasta);
        Sql("CREATE TABLE notes(id TEXT); INSERT INTO notes VALUES ('nota-1');");
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(_pasta, true); } catch (IOException) { }
    }

    private void Sql(string sql)
    {
        using var c = new SqliteConnection($"Data Source={Banco};Pooling=False");
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    private SincronizadorDePlugins Criar() => new(
        new ConfiguracaoPlugins
        {
            Pasta = _pasta, ArquivoLock = Path.Combine(_pasta, "plugins.lock"), Banco = Banco, BancoNoHost = "/opt/notas-vps/data/db",
            EsperaHealth = TimeSpan.FromSeconds(3),
        },
        (args, _) =>
        {
            _chamadas.Add(args);
            if (args[0] == "run" && args.Contains("cat")) return Task.FromResult(new Resultado(0, _manifesto, ""));
            if (args[0] == "run" && args[^1].EndsWith(":v2")) _aoSubir?.Invoke();
            if (args[0] == "inspect") return Task.FromResult(new Resultado(0, "true", ""));
            return Task.FromResult(new Resultado(0, "", ""));
        },
        new HttpClient(new HealthFalso(() => _health)), NullLogger.Instance);

    private sealed class HealthFalso(Func<HttpStatusCode> status) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(status()));
    }

    private static List<EntradaLock> Lock(string versao, bool ativo = true) =>
        [new("exemplo", "ghcr.io/victorsouzadev/hub-exemplo", versao, ativo)];

    private List<string> Run() => _chamadas.Last(a => a[0] == "run" && !a.Contains("cat"));

    [Fact]
    public async Task Sobe_com_banco_montado_sem_segredos_e_grava_caddy()
    {
        var s = Criar();
        await s.Sincronizar(Lock("v1"), default);

        var run = string.Join(' ', Run());
        Assert.Contains("/opt/notas-vps/data/db:/data/db", run);
        Assert.DoesNotContain("core", run.Replace("HUB_NUCLEO", ""));
        Assert.DoesNotContain("JWT_SECRET", run);
        Assert.Contains("--name plugin-exemplo", run);
        Assert.True(File.Exists(Path.Combine(_pasta, "caddy", "exemplo.caddy")));
        Assert.Contains(_chamadas, a => a[0] == "exec" && a.Contains("reload"));
        var e = s.LerEstado()["exemplo"];
        Assert.True(e.NoAr);
        Assert.Equal("v1", e.Versao);
        Assert.Single(Directory.GetFiles(Path.Combine(_pasta, "copias")));
        var segredo = Run().Single(a => a.StartsWith("HUB_SEGREDO_SERVICO="))["HUB_SEGREDO_SERVICO=".Length..];
        Assert.True(segredo.Length >= 40);
        Assert.Equal(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(segredo))).ToLowerInvariant(),
            e.SegredoServicoHash);
        Assert.DoesNotContain(segredo, File.ReadAllText(Path.Combine(_pasta, "estado.json")));
    }

    [Fact]
    public async Task Mesma_versao_no_ar_nao_recria()
    {
        var s = Criar();
        await s.Sincronizar(Lock("v1"), default);
        var n = _chamadas.Count;
        await s.Sincronizar(Lock("v1"), default);
        Assert.DoesNotContain(_chamadas.Skip(n), a => a[0] == "pull");
    }

    [Fact]
    public async Task Migracao_que_mexe_em_tabela_alheia_volta_tudo()
    {
        var s = Criar();
        await s.Sincronizar(Lock("v1"), default);

        _aoSubir = () => Sql("DROP TABLE notes; CREATE TABLE exemplo_x(a);");
        await s.Sincronizar(Lock("v2"), default);

        var e = s.LerEstado()["exemplo"];
        Assert.Equal("v1", e.Versao);
        Assert.Contains("notes", e.UltimaFalha);
        Assert.Contains("hub-exemplo:v1", string.Join(' ', Run())); // voltou para a anterior
        using var c = new SqliteConnection($"Data Source={Banco};Pooling=False");
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id FROM notes";
        Assert.Equal("nota-1", cmd.ExecuteScalar());
    }

    [Fact]
    public async Task Health_que_nao_responde_mantem_a_anterior()
    {
        var s = Criar();
        await s.Sincronizar(Lock("v1"), default);
        _health = HttpStatusCode.InternalServerError;
        await s.Sincronizar(Lock("v2"), default);
        var e = s.LerEstado()["exemplo"];
        Assert.Equal("v1", e.Versao);
        Assert.Contains("health", e.UltimaFalha);
    }

    [Fact]
    public async Task Manifesto_invalido_nao_sobe()
    {
        _manifesto = _manifesto.Replace("\"/exemplo\",\"porta\"", "\"/api\",\"porta\"");
        var s = Criar();
        await s.Sincronizar(Lock("v1"), default);
        Assert.DoesNotContain(_chamadas, a => a[0] == "run" && !a.Contains("cat"));
        Assert.False(s.LerEstado()["exemplo"].NoAr);
    }

    [Fact]
    public async Task Desligar_para_o_container_e_mantem_os_dados()
    {
        var s = Criar();
        await s.Sincronizar(Lock("v1"), default);
        await s.Sincronizar(Lock("v1", ativo: false), default);
        Assert.Contains(_chamadas, a => a is ["rm", "-f", "plugin-exemplo"]);
        Assert.False(File.Exists(Path.Combine(_pasta, "caddy", "exemplo.caddy")));
        Assert.False(s.LerEstado()["exemplo"].Ativo);
        Assert.True(File.Exists(Banco));
    }
}
