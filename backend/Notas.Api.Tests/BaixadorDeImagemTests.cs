using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Notas.Api.Services.Moldes;
using Xunit;

namespace Notas.Api.Tests;

// Baixar imagem de link colado: tem de funcionar com link direto e com página
// (pin do Pinterest), e nunca virar ponte pra rede interna do servidor.
public class BaixadorDeImagemTests
{
    private static readonly byte[] Png = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0 };
    private static readonly byte[] Jpg = { 0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10 };

    private sealed class Rede : HttpMessageHandler
    {
        public readonly Dictionary<string, Func<HttpResponseMessage>> Rotas = new();
        public readonly List<string> Pedidos = new();

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var url = request.RequestUri!.ToString();
            Pedidos.Add(url);
            return Task.FromResult(Rotas.TryGetValue(url, out var f) ? f() : new HttpResponseMessage(HttpStatusCode.NotFound));
        }
    }

    private sealed class Resolvedor : IResolvedorDeHost
    {
        public Task<IPAddress[]> ResolverAsync(string host, CancellationToken ct) =>
            Task.FromResult(host.StartsWith("interno") ? new[] { IPAddress.Parse("10.0.0.5") } : new[] { IPAddress.Parse("93.184.216.34") });
    }

    private sealed class Fabrica : IHttpClientFactory
    {
        private readonly HttpMessageHandler _h;
        public Fabrica(HttpMessageHandler h) => _h = h;
        public HttpClient CreateClient(string name) => new(_h, disposeHandler: false);
    }

    private static (BaixadorDeImagem, Rede) Montar()
    {
        var rede = new Rede();
        return (new BaixadorDeImagem(new Fabrica(rede), new Resolvedor(), NullLogger<BaixadorDeImagem>.Instance), rede);
    }

    private static HttpResponseMessage Bytes(byte[] b, string tipo = "application/octet-stream")
    {
        var c = new ByteArrayContent(b);
        c.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(tipo);
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = c };
    }

    private static HttpResponseMessage Html(string html) =>
        new(HttpStatusCode.OK) { Content = new StringContent(html, Encoding.UTF8, "text/html") };

    private static HttpResponseMessage Redireciona(string para)
    {
        var r = new HttpResponseMessage(HttpStatusCode.Found);
        r.Headers.Location = new Uri(para);
        return r;
    }

    [Fact]
    public async Task Link_direto_vira_data_url_pelo_tipo_do_arquivo()
    {
        var (b, rede) = Montar();
        // o site diz octet-stream, mas os bytes são de PNG
        rede.Rotas["https://site.exemplo/molde.png"] = () => Bytes(Png);
        var r = await b.BaixarAsync("https://site.exemplo/molde.png");
        Assert.True(r.Ok);
        Assert.StartsWith("data:image/png;base64,", r.DataUrl);
    }

    [Fact]
    public async Task Pin_do_pinterest_pega_a_imagem_original_da_pagina()
    {
        var (b, rede) = Montar();
        rede.Rotas["https://pin.it/abc"] = () => Redireciona("https://br.pinterest.com/pin/123/");
        rede.Rotas["https://br.pinterest.com/pin/123/"] = () => Html(
            "<html><head><meta content=\"https://i.pinimg.com/736x/aa/bb/cc/molde.jpg\" property=\"og:image\"/></head></html>");
        rede.Rotas["https://i.pinimg.com/originals/aa/bb/cc/molde.jpg"] = () => Bytes(Jpg, "image/jpeg");

        var r = await b.BaixarAsync("https://pin.it/abc");

        Assert.True(r.Ok, r.Motivo);
        Assert.StartsWith("data:image/jpeg;base64,", r.DataUrl);
        Assert.Contains("https://i.pinimg.com/originals/aa/bb/cc/molde.jpg", rede.Pedidos);
    }

    [Fact]
    public async Task Sem_originals_cai_na_imagem_que_a_pagina_anuncia()
    {
        var (b, rede) = Montar();
        rede.Rotas["https://br.pinterest.com/pin/9/"] = () => Html(
            "<meta property='og:image' content='https://i.pinimg.com/736x/x/y.jpg'>");
        rede.Rotas["https://i.pinimg.com/736x/x/y.jpg"] = () => Bytes(Jpg);
        var r = await b.BaixarAsync("https://br.pinterest.com/pin/9/");
        Assert.True(r.Ok, r.Motivo);
    }

    [Theory]
    [InlineData("http://127.0.0.1/a.png")]
    [InlineData("http://169.254.169.254/latest/meta-data")]
    [InlineData("http://[::1]/a.png")]
    [InlineData("https://interno.exemplo/a.png")]
    [InlineData("http://site.exemplo:8080/a.png")]
    [InlineData("file:///etc/passwd")]
    [InlineData("ftp://site.exemplo/a.png")]
    public async Task Endereco_interno_porta_ou_esquema_estranho_nem_e_pedido(string url)
    {
        var (b, rede) = Montar();
        var r = await b.BaixarAsync(url);
        Assert.False(r.Ok);
        Assert.Empty(rede.Pedidos);
    }

    [Fact]
    public async Task Redirecionamento_para_rede_interna_e_barrado()
    {
        var (b, rede) = Montar();
        rede.Rotas["https://site.exemplo/foto"] = () => Redireciona("http://interno.exemplo/admin");
        var r = await b.BaixarAsync("https://site.exemplo/foto");
        Assert.False(r.Ok);
        Assert.Contains("interno", r.Motivo);
        Assert.DoesNotContain(rede.Pedidos, p => p.Contains("interno"));
    }

    [Fact]
    public async Task Pagina_sem_imagem_e_arquivo_que_nao_e_imagem_explicam()
    {
        var (b, rede) = Montar();
        rede.Rotas["https://site.exemplo/vazia"] = () => Html("<html><body>nada</body></html>");
        rede.Rotas["https://site.exemplo/doc.pdf"] = () => Bytes(Encoding.ASCII.GetBytes("%PDF-1.4"), "application/pdf");
        Assert.Contains("imagem", (await b.BaixarAsync("https://site.exemplo/vazia")).Motivo);
        Assert.Contains("não é de uma imagem", (await b.BaixarAsync("https://site.exemplo/doc.pdf")).Motivo);
    }

    [Theory]
    [InlineData("8.8.8.8", true)]
    [InlineData("93.184.216.34", true)]
    [InlineData("10.1.2.3", false)]
    [InlineData("172.20.0.1", false)]
    [InlineData("192.168.0.10", false)]
    [InlineData("100.64.0.1", false)]
    [InlineData("0.0.0.0", false)]
    [InlineData("224.0.0.1", false)]
    [InlineData("::ffff:127.0.0.1", false)]
    [InlineData("fd00::1", false)]
    [InlineData("fe80::1", false)]
    [InlineData("2606:4700:4700::1111", true)]
    public void So_ip_publico_passa(string ip, bool publico)
        => Assert.Equal(publico, BaixadorDeImagem.EnderecoPublico(IPAddress.Parse(ip)));

    [Fact]
    public void Le_og_image_em_qualquer_ordem_de_atributo_e_twitter_image()
    {
        var u = BaixadorDeImagem.ImagensDaPagina(
            "<meta name=\"twitter:image\" content=\"/img/a.png\"><meta content=\"https://cdn.exemplo/b.jpg?x=1&amp;y=2\" property=\"og:image\">",
            new Uri("https://site.exemplo/pagina"));
        Assert.Equal(new[] { "https://site.exemplo/img/a.png", "https://cdn.exemplo/b.jpg?x=1&y=2" }, u.Select(x => x.ToString()));
    }
}

public class ImagemDoLinkEndpointTests : IClassFixture<TasksApiFactory>
{
    private readonly TasksApiFactory _factory;
    public ImagemDoLinkEndpointTests(TasksApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Exige_login_e_link()
    {
        var anonimo = await _factory.CreateClient().PostAsJsonAsync("/api/moldes/imagem-do-link", new { url = "https://site.exemplo/a.png" });
        Assert.Equal(HttpStatusCode.Unauthorized, anonimo.StatusCode);

        var email = $"link_{Guid.NewGuid():N}@example.com";
        var reg = await _factory.CreateClient().PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        var token = (await reg.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/moldes/imagem-do-link", new { url = "" })).StatusCode);
        // endereço interno volta como erro explicado, sem o servidor buscar nada
        var interno = await c.PostAsJsonAsync("/api/moldes/imagem-do-link", new { url = "http://127.0.0.1/a.png" });
        Assert.Equal(HttpStatusCode.BadRequest, interno.StatusCode);
        Assert.Contains("interno", (await interno.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("erro").GetString());
    }
}
