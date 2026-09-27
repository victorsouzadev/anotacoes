using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Notas.Api.Services.Financas.Llm;
using Notas.Api.Services.Imagens;
using Xunit;

namespace Notas.Api.Tests;

// Legendas de Instagram: o que importa é que as opções voltem prontas pra colar
// (hashtag sem espaço, tamanho dentro do limite) e que falta de IA vire aviso.
public class LegendistaInstagramTests
{
    private const string Imagem = "data:image/jpeg;base64,/9j/4AAQ";

    private static readonly PedidoLegenda Pedido = new(
        Imagem, new[] { "topo de bolo", "ENCOMENDE PELO DIRECT" }, "feed", "carinhoso",
        "topo de bolo de unicórnio", "Viih Mimos, papelaria personalizada em Marabá-PA. @viihmimos_");

    private static (LegendistaInstagram Legendista, HandlerRoteirizado Handler) Montar(
        string provedor = "openrouter", string? chave = "k-teste")
    {
        var handler = new HandlerRoteirizado();
        var legendista = new LegendistaInstagram(
            new FabricaDeCredenciais(provedor, chave),
            new FabricaDeClienteFixa(handler),
            Options.Create(new OpenRouterOptions { ApiKey = "servidor", BaseUrl = "https://exemplo.invalido/v1" }),
            Options.Create(new AnthropicOptions { BaseUrl = "https://anthropic.invalido/v1/messages" }),
            NullLogger<LegendistaInstagram>.Instance);
        return (legendista, handler);
    }

    private static string Conteudo(params (string Texto, string[] Hashtags)[] legendas) =>
        JsonSerializer.Serialize(new { legendas = legendas.Select(l => new { texto = l.Texto, hashtags = l.Hashtags }) });

    [Fact]
    public async Task OpenRouter_recebe_a_previa_e_devolve_as_opcoes()
    {
        var (legendista, handler) = Montar();
        handler.RespondeOk(Conteudo(
            ("um topo de bolo pra festa mais doce 🦄", new[] { "#topodebolo", "#maraba" }),
            ("sabe aquele detalhe que faz a festa?", new[] { "#festainfantil" }),
            ("chegou unicórnio no ateliê 💕", new[] { "#viihmimos" })));

        var r = await legendista.SugerirAsync("u1", Pedido);

        Assert.True(r.UsouIa);
        Assert.Equal(3, r.Legendas.Count);
        Assert.Equal(new[] { "#topodebolo", "#maraba" }, r.Legendas[0].Hashtags);
        var enviado = handler.CorposEnviados[0];
        Assert.Contains("image_url", enviado);
        Assert.Contains("topo de bolo de unic", enviado);
        Assert.Contains("@viihmimos_", enviado);
    }

    [Fact]
    public async Task Anthropic_manda_a_imagem_em_base64_e_le_o_texto()
    {
        var (legendista, handler) = Montar(provedor: "anthropic");
        handler.Responde(HttpStatusCode.OK, JsonSerializer.Serialize(new
        {
            content = new[] { new { type = "text", text = "Aqui está:\n```json\n" + Conteudo(("oi", new[] { "#a" })) + "\n```" } },
        }));

        var r = await legendista.SugerirAsync("u1", Pedido);

        Assert.True(r.UsouIa);
        Assert.Equal("oi", r.Legendas.Single().Texto);
        using var corpo = JsonDocument.Parse(handler.CorposEnviados[0]);
        var imagem = corpo.RootElement.GetProperty("messages")[0].GetProperty("content")[0];
        Assert.Equal("image", imagem.GetProperty("type").GetString());
        Assert.Equal("image/jpeg", imagem.GetProperty("source").GetProperty("media_type").GetString());
        Assert.Equal("/9j/4AAQ", imagem.GetProperty("source").GetProperty("data").GetString());
        Assert.Equal("k-teste", handler.Cabecalhos[0]["x-api-key"]);
    }

    [Fact]
    public void Arruma_hashtag_e_corta_o_excesso()
    {
        var longa = new string('a', LegendistaInstagram.MaxLegenda + 50);
        var corpo = JsonSerializer.Serialize(new
        {
            choices = new[] { new { message = new { content = Conteudo(
                (longa, new[] { "Topo de Bolo", "#Marabá-PA", "#topodebolo", "", "#" })) } } },
        });

        var legendas = LegendistaInstagram.LerLegendas(corpo, anthropic: false);

        Assert.Equal(LegendistaInstagram.MaxLegenda, legendas[0].Texto.Length);
        Assert.Equal(new[] { "#topodebolo", "#marabápa" }, legendas[0].Hashtags);
    }

    [Fact]
    public async Task Sem_provedor_avisa_em_vez_de_chamar()
    {
        var (legendista, handler) = Montar(provedor: "heuristico", chave: null);

        var r = await legendista.SugerirAsync("u1", Pedido);

        Assert.False(r.UsouIa);
        Assert.Empty(r.Legendas);
        Assert.Contains("Configurações", r.Motivo);
        Assert.Equal(0, handler.Chamadas);
    }

    [Fact]
    public async Task Chave_recusada_vira_motivo_legivel()
    {
        var (legendista, handler) = Montar();
        handler.Responde(HttpStatusCode.Unauthorized, "{\"error\":\"bad key\"}");

        var r = await legendista.SugerirAsync("u1", Pedido);

        Assert.False(r.UsouIa);
        Assert.Contains("chave", r.Motivo);
    }

    [Fact]
    public void Prompt_de_story_pede_texto_curto_e_de_carrossel_pede_arrastar()
    {
        Assert.Contains("duas linhas", LegendistaInstagram.Prompt(Pedido with { Formato = "story" }));
        Assert.Contains("arrastar", LegendistaInstagram.Prompt(Pedido with { Formato = "carrossel" }));
        Assert.Contains("divertido", LegendistaInstagram.Prompt(Pedido with { Tom = "divertido" }));
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
