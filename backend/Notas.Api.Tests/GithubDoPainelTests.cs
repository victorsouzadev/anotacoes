using System.Net;
using Microsoft.Extensions.Options;
using Notas.Api.Services.Painel;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>Spec 040 (T006): o GitHub do painel só lê e só nos destinos do contrato.</summary>
public class GithubDoPainelTests
{
    private const string Token = "github_pat_segredo_de_teste";

    private sealed class Falso(Func<HttpRequestMessage, HttpResponseMessage> f) : HttpMessageHandler
    {
        public readonly List<HttpRequestMessage> Pedidos = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
        {
            Pedidos.Add(r);
            return Task.FromResult(f(r));
        }
    }

    private static (GithubDoPainel G, Falso H) Criar(Func<string, (HttpStatusCode, string)> f, string token = Token)
    {
        var h = new Falso(r =>
        {
            var (c, t) = f(r.RequestUri!.PathAndQuery);
            return new HttpResponseMessage(c) { Content = new StringContent(t) };
        });
        return (new GithubDoPainel(new HttpClient(h), Options.Create(new PainelOptions { GithubLeitura = token })), h);
    }

    [Theory]
    [InlineData("https://api.github.com/repos/victorsouzadev/hub-dieta/commits?sha=main&per_page=10", true)]
    [InlineData("https://api.github.com/repos/victorsouzadev/hub-dieta/contents/plugin.json?ref=abc1234", true)]
    [InlineData("https://api.github.com/user/repos?affiliation=owner&per_page=100&page=1", true)]
    [InlineData("https://api.github.com/repos/outro/hub-dieta/commits?sha=main&per_page=10", false)]
    [InlineData("https://api.github.com/repos/victorsouzadev/anotacoes/pulls", false)]
    [InlineData("https://api.github.com/repos/victorsouzadev/hub-nucleo/commits?sha=main&per_page=10", false)]
    [InlineData("https://api.github.com/repos/victorsouzadev/hub-dieta/contents/.env?ref=abc1234", false)]
    [InlineData("https://api.github.com/repos/victorsouzadev/hub-dieta/contents/plugin.json?ref=main", false)]
    [InlineData("https://api.github.com:444/user/repos?affiliation=owner&per_page=100&page=1", false)]
    [InlineData("http://api.github.com/user/repos?affiliation=owner&per_page=100&page=1", false)]
    [InlineData("https://api.github.com.mau.com/user/repos?affiliation=owner&per_page=100&page=1", false)]
    [InlineData("https://x@api.github.com/user/repos?affiliation=owner&per_page=100&page=1", false)]
    public void So_os_destinos_do_contrato(string url, bool vale) =>
        Assert.Equal(vale, GithubDoPainel.UrlPermitida(new Uri(url), "victorsouzadev"));

    [Theory]
    [InlineData("../anotacoes")]
    [InlineData("dieta/../../x")]
    [InlineData("dieta?x=1")]
    [InlineData("postgres")]
    public async Task Id_que_foge_do_caminho_nao_sai_da_vps(string id)
    {
        var (g, h) = Criar(_ => (HttpStatusCode.OK, "[]"));
        await Assert.ThrowsAsync<GithubException>(() => g.CommitsAsync(id, default));
        Assert.Empty(h.Pedidos);
    }

    [Fact]
    public async Task Lista_so_os_hub_do_dono_sem_modelo_exemplo_e_arquivados()
    {
        static string R(string nome, string dono = "victorsouzadev", bool arq = false) =>
            $$"""{"name":"{{nome}}","owner":{"login":"{{dono}}"},"archived":{{(arq ? "true" : "false")}}}""";
        var (g, h) = Criar(_ => (HttpStatusCode.OK,
            $"[{R("hub-treino")},{R("hub-dieta")},{R("hub-modelo")},{R("hub-exemplo")},{R("anotacoes")},{R("hub-x", "outro")},{R("hub-velho", arq: true)},{R("hub-postgres")}]"));
        Assert.Equal(["dieta", "treino"], await g.IdsAsync(default));
        Assert.All(h.Pedidos, p => Assert.Equal(HttpMethod.Get, p.Method));
        Assert.Equal("Bearer " + Token, h.Pedidos[0].Headers.Authorization!.ToString());
    }

    [Fact]
    public async Task Commits_e_ci_por_commit_curto()
    {
        var (g, _) = Criar(u => (HttpStatusCode.OK, u.Contains("/commits")
            ? """[{"sha":"abc1234def","commit":{"message":"Muda X\n\ncorpo","committer":{"date":"2026-11-24T03:00:00Z"}}}]"""
            : """
              {"workflow_runs":[
                {"head_sha":"abc1234def","event":"push","status":"completed","conclusion":"success"},
                {"head_sha":"abc1234def","event":"push","status":"completed","conclusion":"skipped"},
                {"head_sha":"abc1234def","event":"workflow_dispatch","status":"completed","conclusion":"failure"},
                {"head_sha":"bbbbbbbdef","event":"push","status":"completed","conclusion":"failure"},
                {"head_sha":"cccccccdef","event":"push","status":"in_progress","conclusion":null}]}
              """));
        var c = Assert.Single(await g.CommitsAsync("dieta", default));
        Assert.Equal(("abc1234", "Muda X"), (c.Versao, c.Mensagem));
        var ci = await g.CiAsync("dieta", default);
        Assert.Equal((Etapas.Feita, Etapas.Falhou, Etapas.Pendente), (ci["abc1234"].Estado, ci["bbbbbbb"].Estado, ci["ccccccc"].Estado));
    }

    [Fact]
    public async Task Manifesto_que_nao_existe_e_nulo()
    {
        var (g, _) = Criar(_ => (HttpStatusCode.NotFound, ""));
        Assert.Null(await g.ManifestoAsync("dieta", "abc1234", default));
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.Redirect)]
    [InlineData(HttpStatusCode.InternalServerError)]
    public async Task Erro_nao_leva_o_token_nem_a_resposta(HttpStatusCode status)
    {
        var (g, _) = Criar(_ => (status, "eco " + Token));
        var e = await Assert.ThrowsAsync<GithubException>(() => g.IdsAsync(default));
        Assert.DoesNotContain("segredo", e.ToString());
    }

    [Fact]
    public async Task Sem_token_nao_chama()
    {
        var (g, h) = Criar(_ => (HttpStatusCode.OK, "[]"), token: "");
        Assert.False(g.Ligado);
        await Assert.ThrowsAsync<GithubException>(() => g.IdsAsync(default));
        Assert.Empty(h.Pedidos);
    }
}
