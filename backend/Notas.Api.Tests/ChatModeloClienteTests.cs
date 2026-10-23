using System.Net;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Notas.Api.Services.Financas.Chat;
using Notas.Api.Services.Financas.Llm;
using Xunit;

namespace Notas.Api.Tests;

// O cliente HTTP do chat: repete em 429 passageiro e manda os modelos reserva para a OpenRouter.
public class ChatModeloClienteTests
{
    private sealed class Roteiro(params HttpResponseMessage[] respostas) : HttpMessageHandler
    {
        private int _i;
        public List<string> Corpos { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
        {
            Corpos.Add(await req.Content!.ReadAsStringAsync(ct));
            return respostas[Math.Min(_i++, respostas.Length - 1)];
        }
    }

    private sealed class Fabrica(HttpMessageHandler h) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(h, disposeHandler: false);
    }

    private static HttpResponseMessage Limite(string msg = "rate-limited upstream")
    {
        var r = new HttpResponseMessage(HttpStatusCode.TooManyRequests) { Content = new StringContent(new JsonObject { ["error"] = new JsonObject { ["message"] = msg } }.ToJsonString()) };
        r.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.Zero);
        return r;
    }

    private static ChatModeloCliente Cliente(Roteiro h) => new(new Fabrica(h), Options.Create(new AnthropicOptions()),
        Options.Create(new OpenRouterOptions()), NullLogger<ChatModeloCliente>.Instance);

    private static readonly CredenciaisLlm Cred = new("openrouter", "k", "google/gemini-3.6-flash");

    [Fact]
    public async Task Repete_depois_de_429_e_manda_os_modelos_reserva()
    {
        var h = new Roteiro(Limite(), new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("""{"choices":[]}""") });
        var r = await Cliente(h).EnviarAsync(Cred, new JsonObject { ["model"] = Cred.Modelo }, CancellationToken.None);
        Assert.NotNull(r["choices"]);
        Assert.Equal(2, h.Corpos.Count);
        var modelos = JsonNode.Parse(h.Corpos[0])!["models"]!.AsArray().Select(m => m!.GetValue<string>()).ToList();
        Assert.Equal("google/gemini-3.6-flash", modelos[0]);
        Assert.True(modelos.Count > 1);
    }

    [Fact]
    public async Task Desiste_depois_de_tres_429_e_mostra_a_mensagem_do_provedor()
    {
        var h = new Roteiro(Limite(), Limite(), Limite("Gemini sem capacidade"));
        var e = await Assert.ThrowsAsync<ChatIndisponivelException>(() =>
            Cliente(h).EnviarAsync(Cred, new JsonObject(), CancellationToken.None));
        Assert.Equal(3, h.Corpos.Count);
        Assert.Contains("Gemini sem capacidade", e.Message);
    }
}
