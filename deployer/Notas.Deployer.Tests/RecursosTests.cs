using Notas.Deployer;
using Xunit;

namespace Notas.Deployer.Tests;

/// <summary>Spec 040 (T007 e T008): leituras do painel.</summary>
public class RecursosTests
{
    private static Resultado Ok(string s) => new(0, s, "");

    [Fact]
    public void Le_memoria_plugins_e_conexoes()
    {
        var r = Recursos.Montar("MemTotal:        2014208 kB\nMemFree: 1 kB\nMemAvailable:     307200 kB\n",
            Ok("plugin-notas\t45.6MiB / 256MiB\nnotas-caddy\t20MiB / 1.9GiB\nplugin-x\t1.5GiB / 2GiB\nplugin-parado\t-- / --\n"), Ok("17|60\n"));
        Assert.Equal((1967, 300, 17, 60), (r.MemoriaTotalMb!.Value, r.MemoriaLivreMb!.Value, r.Conexoes!.Value, r.ConexoesMaximas!.Value));
        Assert.Equal([new("notas", 46, 256), new("x", 1536, 2048)], r.Plugins!);
    }

    [Fact]
    public void Fonte_fora_do_ar_vira_nulo()
    {
        var r = Recursos.Montar("", new(-1, "", "x"), new(1, "", "x"));
        Assert.Equal(new RecursosLidos(null, null, null, null, null), r);
    }

    [Theory]
    [InlineData(0, "", true)]
    [InlineData(1, "no such manifest: ghcr.io/x", false)]
    [InlineData(1, "manifest unknown", false)]
    [InlineData(1, "denied", null)]
    [InlineData(-1, "passou de 8 s", null)]
    public void Imagem_publicada(int codigo, string erro, bool? esperado) => Assert.Equal(esperado, Recursos.Publicada(new(codigo, "", erro)));

    [Theory]
    [InlineData("67b48da", true)]
    [InlineData("67b48da\n", false)]
    [InlineData("latest", false)]
    [InlineData("67b48da; rm", false)]
    public void Versao_e_o_commit_curto(string v, bool vale) => Assert.Equal(vale, Recursos.VersaoValida(v));

    private static (PreparoDoBanco P, ConfiguracaoPlugins Cfg, List<string> Conexoes) Preparo(Resultado r)
    {
        var cfg = new ConfiguracaoPlugins { Pasta = Directory.CreateTempSubdirectory("preparo").FullName, BancoNoHost = "/x" };
        var abertas = new List<string>();
        return (new PreparoDoBanco(cfg, "pg", (_, _) => Task.FromResult(r), (c, _) => { abertas.Add(c); return Task.FromResult(true); }), cfg, abertas);
    }

    private static void Gravar(ConfiguracaoPlugins cfg, string id, string texto)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(cfg.ArquivoBanco(id))!);
        File.WriteAllText(cfg.ArquivoBanco(id), texto);
    }

    [Fact]
    public async Task Sem_nada_nao_testa_a_conexao()
    {
        var (p, _, abertas) = Preparo(Ok("f||f\n"));
        Assert.Equal(new PreparoConferido(false, false, null, false, false, null), await p.Conferir("novo", default));
        Assert.Empty(abertas);
    }

    [Fact]
    public async Task Pronto_conecta_com_o_papel_do_plugin()
    {
        var (p, cfg, abertas) = Preparo(Ok("t|novo|t\n"));
        Gravar(cfg, "novo", "Host=pg;Database=hub;Username=novo;Password=segredo-falso\n");
        var c = await p.Conferir("novo", default);
        Assert.Equal(new PreparoConferido(true, true, "novo", true, true, true), c);
        Assert.Single(abertas);
        Assert.DoesNotContain("segredo-falso", System.Text.Json.JsonSerializer.Serialize(c));
    }

    [Theory]
    [InlineData("Host=pg;Database=hub;Username=outro;Password=x")]
    [InlineData("isto não é conexão")]
    public async Task Conexao_de_outro_papel_ou_invalida_nao_conecta(string texto)
    {
        var (p, cfg, abertas) = Preparo(Ok("t|novo|t\n"));
        Gravar(cfg, "novo", texto);
        Assert.False((await p.Conferir("novo", default))!.Conecta);
        Assert.Empty(abertas);
    }

    [Fact]
    public async Task Postgres_fora_do_ar_vira_nulo() => Assert.Null(await Preparo(new(1, "", "boom")).P.Conferir("novo", default));

    [Theory]
    [InlineData("postgres")]
    [InlineData("a'; DROP ROLE x; --")]
    public async Task Id_perigoso_nao_chega_ao_sql(string id) =>
        await Assert.ThrowsAsync<ArgumentException>(() => Preparo(Ok("")).P.Conferir(id, default));
}
