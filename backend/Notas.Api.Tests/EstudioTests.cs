using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Notas.Api.Services.Estudio;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>Catálogo do Estúdio: tradução dos parâmetros genéricos para os campos de cada modelo.</summary>
public class EstudioCatalogoTests
{
    private static readonly Catalogo Cat = new(Options.Create(new EstudioOptions()), NullLogger<Catalogo>.Instance);

    private static Dictionary<string, List<string>> Urls(params (string Chave, string[] Valores)[] itens) =>
        itens.ToDictionary(i => i.Chave, i => i.Valores.ToList());

    [Fact]
    public void Todos_os_modelos_carregam_com_endpoint_e_tipo()
    {
        Assert.True(Cat.Modelos.Count >= 50);
        foreach (var m in Cat.Modelos)
        {
            Assert.Contains(m.Tipo, new[] { "imagem", "video", "audio", "modelo3d", "mundo" });
            Assert.NotEmpty(m.Ops);
            Assert.All(m.Ops.Values, op => Assert.False(string.IsNullOrWhiteSpace(op.Endpoint), $"{m.Id} sem endpoint"));
        }
    }

    [Fact]
    public void Edicao_herda_da_base_e_manda_lista_de_imagens()
    {
        var (_, op) = Cat.Resolver("nano-banana-pro", "editar");
        var corpo = Catalogo.MontarEntrada(op, new JsonObject { ["prompt"] = "um gato", ["resolucao"] = "2K" },
            Urls(("imagens", ["https://a/1.png", "https://a/2.png"])));
        Assert.Equal("fal-ai/nano-banana-pro/edit", op.Endpoint);
        Assert.Equal(2, corpo["image_urls"]!.AsArray().Count);
        Assert.Equal("2K", (string?)corpo["resolution"]);
        Assert.Equal("png", (string?)corpo["output_format"]);
        Assert.Equal(1L, (long?)corpo["num_images"]);
        Assert.Equal("auto", (string?)corpo["aspect_ratio"]);
    }

    [Fact]
    public void Duracao_do_veo_vai_com_s_e_a_do_kling_como_texto()
    {
        var (_, veo) = Cat.Resolver("veo-3.1-fast", "texto");
        var c1 = Catalogo.MontarEntrada(veo, new JsonObject { ["prompt"] = "mar", ["duracao"] = 6 }, Urls());
        Assert.Equal("6s", (string?)c1["duration"]);
        Assert.Equal("fal-ai/veo3.1/fast", veo.Endpoint);

        var (_, kling) = Cat.Resolver("kling-2.6-pro", "imagem");
        var c2 = Catalogo.MontarEntrada(kling, new JsonObject { ["prompt"] = "mar", ["duracao"] = 10 },
            Urls(("imagem", ["https://a/i.png"]), ("imagemFinal", ["https://a/f.png"])));
        Assert.Equal("10", (string?)c2["duration"]);
        Assert.Equal("https://a/i.png", (string?)c2["start_image_url"]);
        Assert.Equal("https://a/f.png", (string?)c2["end_image_url"]);
    }

    [Fact]
    public void Tamanhos_do_gpt_e_do_flux_sao_convertidos()
    {
        var (_, gpt) = Cat.Resolver("gpt-image-1.5", "texto");
        Assert.Equal("1536x1024", (string?)Catalogo.MontarEntrada(gpt, new JsonObject { ["prompt"] = "x", ["proporcao"] = "3:2" }, Urls())["image_size"]);
        var (_, flux) = Cat.Resolver("flux-1-dev", "texto");
        Assert.Equal("landscape_16_9", (string?)Catalogo.MontarEntrada(flux, new JsonObject { ["prompt"] = "x", ["proporcao"] = "16:9" }, Urls())["image_size"]);
    }

    [Fact]
    public void Inpaint_manda_mascara_e_imagem_unica_em_lista()
    {
        var (_, op) = Cat.Resolver("gpt-image-1.5", "inpaint");
        var corpo = Catalogo.MontarEntrada(op, new JsonObject { ["prompt"] = "tire a placa" },
            Urls(("imagem", ["https://a/i.png"]), ("mascara", ["https://a/m.png"])));
        Assert.Equal("https://a/i.png", (string?)corpo["image_urls"]![0]);
        Assert.Equal("https://a/m.png", (string?)corpo["mask_image_url"]);
    }

    [Fact]
    public void Faltas_e_valores_fora_da_lista_dao_erro_claro()
    {
        var (_, op) = Cat.Resolver("veo-3.1", "quadros");
        var e1 = Assert.Throws<ErroDoEstudio>(() => Catalogo.MontarEntrada(op, new JsonObject { ["prompt"] = "x" }, Urls(("imagem", ["https://a"]))));
        Assert.Contains("imagem final", e1.Message);
        var e2 = Assert.Throws<ErroDoEstudio>(() => Catalogo.MontarEntrada(op, new JsonObject { ["prompt"] = "x", ["duracao"] = 7 },
            Urls(("imagem", ["https://a"]), ("imagemFinal", ["https://b"]))));
        Assert.Contains("Aceita: 4, 6, 8", e2.Message);
        Assert.Throws<ErroDoEstudio>(() => Cat.Resolver("veo-2", "referencias"));
        Assert.Throws<ErroDoEstudio>(() => Cat.Resolver("nao-existe", "texto"));
    }

    [Fact]
    public void Angulos_sao_limitados_a_faixa_do_modelo()
    {
        var (_, op) = Cat.Resolver("qwen-angulos", "angulo");
        var corpo = Catalogo.MontarEntrada(op, new JsonObject { ["anguloV"] = 90, ["anguloH"] = 30 }, Urls(("imagem", ["https://a"])));
        Assert.Equal(60, (double?)corpo["vertical_angle"]);
        Assert.Equal(30, (double?)corpo["horizontal_angle"]);
        Assert.Equal(5, (double?)corpo["zoom"]);
    }

    [Fact]
    public void Custo_considera_quantidade_duracao_e_multiplicadores()
    {
        var (_, nb) = Cat.Resolver("nano-banana-pro", "texto");
        Assert.Equal(60, Catalogo.EstimarCusto(nb, new JsonObject { ["quantidade"] = 2, ["resolucao"] = "4K" }));
        var (_, veo) = Cat.Resolver("veo-3.1", "texto");
        Assert.Equal(320, Catalogo.EstimarCusto(veo, new JsonObject()));                 // 8 s × 20 ¢ × áudio ligado (×2)
        Assert.Equal(80, Catalogo.EstimarCusto(veo, new JsonObject { ["duracao"] = 4, ["audio"] = false }));
        var (_, fundo) = Cat.Resolver("bria-video-fundo", "remover-fundo");
        Assert.Equal(14, Catalogo.EstimarCusto(fundo, new JsonObject(), duracaoDaEntradaSeg: 10));
    }

    [Fact]
    public void Resultado_acha_arquivos_em_qualquer_formato_de_resposta()
    {
        var imagens = JsonNode.Parse("""{"images":[{"url":"https://v3.fal.media/a.png","content_type":"image/png"},{"url":"https://v3.fal.media/b.png"}],"seed":1}""")!;
        Assert.Equal(2, EstudioProcessador.UrlsDoResultado(imagens, "imagem").Count);

        var video = JsonNode.Parse("""{"video":{"url":"https://v3.fal.media/v.mp4"}}""")!;
        Assert.Equal(["https://v3.fal.media/v.mp4"], EstudioProcessador.UrlsDoResultado(video, "video"));

        var malha = JsonNode.Parse("""{"model_glb":{"url":"https://x/m.glb"},"model_urls":{"obj":{"url":"https://x/m.obj"},"glb":{"url":"https://x/m.glb"}},"thumbnail":{"url":"https://x/t.png"}}""")!;
        Assert.Equal(["https://x/m.glb"], EstudioProcessador.UrlsDoResultado(malha, "modelo3d"));

        var audio = JsonNode.Parse("""{"audio_url":"https://x/s.mp3"}""")!;
        Assert.Equal(["https://x/s.mp3"], EstudioProcessador.UrlsDoResultado(audio, "audio"));
    }

    [Fact]
    public void Montagem_encadeia_clipes_com_silencio_e_mistura_a_trilha()
    {
        var m = new Montagem(1280, 720, 30,
            [new ClipeMontagem("/v.mp4", false, 2, 3, 1, true, 0.5, 0), new ClipeMontagem("/f.png", true, 0, 2, 1, false, 0, 0.5)],
            [new AudioMontagem("/m.mp3", 0, 5, 1, 0.4, 0, 1)]);
        var args = Ffmpeg.ArgumentosDeMontagem(m);
        var filtro = args[args.IndexOf("-filter_complex") + 1];
        Assert.Contains("trim=start=2:duration=3", filtro);
        Assert.Contains("anullsrc=r=48000:cl=stereo,atrim=duration=2[a1]", filtro);
        Assert.Contains("concat=n=2:v=1:a=1[vcat][acat]", filtro);
        Assert.Contains("adelay=1000|1000[m0]", filtro);
        Assert.Contains("amix=inputs=2", filtro);
        Assert.Equal(["-loop", "1", "-t", "2", "-i", "/f.png"], args.Skip(2).Take(6));
        Assert.Throws<ErroDoEstudio>(() => Ffmpeg.ArgumentosDeMontagem(m with { Clipes = [] }));
    }
}

/// <summary>Estúdio pela API: configuração, biblioteca e uma geração de ponta a ponta contra um fal.ai falso.</summary>
public class EstudioApiTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private const string Png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    private readonly TasksApiFactory _factory;
    private readonly FalFalso _fal = new();
    private WebApplicationFactory<Program> _app = null!;
    private HttpClient _client = null!;

    public EstudioApiTests(TasksApiFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _app = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Estudio:ConsultaSegundos", "1");
            b.UseSetting("Estudio:WorkerDesligado", "false");
            b.ConfigureTestServices(s => s.AddHttpClient(FalCliente.NomeHttp).ConfigurePrimaryHttpMessageHandler(() => _fal));
        });
        _client = await Logado();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        // Cada teste sobe o próprio host (com a fila ligada); sem descartar, a fila do teste
        // anterior continuaria rodando no mesmo banco e pegaria as gerações deste.
        await _app.DisposeAsync();
    }

    private async Task<HttpClient> Logado()
    {
        var email = $"est_{Guid.NewGuid():N}@example.com";
        var res = await _app.CreateClient().PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        var c = _app.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    private async Task<string> Enviar(HttpClient c, string nome = "foto.png")
    {
        var res = await c.PostAsJsonAsync("/api/estudio/midias", new { nome, dataUrl = Png, pasta = "Testes" });
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<JsonElement>())[0].GetProperty("id").GetString()!;
    }

    [Fact]
    public async Task Chave_fica_mascarada_e_teto_e_respeitado()
    {
        var cfg = await _client.PutAsJsonAsync("/api/estudio/config", new { chaveFal = "fal-chave-secreta-1234", limiteMensalCentavos = 20 });
        cfg.EnsureSuccessStatusCode();
        var j = await cfg.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(j.GetProperty("falConfigurada").GetBoolean());
        Assert.Equal("…1234", j.GetProperty("falMascarada").GetString());
        Assert.DoesNotContain("secreta", await cfg.Content.ReadAsStringAsync());

        // 2 imagens 4K do Nano Banana Pro = 60 ¢, acima do teto de 20 ¢.
        var res = await _client.PostAsJsonAsync("/api/estudio/geracoes", new
        {
            modelo = "nano-banana-pro", operacao = "texto",
            parametros = new { prompt = "um farol", quantidade = 2, resolucao = "4K" },
        });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("teto mensal", (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("erro").GetString());
    }

    [Fact]
    public async Task Sem_chave_avisa_onde_cadastrar()
    {
        using var c = await Logado();
        var res = await c.PostAsJsonAsync("/api/estudio/geracoes", new { modelo = "flux-1-schnell", operacao = "texto", parametros = new { prompt = "x" } });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("fal.ai", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Biblioteca_isola_usuarios_e_link_assinado_abre_sem_login()
    {
        var id = await Enviar(_client);
        var lista = await _client.GetFromJsonAsync<JsonElement>("/api/estudio/midias?tipo=imagem");
        var item = lista.EnumerateArray().Single(x => x.GetProperty("id").GetString() == id);
        Assert.Equal("Testes", item.GetProperty("pasta").GetString());

        var url = item.GetProperty("url").GetString()!;
        var anonimo = await _app.CreateClient().GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, anonimo.StatusCode);
        Assert.Equal("image/png", anonimo.Content.Headers.ContentType?.MediaType);
        Assert.Equal(HttpStatusCode.Forbidden, (await _app.CreateClient().GetAsync(url.Replace("sig=", "sig=0"))).StatusCode);

        using var outro = await Logado();
        Assert.Equal(HttpStatusCode.NotFound, (await outro.GetAsync($"/api/estudio/midias/{id}")).StatusCode);
        var roubo = await outro.PostAsJsonAsync("/api/estudio/geracoes", new
        {
            modelo = "birefnet", operacao = "remover-fundo", entradas = new Dictionary<string, string[]> { ["imagem"] = [id] },
        });
        Assert.Equal(HttpStatusCode.BadRequest, roubo.StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/estudio/midias/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _app.CreateClient().GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task Geracao_vai_ao_fal_e_volta_para_a_biblioteca()
    {
        (await _client.PutAsJsonAsync("/api/estudio/config", new { chaveFal = "fal-chave-de-teste-9999", semLimite = true })).EnsureSuccessStatusCode();
        var foto = await Enviar(_client);

        var res = await _client.PostAsJsonAsync("/api/estudio/geracoes", new
        {
            app = "criar-imagem", modelo = "nano-banana-pro", operacao = "editar",
            parametros = new { prompt = "pôr um chapéu" },
            entradas = new Dictionary<string, string[]> { ["imagens"] = [foto] },
        });
        res.EnsureSuccessStatusCode();
        var job = await res.Content.ReadFromJsonAsync<JsonElement>();
        var jobId = job.GetProperty("id").GetString();
        Assert.Equal(15, job.GetProperty("custoEstimadoCentavos").GetDouble());

        JsonElement atual = default;
        for (var i = 0; i < 60; i++)
        {
            atual = await _client.GetFromJsonAsync<JsonElement>($"/api/estudio/geracoes/{jobId}");
            if (atual.GetProperty("status").GetString() is "concluido" or "falhou") break;
            await Task.Delay(250);
        }
        Assert.Equal("concluido", atual.GetProperty("status").GetString());
        var gerada = atual.GetProperty("resultado")[0];
        Assert.Equal("imagem", gerada.GetProperty("tipo").GetString());
        Assert.Equal("geracao", gerada.GetProperty("origem").GetString());
        Assert.Equal("pôr um chapéu", gerada.GetProperty("prompt").GetString());

        // O pedido chegou ao endpoint certo, com a foto já no armazenamento do fal e a chave do usuário.
        var (url, corpo, chave) = _fal.Pedidos.Single(p => p.Url.Contains("nano-banana-pro/edit"));
        Assert.Equal("Key fal-chave-de-teste-9999", chave);
        var enviado = JsonNode.Parse(corpo)!;
        Assert.Equal("https://v3.fal.media/files/entrada.png", (string?)enviado["image_urls"]![0]);
        Assert.Equal("pôr um chapéu", (string?)enviado["prompt"]);

        var historico = await _client.GetFromJsonAsync<JsonElement>("/api/estudio/geracoes?app=criar-imagem");
        Assert.Contains(historico.EnumerateArray(), j => j.GetProperty("id").GetString() == jobId);
    }

    [Fact]
    public async Task Quadros_guardam_json_por_usuario()
    {
        var id = Guid.NewGuid().ToString();
        var put = await _client.PutAsJsonAsync($"/api/estudio/quadros/{id}", new { tipo = "storyboard", nome = "Curta", data = """{"cenas":[]}""" });
        put.EnsureSuccessStatusCode();
        var lista = await _client.GetFromJsonAsync<JsonElement>("/api/estudio/quadros?tipo=storyboard");
        Assert.Contains(lista.EnumerateArray(), q => q.GetProperty("id").GetString() == id);
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PutAsJsonAsync($"/api/estudio/quadros/{id}", new { tipo = "storyboard", nome = "x", data = "não é json" })).StatusCode);
        using var outro = await Logado();
        Assert.Equal(HttpStatusCode.NotFound, (await outro.GetAsync($"/api/estudio/quadros/{id}")).StatusCode);
    }

    /// <summary>fal.ai de mentira: fila, status (uma volta em andamento), resultado, upload e download.</summary>
    private sealed class FalFalso : HttpMessageHandler
    {
        private static readonly byte[] PngBytes = Convert.FromBase64String(Png[(Png.IndexOf(',') + 1)..]);
        private readonly ConcurrentDictionary<string, int> _consultas = new();
        public ConcurrentBag<(string Url, string Corpo, string? Chave)> Pedidos { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
        {
            var url = req.RequestUri!.ToString();
            var corpo = req.Content is null ? "" : await req.Content.ReadAsStringAsync(ct);
            Pedidos.Add((url, corpo, req.Headers.Authorization?.ToString()));

            if (url.StartsWith("https://rest.alpha.fal.ai/storage/upload/initiate"))
                return Json("""{"upload_url":"https://upload.fal.media/x","file_url":"https://v3.fal.media/files/entrada.png"}""");
            if (url.StartsWith("https://upload.fal.media/")) return new HttpResponseMessage(HttpStatusCode.OK);
            if (url.StartsWith("https://v3.fal.media/files/saida.png"))
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(PngBytes) { Headers = { ContentType = new MediaTypeHeaderValue("image/png") } } };
            if (req.Method == HttpMethod.Post && url.StartsWith("https://queue.fal.run/"))
                return Json("""{"request_id":"r1","status_url":"https://queue.fal.run/fal-ai/nano-banana-pro/requests/r1/status","response_url":"https://queue.fal.run/fal-ai/nano-banana-pro/requests/r1","cancel_url":"https://queue.fal.run/fal-ai/nano-banana-pro/requests/r1/cancel","queue_position":0}""");
            if (url.Contains("/requests/r1/status"))
                return Json(_consultas.AddOrUpdate("r1", 1, (_, n) => n + 1) < 2 ? """{"status":"IN_PROGRESS"}""" : """{"status":"COMPLETED"}""");
            if (url.EndsWith("/requests/r1"))
                return Json("""{"images":[{"url":"https://v3.fal.media/files/saida.png","content_type":"image/png","width":1,"height":1}]}""");
            return new HttpResponseMessage(HttpStatusCode.NotFound);
        }

        private static HttpResponseMessage Json(string s) =>
            new(HttpStatusCode.OK) { Content = new StringContent(s, Encoding.UTF8, "application/json") };
    }
}
