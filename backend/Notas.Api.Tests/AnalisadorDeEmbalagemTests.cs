using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Notas.Api.Dtos;
using Notas.Api.Services.Financas.Llm;
using Notas.Api.Services.Moldes;
using Xunit;

namespace Notas.Api.Tests;

// Foto de embalagem → tipo de molde + medidas. O que importa é que nada que a
// IA invente passe: tipo fora do catálogo, chave estranha, número fora do campo.
public class AnalisadorDeEmbalagemTests
{
    private const string Foto = "data:image/jpeg;base64,/9j/4AAQ";

    private static readonly List<TipoMoldeDto> Catalogo = new()
    {
        new("caixa-milk", "Caixa milk", "Caixinha de leite", new List<CampoMoldeDto>
        {
            new("largura", "Largura", "cm", 3, 30, null),
            new("altura", "Altura", "cm", 3, 40, null),
            new("partes", "Peças", null, null, null, new List<string> { "1", "2" }),
        }),
        new("piramide", "Pirâmide", "Caixa pirâmide", new List<CampoMoldeDto>
        {
            new("lados", "Lados", "un", 3, 8, null),
            new("fechamento", "Fechamento", null, null, null, new List<string> { "fita", "cola" }),
        }),
        new("caixa-bombom", "Caixa de bombom", "Fundo e tampa", new List<CampoMoldeDto>
        {
            new("janela", "Janela", "sim-nao", null, null, null),
        }),
    };

    private static (AnalisadorDeEmbalagem Analisador, HandlerRoteirizado Handler) Montar(string provedor = "openrouter", string? chave = "k")
    {
        var handler = new HandlerRoteirizado();
        var a = new AnalisadorDeEmbalagem(
            new FabricaDeCredenciais(provedor, chave),
            new FabricaDeClienteFixa(handler),
            Options.Create(new OpenRouterOptions { ApiKey = "servidor", BaseUrl = "https://exemplo.invalido/v1" }),
            NullLogger<AnalisadorDeEmbalagem>.Instance);
        return (a, handler);
    }

    [Fact]
    public async Task Reconhece_o_tipo_e_confere_os_valores()
    {
        var (a, handler) = Montar();
        handler.RespondeOk("""
            {"tipo":"caixa-milk","confianca":"alta","valores":{"largura":7.5,"altura":"55","partes":"3","inventado":1},"explicacao":"Caixa milk com laço."}
            """);

        var r = await a.AnalisarAsync("u1", Foto, Catalogo, new MedidaConhecidaDto("largura", 7.5));

        Assert.True(r.UsouIa);
        Assert.Equal("caixa-milk", r.Tipo);
        Assert.Equal("alta", r.Confianca);
        Assert.Equal(7.5, r.Valores!["largura"]);
        // número em texto é lido, mas preso ao máximo do campo
        Assert.Equal(40.0, r.Valores["altura"]);
        // opção que não existe e chave que não existe ficam de fora
        Assert.False(r.Valores.ContainsKey("partes"));
        Assert.False(r.Valores.ContainsKey("inventado"));
        // a foto e a medida conhecida foram junto
        var enviado = handler.CorposEnviados[0];
        Assert.Contains("image_url", enviado);
        Assert.Contains("= 7.5", enviado);
    }

    [Fact]
    public async Task Opcoes_e_sim_nao_passam_quando_validas()
    {
        var (a, handler) = Montar();
        handler.RespondeOk("{\"tipo\":\"piramide\",\"confianca\":\"talvez\",\"valores\":{\"lados\":6,\"fechamento\":\"cola\"}}");
        var r = await a.AnalisarAsync("u1", Foto, Catalogo, null);
        Assert.Equal("piramide", r.Tipo);
        Assert.Equal("cola", r.Valores!["fechamento"]);
        Assert.Equal(6.0, r.Valores["lados"]);
        // confiança fora da lista vira "baixa"
        Assert.Equal("baixa", r.Confianca);

        handler.RespondeOk("```json\n{\"tipo\":\"caixa-bombom\",\"valores\":{\"janela\":\"sim\"}}\n```");
        var b = await a.AnalisarAsync("u1", Foto, Catalogo, null);
        Assert.Equal(true, b.Valores!["janela"]);
    }

    [Fact]
    public async Task Tipo_fora_do_catalogo_vira_nenhum_com_explicacao()
    {
        var (a, handler) = Montar();
        handler.RespondeOk("{\"tipo\":\"nenhum\",\"confianca\":\"media\",\"explicacao\":\"É uma caixa hexagonal com tampa de acetato.\"}");
        var r = await a.AnalisarAsync("u1", Foto, Catalogo, null);
        Assert.True(r.UsouIa);
        Assert.Null(r.Tipo);
        Assert.Contains("hexagonal", r.Motivo);
    }

    [Fact]
    public async Task Sem_provedor_de_visao_avisa_sem_chamar()
    {
        var (a, handler) = Montar(provedor: "heuristico", chave: null);
        var r = await a.AnalisarAsync("u1", Foto, Catalogo, null);
        Assert.False(r.UsouIa);
        Assert.Equal(0, handler.Chamadas);
        Assert.Contains("OpenRouter", r.Motivo);
    }

    [Fact]
    public async Task Erro_do_provedor_volta_como_motivo()
    {
        var (a, handler) = Montar();
        handler.Responde(HttpStatusCode.PaymentRequired, "{\"error\":{}}");
        var r = await a.AnalisarAsync("u1", Foto, Catalogo, null);
        Assert.False(r.UsouIa);
        Assert.Contains("saldo", r.Motivo);

        handler.RespondeOk("isto não é json");
        var b = await a.AnalisarAsync("u1", Foto, Catalogo, null);
        Assert.False(b.UsouIa);
        Assert.Contains("formato", b.Motivo);
    }

    [Fact]
    public void Prompt_lista_os_tipos_campos_e_limites()
    {
        var p = AnalisadorDeEmbalagem.Prompt(Catalogo, null);
        Assert.Contains("id \"caixa-milk\"", p);
        Assert.Contains("\"largura\": Largura (número em cm, de 3 a 30)", p);
        Assert.Contains("uma destas: \"fita\", \"cola\"", p);
        Assert.Contains("(true ou false)", p);
        Assert.Contains("Nenhuma medida real", p);
    }

    private sealed class FabricaDeCredenciais : ILlmExtractorFactory
    {
        private readonly CredenciaisLlm _c;
        public FabricaDeCredenciais(string provedor, string? chave) => _c = new CredenciaisLlm(provedor, chave, "modelo-de-teste");
        public Task<CredenciaisLlm> ResolverCredenciaisAsync(string userId, CancellationToken ct = default) => Task.FromResult(_c);
        public Task<ConfiguracaoEfetiva> ResolverAsync(string userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ILlmExtractor> CriarAsync(string userId, CancellationToken ct = default) => throw new NotSupportedException();
        public ILlmExtractor CriarAvulso(string provedor, string? chave, string? modelo) => throw new NotSupportedException();
    }

    private sealed class FabricaDeClienteFixa : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;
        public FabricaDeClienteFixa(HttpMessageHandler handler) => _handler = handler;
        public HttpClient CreateClient(string name) => new(_handler, disposeHandler: false);
    }
}

public class MoldesEndpointsTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private const string Png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    private static readonly object[] Tipos = { new { id = "cone", nome = "Cone", descricao = "Cone", campos = new[] { new { chave = "boca", rotulo = "Boca", unidade = "cm", min = 2, max = 30 } } } };
    private readonly TasksApiFactory _factory;
    private HttpClient _client = null!;

    public MoldesEndpointsTests(TasksApiFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        var email = $"moldes_{Guid.NewGuid():N}@example.com";
        var res = await _factory.CreateClient().PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        _client = _factory.CreateClient();
        _client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        return Task.CompletedTask;
    }

    [Fact]
    public async Task Sem_ia_configurada_responde_com_o_motivo()
    {
        var res = await _client.PostAsJsonAsync("/api/moldes/analisar", new { imagem = Png, tipos = Tipos });
        res.EnsureSuccessStatusCode();
        var corpo = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(corpo.GetProperty("usouIa").GetBoolean());
        Assert.False(string.IsNullOrWhiteSpace(corpo.GetProperty("motivo").GetString()));
    }

    [Fact]
    public async Task Recusa_o_que_nao_e_foto_ou_vem_sem_catalogo()
    {
        Assert.Equal(HttpStatusCode.BadRequest,
            (await _client.PostAsJsonAsync("/api/moldes/analisar", new { imagem = "data:text/html;base64,PGgxPg==", tipos = Tipos })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await _client.PostAsJsonAsync("/api/moldes/analisar", new { imagem = Png, tipos = Array.Empty<object>() })).StatusCode);
    }

    [Fact]
    public async Task Exige_login()
    {
        var res = await _factory.CreateClient().PostAsJsonAsync("/api/moldes/analisar", new { imagem = Png, tipos = Tipos });
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }
}
