using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Notas.Api.Services.Financas.Llm;
using Xunit;

namespace Notas.Api.Tests;

// Handler falso: devolve respostas roteirizadas e guarda o que foi enviado, para
// testar o extrator sem gastar chamada real de LLM.
internal sealed class HandlerRoteirizado : HttpMessageHandler
{
    private readonly Queue<(HttpStatusCode Status, string Corpo)> _respostas = new();

    public List<string> CorposEnviados { get; } = new();
    public List<Dictionary<string, string>> Cabecalhos { get; } = new();
    public int Chamadas => CorposEnviados.Count;

    public HandlerRoteirizado Responde(HttpStatusCode status, string corpo)
    {
        _respostas.Enqueue((status, corpo));
        return this;
    }

    public HandlerRoteirizado RespondeOk(string conteudoDaMensagem)
    {
        var corpo = JsonSerializer.Serialize(new
        {
            choices = new[] { new { message = new { content = conteudoDaMensagem } } },
        });
        return Responde(HttpStatusCode.OK, corpo);
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        CorposEnviados.Add(request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct));
        Cabecalhos.Add(request.Headers.ToDictionary(h => h.Key, h => string.Join(",", h.Value)));

        if (_respostas.Count == 0) throw new InvalidOperationException("Handler sem resposta roteirizada.");
        var (status, corpo) = _respostas.Dequeue();

        return new HttpResponseMessage(status) { Content = new StringContent(corpo, Encoding.UTF8, "application/json") };
    }
}

// Servidor HTTP mínimo e real, para exercitar a serialização dos cabeçalhos que
// um handler falso em memória nunca chega a fazer.
internal sealed class ServidorFalso : IDisposable
{
    private readonly System.Net.HttpListener _listener = new();
    private readonly CancellationTokenSource _cts = new();

    public List<string> CabecalhosRecebidos { get; } = new();
    public string Url { get; }

    public ServidorFalso()
    {
        var porta = 5400 + Random.Shared.Next(0, 400);
        Url = $"http://127.0.0.1:{porta}/v1/chat/completions";
        _listener.Prefixes.Add($"http://127.0.0.1:{porta}/");
        _listener.Start();
        _ = Task.Run(Atender);
    }

    private async Task Atender()
    {
        while (!_cts.IsCancellationRequested)
        {
            System.Net.HttpListenerContext ctx;
            try { ctx = await _listener.GetContextAsync(); }
            catch { return; }

            foreach (var chave in new[] { "X-Title", "HTTP-Referer" })
            {
                var valor = ctx.Request.Headers[chave];
                if (valor is not null) CabecalhosRecebidos.Add(valor);
            }

            var corpo = System.Text.Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
            {
                choices = new[]
                {
                    new { message = new { content = """{"lancamentos":[{"descricao":"Mercado","valor":45,"tipo":"despesa","categoria":"alimentacao","data":"2026-08-31","confianca":0.9}]}""" } },
                },
            }));

            ctx.Response.ContentType = "application/json";
            ctx.Response.ContentLength64 = corpo.Length;
            await ctx.Response.OutputStream.WriteAsync(corpo);
            ctx.Response.Close();
        }
    }

    public void Dispose()
    {
        _cts.Cancel();
        _listener.Close();
        _cts.Dispose();
    }
}

public class OpenRouterExtractorTests
{
    private static readonly DateOnly Hoje = new(2026, 8, 31);

    private const string UmLancamento =
        """{"lancamentos":[{"descricao":"Mercado","valor":45.5,"tipo":"despesa","categoria":"alimentacao","data":"2026-08-31","confianca":0.9}]}""";

    private static (OpenRouterLlmExtractor Extrator, HandlerRoteirizado Handler) Montar(
        Action<HandlerRoteirizado> roteiro, OpenRouterOptions? opcoes = null)
    {
        var handler = new HandlerRoteirizado();
        roteiro(handler);

        var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(30) };
        var config = opcoes ?? new OpenRouterOptions { ApiKey = "sk-teste", MaxTentativas = 2 };
        config.ApiKey = string.IsNullOrEmpty(config.ApiKey) ? "sk-teste" : config.ApiKey;

        return (new OpenRouterLlmExtractor(client, Options.Create(config),
            NullLogger<OpenRouterLlmExtractor>.Instance), handler);
    }

    private static Task<IReadOnlyList<ExtracaoLlmResult>> Extrair(
        OpenRouterLlmExtractor extrator, EntradaExtracao? entrada = null) =>
        extrator.ExtrairAsync(entrada ?? EntradaExtracao.DeTexto("gastei 45,50 no mercado"), Hoje);

    [Fact]
    public async Task ExtraiLancamentoDeTexto()
    {
        var (extrator, _) = Montar(h => h.RespondeOk(UmLancamento));

        var r = await Extrair(extrator);

        Assert.Single(r);
        Assert.Equal("Mercado", r[0].Descricao);
        Assert.Equal(45.5m, r[0].Valor);
        Assert.Equal("despesa", r[0].Tipo);
    }

    [Fact]
    public async Task EnviaCabecalhosEModeloConfigurados()
    {
        var opcoes = new OpenRouterOptions { ApiKey = "sk-abc", Model = "google/gemini-3.6-flash" };
        var (extrator, handler) = Montar(h => h.RespondeOk(UmLancamento), opcoes);

        await Extrair(extrator);

        using var doc = JsonDocument.Parse(handler.CorposEnviados[0]);
        Assert.Equal("google/gemini-3.6-flash", doc.RootElement.GetProperty("model").GetString());
        // temperature 0 mantém a extração estável entre execuções iguais.
        Assert.Equal(0, doc.RootElement.GetProperty("temperature").GetInt32());

        // Mesmos cabeçalhos que o app Android usa para se identificar à OpenRouter.
        var cabecalhos = handler.Cabecalhos[0];
        Assert.Equal("Bearer sk-abc", cabecalhos["Authorization"]);
        Assert.True(cabecalhos.ContainsKey("HTTP-Referer"));
        Assert.True(cabecalhos.ContainsKey("X-Title"));
    }

    [Fact]
    public async Task ImagemViraParteImageUrlEmBase64()
    {
        var (extrator, handler) = Montar(h => h.RespondeOk(UmLancamento));
        var imagem = new AnexoExtracao("cupom.jpg", "image/jpeg", new byte[] { 1, 2, 3, 4 });

        await Extrair(extrator, new EntradaExtracao("", new[] { imagem }));

        using var doc = JsonDocument.Parse(handler.CorposEnviados[0]);
        var partes = doc.RootElement.GetProperty("messages")[1].GetProperty("content").EnumerateArray().ToList();

        var parteImagem = partes.Single(p => p.GetProperty("type").GetString() == "image_url");
        var url = parteImagem.GetProperty("image_url").GetProperty("url").GetString()!;
        Assert.StartsWith("data:image/jpeg;base64,", url);
        Assert.Equal(Convert.ToBase64String(new byte[] { 1, 2, 3, 4 }), url.Split(',')[1]);
    }

    [Fact]
    public async Task PdfViraParteFileComNomeDoArquivo()
    {
        var (extrator, handler) = Montar(h => h.RespondeOk(UmLancamento));
        var pdf = new AnexoExtracao("extrato.pdf", "application/pdf", new byte[] { 9, 9 });

        await Extrair(extrator, new EntradaExtracao("", new[] { pdf }));

        using var doc = JsonDocument.Parse(handler.CorposEnviados[0]);
        var partes = doc.RootElement.GetProperty("messages")[1].GetProperty("content").EnumerateArray().ToList();

        var parteArquivo = partes.Single(p => p.GetProperty("type").GetString() == "file");
        Assert.Equal("extrato.pdf", parteArquivo.GetProperty("file").GetProperty("filename").GetString());
    }

    [Fact]
    public async Task ArquivoDeTextoVaiNoPromptEmVezDeAnexoBinario()
    {
        var (extrator, handler) = Montar(h => h.RespondeOk(UmLancamento));
        var csv = new AnexoExtracao("fatura.csv", "text/csv",
            Encoding.UTF8.GetBytes("data;descricao;valor\n2026-08-01;Padaria;12,50"));

        await Extrair(extrator, new EntradaExtracao("", new[] { csv }));

        using var doc = JsonDocument.Parse(handler.CorposEnviados[0]);
        var partes = doc.RootElement.GetProperty("messages")[1].GetProperty("content").EnumerateArray().ToList();

        // Só a parte de texto: CSV não vira anexo binário.
        Assert.Single(partes);
        var texto = partes[0].GetProperty("text").GetString()!;
        Assert.Contains("Padaria", texto);
        Assert.Contains("fatura.csv", texto);
    }

    [Fact]
    public async Task ExtratoRendeVariosLancamentos()
    {
        const string varios = """
            {"lancamentos":[
              {"descricao":"Padaria","valor":12.5,"tipo":"despesa","categoria":"alimentacao","data":"2026-08-01","confianca":0.9},
              {"descricao":"Uber","valor":23.9,"tipo":"despesa","categoria":"transporte","data":"2026-08-02","confianca":0.9},
              {"descricao":"Salário","valor":6500,"tipo":"receita","categoria":"salario","data":"2026-08-05","confianca":0.95}
            ]}
            """;
        var (extrator, _) = Montar(h => h.RespondeOk(varios));

        var r = await Extrair(extrator, new EntradaExtracao("",
            new[] { new AnexoExtracao("extrato.pdf", "application/pdf", new byte[] { 1 }) }));

        Assert.Equal(3, r.Count);
        Assert.Equal("receita", r[2].Tipo);
    }

    [Fact]
    public async Task RespostaEnvolvidaEmMarkdownEhAceita()
    {
        var (extrator, _) = Montar(h => h.RespondeOk("```json\n" + UmLancamento + "\n```"));

        var r = await Extrair(extrator);
        Assert.Single(r);
    }

    [Fact]
    public async Task ObjetoSoltoSemInvolucroEhAceito()
    {
        // Alguns modelos ignoram o invólucro e devolvem o lançamento direto.
        const string solto = """{"descricao":"Uber","valor":20,"tipo":"despesa","categoria":"transporte","data":"2026-08-31","confianca":0.8}""";
        var (extrator, _) = Montar(h => h.RespondeOk(solto));

        var r = await Extrair(extrator);
        Assert.Single(r);
        Assert.Equal("Uber", r[0].Descricao);
    }

    [Fact]
    public async Task ArrayPuroSemInvolucroEhAceito()
    {
        const string array = """[{"descricao":"Uber","valor":20,"tipo":"despesa","categoria":"transporte","data":"2026-08-31","confianca":0.8}]""";
        var (extrator, _) = Montar(h => h.RespondeOk(array));

        var r = await Extrair(extrator);
        Assert.Single(r);
    }

    [Fact]
    public async Task ErroTransitorioEhRetentado()
    {
        var (extrator, handler) = Montar(h => h
            .Responde(HttpStatusCode.TooManyRequests, "{}")
            .RespondeOk(UmLancamento));

        var r = await Extrair(extrator);

        Assert.Single(r);
        Assert.Equal(2, handler.Chamadas);
    }

    [Fact]
    public async Task ErroPersistenteViraLlmIndisponivel()
    {
        var (extrator, handler) = Montar(h => h
            .Responde(HttpStatusCode.InternalServerError, "{}")
            .Responde(HttpStatusCode.InternalServerError, "{}")
            .Responde(HttpStatusCode.InternalServerError, "{}"));

        // Falha do provedor não é "não entendi seu texto": precisa ser distinguível
        // para o endpoint responder 502 em vez de 422.
        await Assert.ThrowsAsync<LlmIndisponivelException>(() => Extrair(extrator));
        Assert.Equal(3, handler.Chamadas);
    }

    [Fact]
    public async Task ChaveInvalidaNaoEhRetentada()
    {
        var (extrator, handler) = Montar(h => h.Responde(HttpStatusCode.Unauthorized, "{}"));

        var ex = await Assert.ThrowsAsync<LlmIndisponivelException>(() => Extrair(extrator));

        Assert.Contains("chave", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(1, handler.Chamadas); // retentar com chave errada só faz esperar
    }

    [Fact]
    public async Task ErroDentroDeUm200EhTratado()
    {
        // A OpenRouter devolve 200 com um objeto de erro quando o provedor de trás
        // falha, então checar só o código HTTP não basta.
        var (extrator, _) = Montar(h => h.Responde(HttpStatusCode.OK,
            """{"error":{"message":"upstream model is down","code":502}}"""));

        var ex = await Assert.ThrowsAsync<LlmIndisponivelException>(() => Extrair(extrator));
        Assert.Contains("upstream model is down", ex.Message);
    }

    [Fact]
    public async Task CorpoQueNaoEhJsonViraErroDeProvedorComTrecho()
    {
        // Um proxy no caminho pode devolver HTML de erro com status 200; sem
        // tratamento, isso escaparia como falha genérica e a tela de diagnóstico
        // não diria que a resposta sequer era JSON.
        var (extrator, _) = Montar(h => h.Responde(HttpStatusCode.OK,
            "<html><body>502 Bad Gateway</body></html>"));

        var ex = await Assert.ThrowsAsync<LlmIndisponivelException>(() => Extrair(extrator));
        Assert.Contains("não é JSON", ex.Message);
        Assert.Contains("502 Bad Gateway", ex.Message);
    }

    [Fact]
    public async Task RespostaSemJsonViraExtracaoInvalida()
    {
        var (extrator, _) = Montar(h => h.RespondeOk("Desculpe, não consegui identificar nada."));

        await Assert.ThrowsAsync<ExtracaoInvalidaException>(() => Extrair(extrator));
    }

    [Fact]
    public async Task ListaVaziaViraExtracaoInvalida()
    {
        var (extrator, _) = Montar(h => h.RespondeOk("""{"lancamentos":[]}"""));

        await Assert.ThrowsAsync<ExtracaoInvalidaException>(() => Extrair(extrator));
    }

    [Fact]
    public async Task SemChaveConfiguradaFalhaComMensagemClara()
    {
        var (extrator, handler) = Montar(h => { }, new OpenRouterOptions { ApiKey = "" });
        // Montar() preenche a chave quando vazia; aqui queremos o caso sem chave.
        var semChave = new OpenRouterLlmExtractor(new HttpClient(new HandlerRoteirizado()),
            Options.Create(new OpenRouterOptions { ApiKey = "" }), NullLogger<OpenRouterLlmExtractor>.Instance);

        var ex = await Assert.ThrowsAsync<LlmIndisponivelException>(() => Extrair(semChave));
        Assert.Contains("Configurações", ex.Message);
    }

    [Theory]
    [InlineData("Anotações — Finanças", "Anotacoes  Financas")]
    [InlineData("Finanças", "Financas")]
    [InlineData("São Paulo", "Sao Paulo")]
    [InlineData("Anotacoes - Financas", "Anotacoes - Financas")]
    [InlineData("", "")]
    public void TituloEhReduzidoAAscii(string entrada, string esperado)
    {
        // Cabeçalho HTTP só aceita ASCII: um acento aqui faz toda requisição
        // estourar antes de sair da máquina, com uma mensagem que não aponta
        // para o appsettings.
        Assert.Equal(esperado, OpenRouterLlmExtractor.SomenteAscii(entrada));
    }

    [Fact]
    public async Task TituloComAcentoNaConfiguracaoNaoQuebraARequisicaoReal()
    {
        // Este teste sobe um servidor HTTP de verdade: o handler falso dos demais
        // nunca serializa cabeçalho, então não pegaria o erro de codificação.
        using var servidor = new ServidorFalso();
        var opcoes = new OpenRouterOptions
        {
            ApiKey = "sk-teste",
            BaseUrl = servidor.Url,
            Titulo = "Anotações — Finanças",
            Referer = "https://exemplo.com/anotações",
        };

        var extrator = new OpenRouterLlmExtractor(new HttpClient(), Options.Create(opcoes),
            NullLogger<OpenRouterLlmExtractor>.Instance);

        var r = await extrator.ExtrairAsync(EntradaExtracao.DeTexto("gastei 45 no mercado"), Hoje);

        Assert.Single(r);
        Assert.All(servidor.CabecalhosRecebidos, h => Assert.All(h, c => Assert.InRange(c, ' ', '~')));
    }

    [Fact]
    public void ProvedorEhIdentificadoESuportaAnexos()
    {
        var (extrator, _) = Montar(h => { });
        Assert.Equal("openrouter", extrator.Provedor);
        Assert.True(extrator.SuportaAnexos);
    }
}
