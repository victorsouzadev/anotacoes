using System.Net;
using Microsoft.Extensions.Options;
using Notas.Api.Services.Financas.Auvp;
using Xunit;

namespace Notas.Api.Tests;

// O cliente HTTP da AUVP contra respostas montadas: as mensagens de erro são a
// única pista do usuário quando algo é recusado lá.
public class AuvpClienteTests
{
    private sealed class Resposta(HttpStatusCode status, string corpo) : HttpMessageHandler
    {
        public HttpRequestMessage? Recebida { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Recebida = request;
            return Task.FromResult(new HttpResponseMessage(status)
            {
                Content = new StringContent(corpo, System.Text.Encoding.UTF8, "application/json"),
            });
        }
    }

    private sealed class Fabrica(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private static AuvpCliente Cliente(HttpMessageHandler h) =>
        new(new Fabrica(h), Options.Create(new AuvpOptions { BaseUrl = "https://auvp.test" }));

    [Fact]
    public async Task Leitura_recusada_diz_que_a_chave_foi_recusada()
    {
        var h = new Resposta(HttpStatusCode.Unauthorized, """{"message":"API key inválida","statusCode":401}""");
        var ex = await Assert.ThrowsAsync<AuvpIndisponivelException>(() =>
            Cliente(h).ListarTagsAsync("auvp_x", CancellationToken.None));
        Assert.True(ex.ChaveRecusada);
        Assert.Contains("API key inválida", ex.Message);
        Assert.Equal("Bearer auvp_x", h.Recebida!.Headers.Authorization!.ToString());
    }

    [Fact]
    public async Task Escrita_recusada_aponta_falta_de_permissao_e_nao_a_chave()
    {
        var h = new Resposta(HttpStatusCode.Forbidden, """{"message":"Forbidden resource","statusCode":403}""");
        var ex = await Assert.ThrowsAsync<AuvpIndisponivelException>(() =>
            Cliente(h).AtualizarTransacaoAsync("auvp_x", 1, new AuvpAlteracao(Ignorar: true), CancellationToken.None));
        Assert.False(ex.ChaveRecusada);
        Assert.Contains("somente leitura", ex.Message);
        Assert.Contains("Forbidden resource", ex.Message);
        Assert.Equal(HttpMethod.Patch, h.Recebida!.Method);
    }
}
