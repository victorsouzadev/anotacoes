using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Notas.Api.Services.Seguranca;
using Xunit;

namespace Notas.Api.Tests;

public class ProtetorDeSegredosTests
{
    private static ProtetorDeSegredos Criar(string segredo = "segredo-de-teste-0123456789abcdef") =>
        new(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["JWT_SECRET"] = segredo })
            .Build());

    [Fact]
    public void CifraEDecifraDeVolta()
    {
        var p = Criar();
        const string chave = "sk-or-v1-abcdef0123456789";

        Assert.Equal(chave, p.Desproteger(p.Proteger(chave)));
    }

    [Fact]
    public void OTextoCifradoNaoContemAChave()
    {
        var p = Criar();
        const string chave = "sk-or-v1-abcdef0123456789";

        var cifrado = p.Proteger(chave);

        // O arquivo SQLite vai para backup; a chave não pode estar legível nele.
        Assert.DoesNotContain("sk-or", cifrado);
        Assert.DoesNotContain(chave, cifrado);
    }

    [Fact]
    public void DuasCifragensDoMesmoValorDaoResultadosDiferentes()
    {
        var p = Criar();
        // Nonce aleatório: sem isso, dá para saber que dois usuários usam a mesma chave.
        Assert.NotEqual(p.Proteger("mesma-chave"), p.Proteger("mesma-chave"));
    }

    [Fact]
    public void SegredoDiferenteNaoDecifra()
    {
        var cifrado = Criar("segredo-a-0123456789abcdefghij").Proteger("sk-or-v1-teste");

        // Trocar o JWT_SECRET invalida as chaves salvas; devolver null deixa o
        // chamador tratar como "sem chave" em vez de estourar.
        Assert.Null(Criar("segredo-b-0123456789abcdefghij").Desproteger(cifrado));
    }

    [Fact]
    public void TextoAdulteradoNaoDecifra()
    {
        var p = Criar();
        var cifrado = p.Proteger("sk-or-v1-teste");

        var bytes = Convert.FromBase64String(cifrado);
        bytes[^1] ^= 0xFF; // vira um bit no final

        Assert.Null(p.Desproteger(Convert.ToBase64String(bytes)));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("nao-e-base64!!")]
    [InlineData("YWJj")] // base64 válido, mas curto demais
    public void EntradaInvalidaDevolveNull(string entrada)
    {
        Assert.Null(Criar().Desproteger(entrada));
    }

    [Fact]
    public void PreservaAcentoEUnicode()
    {
        var p = Criar();
        const string valor = "chave-com-acentuação-e-emoji-🔑";
        Assert.Equal(valor, p.Desproteger(p.Proteger(valor)));
    }
}

public class ConfiguracaoIaApiTests : IClassFixture<ConfiguracaoIaApiTests.Contexto>
{
    public class Contexto : IAsyncLifetime
    {
        public TasksApiFactory Factory { get; } = new();
        public HttpClient Client { get; private set; } = null!;

        public async Task InitializeAsync()
        {
            Client = Factory.CreateClient();
            var res = await Factory.CreateClient().PostAsJsonAsync("/api/auth/register",
                new { email = $"cfg_{Guid.NewGuid():N}@example.com", password = "Sup3rSecret!" });
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

    private readonly Contexto _ctx;
    private readonly HttpClient _client;

    public ConfiguracaoIaApiTests(Contexto ctx)
    {
        _ctx = ctx;
        _client = ctx.Client;
    }

    // Cliente com usuário recém-criado, para os casos que precisam de estado
    // limpo: a classe compartilha um usuário só (o registro é limitado por IP), e
    // um teste que salva configuração afetaria os demais.
    private async Task<HttpClient> ClienteNovoAsync()
    {
        var cliente = _ctx.Factory.CreateClient();
        var res = await cliente.PostAsJsonAsync("/api/auth/register",
            new { email = $"novo_{Guid.NewGuid():N}@example.com", password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        cliente.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        return cliente;
    }

    private Task<HttpResponseMessage> Salvar(string? provedor, string? modelo, string? chave) =>
        _client.PutAsJsonAsync("/api/configuracoes/ia",
            new { provedor, modelo, chaveApi = chave });

    private Task<JsonElement> Ler() => _client.GetFromJsonAsync<JsonElement>("/api/configuracoes/ia");

    [Fact]
    public async Task SemConfiguracaoUsaOPadraoDoServidor()
    {
        using var cliente = await ClienteNovoAsync();
        var c = await cliente.GetFromJsonAsync<JsonElement>("/api/configuracoes/ia");

        Assert.Equal("", c.GetProperty("provedor").GetString());
        Assert.False(c.GetProperty("chaveConfigurada").GetBoolean());
        // Sem chave em lugar nenhum, o servidor de teste cai no heurístico.
        Assert.Equal("heuristico", c.GetProperty("provedorEfetivo").GetString());
        Assert.False(c.GetProperty("suportaAnexos").GetBoolean());
    }

    [Fact]
    public async Task SalvaChaveEDevolveApenasMascarada()
    {
        var res = await Salvar("openrouter", "anthropic/claude-haiku-4.5", "sk-or-v1-chavesecreta1234");
        res.EnsureSuccessStatusCode();

        var corpo = await res.Content.ReadAsStringAsync();

        // A chave nunca pode trafegar de volta ao cliente.
        Assert.DoesNotContain("chavesecreta", corpo);
        Assert.DoesNotContain("sk-or-v1-chave", corpo);

        var c = JsonSerializer.Deserialize<JsonElement>(corpo);
        Assert.True(c.GetProperty("chaveConfigurada").GetBoolean());
        Assert.EndsWith("1234", c.GetProperty("chaveMascarada").GetString()!);
        Assert.Equal("openrouter", c.GetProperty("provedorEfetivo").GetString());
        // Com chave da OpenRouter, a leitura de arquivo passa a estar disponível.
        Assert.True(c.GetProperty("suportaAnexos").GetBoolean());
        Assert.False(c.GetProperty("usandoChaveDoServidor").GetBoolean());
    }

    [Fact]
    public async Task GetTambemNaoVazaAChave()
    {
        await Salvar("openrouter", null, "sk-or-v1-outrachavesecreta99");

        var corpo = await (await _client.GetAsync("/api/configuracoes/ia")).Content.ReadAsStringAsync();
        Assert.DoesNotContain("outrachavesecreta", corpo);
    }

    [Fact]
    public async Task SalvarSemChaveMantemAChaveExistente()
    {
        await Salvar("openrouter", "modelo-a", "sk-or-v1-permanece12345");

        // chaveApi ausente = "não mexer": o cliente não tem a chave para reenviar.
        var res = await Salvar("openrouter", "modelo-b", null);
        res.EnsureSuccessStatusCode();

        var c = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(c.GetProperty("chaveConfigurada").GetBoolean());
        Assert.Equal("modelo-b", c.GetProperty("modelo").GetString());
    }

    [Fact]
    public async Task ChaveVaziaRemoveAChave()
    {
        await Salvar("openrouter", null, "sk-or-v1-seraremovida123");

        var res = await Salvar("openrouter", null, "");
        var c = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.False(c.GetProperty("chaveConfigurada").GetBoolean());
        Assert.Equal(JsonValueKind.Null, c.GetProperty("chaveMascarada").ValueKind);
        // Sem chave, volta a cair no heurístico.
        Assert.Equal("heuristico", c.GetProperty("provedorEfetivo").GetString());
    }

    [Fact]
    public async Task EndpointDedicadoRemoveAChave()
    {
        await Salvar("openrouter", null, "sk-or-v1-remover4567");

        var res = await _client.DeleteAsync("/api/configuracoes/ia/chave");
        res.EnsureSuccessStatusCode();

        Assert.False((await Ler()).GetProperty("chaveConfigurada").GetBoolean());
    }

    [Fact]
    public async Task ProvedorInvalidoEhRejeitado()
    {
        var res = await Salvar("skynet", null, null);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Theory]
    [InlineData("abc")]                       // curta demais
    [InlineData("sk-or-v1-aaaaaaaaaaaaaaaa")] // válida, para contraste
    public async Task ChaveCurtaEhRejeitada(string chave)
    {
        var res = await Salvar("openrouter", null, chave);
        var esperado = chave.Length < 8 ? HttpStatusCode.BadRequest : HttpStatusCode.OK;
        Assert.Equal(esperado, res.StatusCode);
    }

    [Fact]
    public async Task ModeloAbsurdamenteLongoEhRejeitado()
    {
        var res = await Salvar("openrouter", new string('x', 200), null);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task ModelosSugeridosAcompanhamOProvedorEscolhido()
    {
        await Salvar("openrouter", null, "sk-or-v1-parasugestoes12");
        var abertos = await Ler();
        var ids = abertos.GetProperty("modelosSugeridos").EnumerateArray()
            .Select(m => m.GetProperty("id").GetString()).ToList();

        Assert.Contains("anthropic/claude-haiku-4.5", ids);
        // A lista diz quais leem imagem — é o que decide se a importação funciona.
        Assert.Contains(abertos.GetProperty("modelosSugeridos").EnumerateArray(),
            m => m.GetProperty("leImagens").GetBoolean());
    }

    [Fact]
    public async Task ConfiguracaoDeUmUsuarioNaoVazaParaOutro()
    {
        await Salvar("openrouter", "modelo-do-primeiro", "sk-or-v1-doprimeiro123");

        using var outro = await ClienteNovoAsync();

        var c = await outro.GetFromJsonAsync<JsonElement>("/api/configuracoes/ia");
        Assert.False(c.GetProperty("chaveConfigurada").GetBoolean());
        Assert.Equal(JsonValueKind.Null, c.GetProperty("modelo").ValueKind);
    }

    [Fact]
    public async Task TestarSemChaveInformaOProblemaSemQuebrar()
    {
        var res = await _client.PostAsJsonAsync("/api/configuracoes/ia/testar",
            new { provedor = "openrouter", modelo = (string?)null, chaveApi = "sk-or-v1-invalida123456" });

        // O teste sempre responde 200 com ok=false; falha de configuração não é
        // erro de requisição, e a interface precisa da mensagem para exibir.
        res.EnsureSuccessStatusCode();
        var corpo = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(corpo.GetProperty("ok").GetBoolean());
        Assert.False(string.IsNullOrWhiteSpace(corpo.GetProperty("mensagem").GetString()));
    }

    [Fact]
    public async Task TestarComHeuristicoFuncionaSemChave()
    {
        var res = await _client.PostAsJsonAsync("/api/configuracoes/ia/testar",
            new { provedor = "heuristico", modelo = (string?)null, chaveApi = (string?)null });
        res.EnsureSuccessStatusCode();

        var corpo = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(corpo.GetProperty("ok").GetBoolean());
        Assert.Contains("42,50", corpo.GetProperty("exemplo").GetString()!);
    }

    [Fact]
    public async Task ExigeAutenticacao()
    {
        using var anonimo = _ctx.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await anonimo.GetAsync("/api/configuracoes/ia")).StatusCode);
    }

    [Fact]
    public async Task CapacidadesRefletemAConfiguracaoDoUsuario()
    {
        await Salvar("openrouter", null, "sk-or-v1-paracapacidades1");

        var c = await _client.GetFromJsonAsync<JsonElement>("/api/financas/capacidades");
        Assert.Equal("openrouter", c.GetProperty("provedor").GetString());
        Assert.True(c.GetProperty("suportaAnexos").GetBoolean());
    }
}
