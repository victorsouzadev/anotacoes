using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Notas.Api.Services.Financas.Llm;
using Notas.Api.Services.Imagens;
using Xunit;

namespace Notas.Api.Tests;

// Nomear os elementos do editor: o que interessa é que o nome volte utilizável
// como arquivo e que uma falha do provedor não derrube a exportação.
public class NomeadorDeElementosTests
{
    private const string Imagem = "data:image/png;base64,iVBORw0KGgo=";

    private static (NomeadorDeElementos Nomeador, HandlerRoteirizado Handler) Montar(
        string provedor = "openrouter", string? chave = "k-teste")
    {
        var handler = new HandlerRoteirizado();
        var nomeador = new NomeadorDeElementos(
            new FabricaDeCredenciais(provedor, chave),
            new FabricaDeClienteFixa(handler),
            Options.Create(new OpenRouterOptions { ApiKey = "servidor", BaseUrl = "https://exemplo.invalido/v1" }),
            NullLogger<NomeadorDeElementos>.Instance);
        return (nomeador, handler);
    }

    private static string RespostaCom(params string[] nomes) =>
        JsonSerializer.Serialize(new
        {
            choices = new[]
            {
                new { message = new { content = JsonSerializer.Serialize(new { nomes }) } },
            },
        });

    [Fact]
    public async Task Devolve_os_nomes_na_ordem_das_imagens()
    {
        var (nomeador, handler) = Montar();
        handler.Responde(HttpStatusCode.OK, RespostaCom("polvo-maria-clara", "tartaruga-marinha"));

        var r = await nomeador.NomearAsync("u1", new[] { Imagem, Imagem });

        Assert.True(r.UsouIa);
        Assert.Equal(new[] { "polvo-maria-clara", "tartaruga-marinha" }, r.Nomes);
        // as duas miniaturas precisam ter ido junto, senão a IA nomeia às cegas
        Assert.Equal(2, CountOcorrencias(handler.CorposEnviados[0], "\u0022type\u0022:\u0022image_url\u0022"));
    }

    [Fact]
    public async Task Sanea_o_que_a_ia_devolve()
    {
        var (nomeador, handler) = Montar();
        handler.Responde(HttpStatusCode.OK, RespostaCom("Polvo \"Maria Clara\"/2", "Coração É Assim.svg"));

        var r = await nomeador.NomearAsync("u1", new[] { Imagem, Imagem });

        Assert.Equal(new[] { "polvo-maria-clara-2", "coracao-e-assim-svg" }, r.Nomes);
    }

    [Fact]
    public async Task Resposta_com_quantidade_errada_nao_serve()
    {
        // meio nome é pior que nome nenhum: renomearia o arquivo errado
        var (nomeador, handler) = Montar();
        handler.Responde(HttpStatusCode.OK, RespostaCom("so-um"));

        var r = await nomeador.NomearAsync("u1", new[] { Imagem, Imagem });

        Assert.False(r.UsouIa);
        Assert.Empty(r.Nomes);
        Assert.NotNull(r.Motivo);
    }

    [Fact]
    public async Task Provedor_sem_visao_avisa_em_vez_de_chamar()
    {
        var (nomeador, handler) = Montar(provedor: "heuristico", chave: null);

        var r = await nomeador.NomearAsync("u1", new[] { Imagem });

        Assert.False(r.UsouIa);
        Assert.Equal(0, handler.Chamadas);
        Assert.Contains("OpenRouter", r.Motivo);
    }

    [Fact]
    public async Task Falha_do_provedor_volta_como_motivo_e_nao_como_excecao()
    {
        var (nomeador, handler) = Montar();
        handler.Responde(HttpStatusCode.Unauthorized, "{\"error\":{\"message\":\"no\"}}");

        var r = await nomeador.NomearAsync("u1", new[] { Imagem });

        Assert.False(r.UsouIa);
        Assert.Contains("chave", r.Motivo);
    }

    [Theory]
    [InlineData("Polvo Maria Clara", "polvo-maria-clara")]
    [InlineData("  ---  ", "")]
    [InlineData("Ação/Coração", "acao-coracao")]
    public void Sanear_deixa_o_nome_utilizavel(string bruto, string esperado)
        => Assert.Equal(esperado, NomeadorDeElementos.Sanear(bruto));

    private static int CountOcorrencias(string texto, string agulha)
    {
        var total = 0;
        for (var i = texto.IndexOf(agulha, StringComparison.Ordinal); i >= 0;
             i = texto.IndexOf(agulha, i + agulha.Length, StringComparison.Ordinal)) total++;
        return total;
    }

    private sealed class FabricaDeCredenciais : ILlmExtractorFactory
    {
        private readonly CredenciaisLlm _credenciais;
        public FabricaDeCredenciais(string provedor, string? chave)
            => _credenciais = new CredenciaisLlm(provedor, chave, "modelo-de-teste");

        public Task<CredenciaisLlm> ResolverCredenciaisAsync(string userId, CancellationToken ct = default)
            => Task.FromResult(_credenciais);

        public Task<ConfiguracaoEfetiva> ResolverAsync(string userId, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<ILlmExtractor> CriarAsync(string userId, CancellationToken ct = default)
            => throw new NotSupportedException();
        public ILlmExtractor CriarAvulso(string provedor, string? chave, string? modelo)
            => throw new NotSupportedException();
    }

    private sealed class FabricaDeClienteFixa : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;
        public FabricaDeClienteFixa(HttpMessageHandler handler) => _handler = handler;
        public HttpClient CreateClient(string name) => new(_handler, disposeHandler: false);
    }
}
