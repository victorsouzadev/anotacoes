using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Notas.Api.Services.Financas;
using Notas.Api.Services.Financas.Llm;
using Xunit;

namespace Notas.Api.Tests;

public class AnexoValidatorTests
{
    [Theory]
    [InlineData("cupom.jpg", "image/jpeg", "image/jpeg")]
    [InlineData("cupom.png", "image/png", "image/png")]
    [InlineData("extrato.pdf", "application/pdf", "application/pdf")]
    [InlineData("fatura.csv", "text/csv", "text/csv")]
    public void AceitaTipoDeclarado(string nome, string contentType, string esperado)
    {
        Assert.True(AnexoValidator.TryResolverTipo(nome, contentType, out var mime, out _));
        Assert.Equal(esperado, mime);
    }

    [Theory]
    // O navegador manda tipos diferentes para o mesmo .csv conforme o sistema, e
    // "application/octet-stream" é o que chega quando ele não sabe. A extensão
    // desempata em vez de recusar um arquivo válido.
    [InlineData("fatura.csv", "application/octet-stream", "text/csv")]
    [InlineData("cupom.jpeg", "application/octet-stream", "image/jpeg")]
    [InlineData("extrato.pdf", null, "application/pdf")]
    [InlineData("extrato.ofx", "", "text/plain")]
    public void CaiParaAExtensaoQuandoOTipoDeclaradoNaoServe(string nome, string? contentType, string esperado)
    {
        Assert.True(AnexoValidator.TryResolverTipo(nome, contentType, out var mime, out _));
        Assert.Equal(esperado, mime);
    }

    [Theory]
    [InlineData("virus.exe", "application/octet-stream")]
    [InlineData("planilha.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")]
    [InlineData("semextensao", null)]
    public void RecusaTipoNaoSuportado(string nome, string? contentType)
    {
        Assert.False(AnexoValidator.TryResolverTipo(nome, contentType, out _, out var erro));
        Assert.Contains("não suportado", erro!);
    }

    [Fact]
    public void RecusaArquivoDeTextoQueNaoEhUtf8()
    {
        // Bytes inválidos em UTF-8 virariam caracteres de substituição no prompt.
        var invalido = new AnexoExtracao("x.csv", "text/csv", new byte[] { 0xFF, 0xFE, 0x00, 0x41 });
        Assert.False(AnexoValidator.ConteudoEhTextoLegivel(invalido));
    }

    [Fact]
    public void AceitaTextoUtf8ComAcento()
    {
        var valido = new AnexoExtracao("x.csv", "text/csv", Encoding.UTF8.GetBytes("Alimentação;12,50"));
        Assert.True(AnexoValidator.ConteudoEhTextoLegivel(valido));
    }

    [Fact]
    public void ArquivoBinarioNaoPassaPelaChecagemDeTexto()
    {
        var imagem = new AnexoExtracao("f.png", "image/png", new byte[] { 0xFF, 0xD8, 0xFF });
        Assert.True(AnexoValidator.ConteudoEhTextoLegivel(imagem));
    }
}

// Integração do endpoint de importação. Sem chave de LLM configurada o servidor
// usa o extrator heurístico, que não lê arquivos — o que é justamente o caminho
// de erro que precisa estar claro.
public class ImportacaoApiTests : IClassFixture<ImportacaoApiTests.Contexto>
{
    public class Contexto : IAsyncLifetime
    {
        public TasksApiFactory Factory { get; } = new();
        public HttpClient Client { get; private set; } = null!;

        public async Task InitializeAsync()
        {
            Client = Factory.CreateClient();
            var res = await Factory.CreateClient().PostAsJsonAsync("/api/auth/register",
                new { email = $"imp_{Guid.NewGuid():N}@example.com", password = "Sup3rSecret!" });
            res.EnsureSuccessStatusCode();
            var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
            Client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        }

        public async Task DisposeAsync()
        {
            Client.Dispose();
            await Factory.DisposeAsync();
        }
    }

    private readonly HttpClient _client;

    public ImportacaoApiTests(Contexto ctx) => _client = ctx.Client;

    private static MultipartFormDataContent Arquivo(string nome, string contentType, byte[] conteudo, string? texto = null)
    {
        var form = new MultipartFormDataContent();
        var parte = new ByteArrayContent(conteudo);
        parte.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);
        form.Add(parte, "arquivos", nome);
        if (texto is not null) form.Add(new StringContent(texto), "texto");
        return form;
    }

    private Task<HttpResponseMessage> Importar(MultipartFormDataContent form) =>
        _client.PostAsync("/api/financas/transacoes/importar", form);

    private static async Task<string> Erro(HttpResponseMessage res)
    {
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        return body.TryGetProperty("erro", out var e) ? e.GetString()! : body.GetProperty("detail").GetString()!;
    }

    [Fact]
    public async Task CapacidadesInformamQueEsteServidorNaoLeArquivos()
    {
        var c = await _client.GetFromJsonAsync<JsonElement>("/api/financas/capacidades");

        Assert.Equal("heuristico", c.GetProperty("provedor").GetString());
        Assert.False(c.GetProperty("suportaAnexos").GetBoolean());
        // A interface usa a lista para montar o `accept` do seletor de arquivos.
        Assert.Contains(".pdf", c.GetProperty("extensoesAceitas").EnumerateArray().Select(e => e.GetString()));
    }

    [Fact]
    public async Task SemProvedorComVisaoAImportacaoFalhaCom502Explicativo()
    {
        var res = await Importar(Arquivo("cupom.png", "image/png", new byte[] { 1, 2, 3 }));

        // 502, e não 422: o arquivo do usuário pode estar perfeito — falta
        // configuração no servidor.
        Assert.Equal(HttpStatusCode.BadGateway, res.StatusCode);
        Assert.Contains("OPENROUTER_API_KEY", await Erro(res));
    }

    [Fact]
    public async Task SemArquivoEhRejeitado()
    {
        var form = new MultipartFormDataContent();
        form.Add(new StringContent("só texto"), "texto");

        var res = await Importar(form);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("ao menos um arquivo", await Erro(res));
    }

    [Fact]
    public async Task TipoNaoSuportadoEhRejeitadoAntesDeChamarOLlm()
    {
        var res = await Importar(Arquivo("malicioso.exe", "application/octet-stream", new byte[] { 4, 5, 6 }));

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("não suportado", await Erro(res));
    }

    [Fact]
    public async Task ArquivoVazioEhRejeitado()
    {
        var res = await Importar(Arquivo("vazio.pdf", "application/pdf", Array.Empty<byte>()));

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("vazio", await Erro(res));
    }

    [Fact]
    public async Task ArquivoAcimaDoLimiteEhRejeitado()
    {
        var grande = new byte[11 * 1024 * 1024];
        var res = await Importar(Arquivo("enorme.png", "image/png", grande));

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("MB", await Erro(res));
    }

    [Fact]
    public async Task ArquivosDemaisSaoRejeitados()
    {
        var form = new MultipartFormDataContent();
        for (var i = 0; i < 6; i++)
        {
            var parte = new ByteArrayContent(new byte[] { 1, 2, 3 });
            parte.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");
            form.Add(parte, "arquivos", $"cupom{i}.png");
        }

        var res = await Importar(form);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("no máximo", await Erro(res));
    }

    [Fact]
    public async Task CsvComBytesInvalidosEhRejeitado()
    {
        var res = await Importar(Arquivo("fatura.csv", "text/csv", new byte[] { 0xFF, 0xFE, 0x41 }));

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("UTF-8", await Erro(res));
    }

    [Fact]
    public async Task ExigeAutenticacao()
    {
        var anonimo = new TasksApiFactory();
        try
        {
            using var client = anonimo.CreateClient();
            var res = await client.PostAsync("/api/financas/transacoes/importar",
                Arquivo("cupom.png", "image/png", new byte[] { 1 }));
            Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        }
        finally
        {
            await anonimo.DisposeAsync();
        }
    }

    [Fact]
    public async Task JsonEmVezDeMultipartEhRejeitado()
    {
        var res = await _client.PostAsJsonAsync("/api/financas/transacoes/importar", new { texto = "oi" });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("multipart", await Erro(res));
    }
}
