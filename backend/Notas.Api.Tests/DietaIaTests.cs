using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api.Services.Financas.Chat;
using Notas.Api.Services.Financas.Llm;
using Xunit;

namespace Notas.Api.Tests;

// IA da Dieta com o provedor trocado por um falso que roteiriza as respostas (formato OpenRouter).
public class DietaIaTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private readonly TasksApiFactory _factory;
    private readonly ModeloFalso _modelo = new();
    private readonly OffFalso _off = new();
    private WebApplicationFactory<Program> _app = null!;
    private HttpClient _client = null!;

    public DietaIaTests(TasksApiFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _app = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.AddScoped<IChatModeloCliente>(_ => _modelo);
            s.AddSingleton<Notas.Api.Services.Dieta.IOpenFoodFacts>(_off);
        }));
        _client = _app.CreateClient();
        var res = await _client.PostAsJsonAsync("/api/auth/register", new { email = $"dietaia_{Guid.NewGuid():N}@example.com", password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString();
        _client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        return Task.CompletedTask;
    }

    private async Task ConfigurarIa(string provedor = "openrouter") =>
        (await _client.PutAsJsonAsync("/api/configuracoes/ia", new { provedor, modelo = "modelo-teste", chaveApi = "sk-teste" })).EnsureSuccessStatusCode();

    private static JsonObject Chamada(string nome, object args) => new()
    {
        ["choices"] = new JsonArray(new JsonObject
        {
            ["message"] = new JsonObject
            {
                ["role"] = "assistant",
                ["tool_calls"] = new JsonArray(new JsonObject
                {
                    ["id"] = "c" + nome, ["type"] = "function",
                    ["function"] = new JsonObject { ["name"] = nome, ["arguments"] = JsonSerializer.Serialize(args) },
                }),
            },
        }),
    };

    private static JsonObject Texto(string t) => new()
    {
        ["choices"] = new JsonArray(new JsonObject { ["message"] = new JsonObject { ["role"] = "assistant", ["content"] = t } }),
    };

    [Fact]
    public async Task Sem_provedor_pede_para_configurar()
    {
        var res = await _client.PostAsJsonAsync("/api/dieta/chat", new { mensagens = new[] { new { papel = "usuario", texto = "Monte um cardápio" } } });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("Configure", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Chat_busca_alimento_grava_o_plano_e_avisa_que_alterou()
    {
        await ConfigurarIa();
        var passo = 0;
        _modelo.Roteiro = _ => passo++ switch
        {
            0 => Chamada("buscar_alimento", new { texto = "arroz integral cozido" }),
            1 => Chamada("definir_plano", new
            {
                itens = new object[]
                {
                    new { dia_semana = -1, refeicao = "almoco", alimento_id = "taco-1", nome = "", gramas = 150 },
                    new { dia_semana = -1, refeicao = "jantar", nome = "Sopa de legumes", gramas = 300 },
                },
            }),
            _ => Texto("Plano aplicado: arroz integral no almoço e sopa no jantar."),
        };
        var res = await _client.PostAsJsonAsync("/api/dieta/chat", new { mensagens = new[] { new { papel = "usuario", texto = "Pode aplicar o plano" } } });
        res.EnsureSuccessStatusCode();
        var r = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(r.GetProperty("alterou").GetBoolean());
        Assert.Contains("Plano aplicado", r.GetProperty("resposta").GetString());

        // O resultado de buscar_alimento chegou ao modelo com o id real da TACO.
        Assert.Contains("taco-1", _modelo.Recebidos[1].ToJsonString());

        var plano = await _client.GetFromJsonAsync<JsonElement>("/api/dieta/plano");
        var ativos = plano.EnumerateArray().Where(p => p.GetProperty("deletedAt").ValueKind == JsonValueKind.Null).ToList();
        Assert.Equal(2, ativos.Count);
        Assert.Contains(ativos, p => p.GetProperty("nome").GetString() == "Arroz, integral, cozido");
    }

    [Fact]
    public async Task Ferramenta_com_argumento_invalido_devolve_erro_ao_modelo_sem_quebrar()
    {
        await ConfigurarIa();
        var passo = 0;
        _modelo.Roteiro = _ => passo++ == 0 ? Chamada("registrar_refeicao", new { alimento_id = "nao-existe", gramas = 100, refeicao = "almoco" }) : Texto("Não achei o alimento.");
        var r = await (await _client.PostAsJsonAsync("/api/dieta/chat", new { mensagens = new[] { new { papel = "usuario", texto = "Registra" } } })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("use buscar_alimento", _modelo.Recebidos[1].ToJsonString());
        Assert.Equal("Não achei o alimento.", r.GetProperty("resposta").GetString());
    }

    [Fact]
    public async Task Reconhece_descricao_e_casa_com_a_taco()
    {
        await ConfigurarIa();
        _modelo.Roteiro = _ => Texto("""
            ```json
            {"itens":[{"nome":"Arroz integral","busca":"arroz integral cozido","gramas":120,"kcal_100g":124,"proteina_100g":2.6,"carbo_100g":25.8,"gordura_100g":1,"fibra_100g":2.7},
                      {"nome":"Molho especial da casa","busca":"molho xyz inexistente","gramas":30,"kcal_100g":200,"proteina_100g":1,"carbo_100g":10,"gordura_100g":17,"fibra_100g":0}]}
            ```
            """);
        var res = await _client.PostAsJsonAsync("/api/dieta/ia/reconhecer", new { modo = "texto", texto = "arroz integral com um molho" });
        res.EnsureSuccessStatusCode();
        var itens = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("itens");
        Assert.Equal(2, itens.GetArrayLength());
        Assert.Equal("taco-1", itens[0].GetProperty("alimento").GetProperty("id").GetString());
        Assert.Equal(JsonValueKind.Null, itens[1].GetProperty("alimento").ValueKind);
        Assert.Equal(200, itens[1].GetProperty("estimado").GetProperty("kcal").GetDouble());
        // Raciocínio baixo: modelos que "pensam" gastavam o max_tokens e o JSON chegava cortado.
        Assert.Equal("low", _modelo.Recebidos[^1]["reasoning"]?["effort"]?.GetValue<string>());
    }

    [Fact]
    public async Task Rotulo_vem_por_100g_e_foto_exige_openrouter()
    {
        await ConfigurarIa("anthropic");
        var foto = "data:image/jpeg;base64,/9j/4AAQ";
        var negado = await _client.PostAsJsonAsync("/api/dieta/ia/reconhecer", new { modo = "rotulo", imagem = foto });
        Assert.Equal(HttpStatusCode.BadRequest, negado.StatusCode);
        Assert.Contains("OpenRouter", await negado.Content.ReadAsStringAsync());

        await ConfigurarIa();
        _modelo.Roteiro = _ => Texto("""{"nome":"Biscoito integral","porcao_g":30,"porcao_nome":"6 biscoitos","por100g":{"kcal":433,"proteina":9.3,"carbo":66,"gordura":14,"fibra":7,"sodio_mg":520}}""");
        var r = await (await _client.PostAsJsonAsync("/api/dieta/ia/reconhecer", new { modo = "rotulo", imagem = foto })).Content.ReadFromJsonAsync<JsonElement>();
        var rot = r.GetProperty("rotulo");
        Assert.Equal("Biscoito integral", rot.GetProperty("nome").GetString());
        Assert.Equal(433, rot.GetProperty("kcal").GetDouble());
        Assert.Equal(30, rot.GetProperty("porcaoG").GetDouble());
        // A foto foi junto, no formato multimodal.
        Assert.Contains("image_url", _modelo.Recebidos[^1].ToJsonString());
    }

    [Fact]
    public async Task Resposta_cortada_por_tamanho_avisa_em_vez_de_dizer_ilegivel()
    {
        await ConfigurarIa();
        _modelo.Roteiro = _ => new JsonObject
        {
            ["choices"] = new JsonArray(new JsonObject
            {
                ["finish_reason"] = "length",
                ["message"] = new JsonObject { ["role"] = "assistant", ["content"] = "{\"itens\":[{\"nome\":\"Arroz\",\"gra" },
            }),
        };
        var res = await _client.PostAsJsonAsync("/api/dieta/ia/reconhecer", new { modo = "texto", texto = "arroz" });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("cortada", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Imagem_que_nao_e_data_url_de_foto_e_recusada()
    {
        await ConfigurarIa();
        var res = await _client.PostAsJsonAsync("/api/dieta/ia/reconhecer", new { modo = "prato", imagem = "https://exemplo.com/x.jpg" });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Embalagem_usa_a_open_food_facts_so_quando_a_marca_bate()
    {
        await ConfigurarIa();
        var foto = "data:image/jpeg;base64,/9j/4AAQ";
        _modelo.Roteiro = _ => Texto("""{"nome":"Doce de amendoim Casadinho","marca":"Mindy","peso_liquido_g":21,"codigo_barras":null,"tabela_visivel":false,"por100g":{"kcal":480,"proteina":10,"carbo":60,"gordura":22,"fibra":3,"sodio_mg":100}}""");

        // Só há um "Casadinho" de outra marca: não serve, fica a estimativa da IA.
        _off.Produtos = [new("Casadinho", 100, 1, 20, 1, 0, 0, null, "789000", "Outra", null)];
        var r = (await (await _client.PostAsJsonAsync("/api/dieta/ia/reconhecer", new { modo = "embalagem", imagem = foto })).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("rotulo");
        Assert.Equal("estimativa", r.GetProperty("fonte").GetString());
        Assert.Equal(480, r.GetProperty("kcal").GetDouble());
        Assert.Equal(21, r.GetProperty("porcaoG").GetDouble());
        Assert.Equal("1 embalagem", r.GetProperty("porcaoNome").GetString());

        // Com a marca certa na base, valem os valores dela.
        _off.Produtos = [new("Casadinho", 470, 9, 58, 23, 2, 90, null, "7891111", "Mindy", 21)];
        r = (await (await _client.PostAsJsonAsync("/api/dieta/ia/reconhecer", new { modo = "embalagem", imagem = foto })).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("rotulo");
        Assert.Equal("openfoodfacts", r.GetProperty("fonte").GetString());
        Assert.Equal(470, r.GetProperty("kcal").GetDouble());
        Assert.Equal("7891111", r.GetProperty("codigoBarras").GetString());
    }

    [Fact]
    public async Task Busca_de_produtos_devolve_itens_da_open_food_facts_sem_gravar()
    {
        _off.Produtos = [new("Paçoca", 500, 13, 60, 24.5, 4, 275, null, "7897047000192", "Moreninha do Rio", 22)];
        var lista = await _client.GetFromJsonAsync<JsonElement>("/api/dieta/alimentos/produtos?q=pacoca");
        Assert.Equal("off-7897047000192", lista[0].GetProperty("id").GetString());
        Assert.Equal("Paçoca (Moreninha do Rio)", lista[0].GetProperty("nome").GetString());
        Assert.Equal(22, lista[0].GetProperty("porcaoG").GetDouble());
        Assert.Equal(0, (await _client.GetFromJsonAsync<JsonElement>("/api/dieta/alimentos/meus")).GetArrayLength());
    }

    private sealed class OffFalso : Notas.Api.Services.Dieta.IOpenFoodFacts
    {
        public List<Notas.Api.Services.Dieta.ProdutoOff> Produtos { get; set; } = [];
        public Task<Notas.Api.Services.Dieta.ProdutoOff?> Buscar(string codigo, CancellationToken ct) =>
            Task.FromResult(Produtos.FirstOrDefault(p => p.Codigo == codigo));
        public Task<List<Notas.Api.Services.Dieta.ProdutoOff>> Pesquisar(string texto, int limite, CancellationToken ct) =>
            Task.FromResult(Produtos.Take(limite).ToList());
    }

    private sealed class ModeloFalso : IChatModeloCliente
    {
        public Func<JsonObject, JsonObject> Roteiro { get; set; } = _ => new JsonObject();
        public List<JsonObject> Recebidos { get; } = [];

        public Task<JsonObject> EnviarAsync(CredenciaisLlm credenciais, JsonObject corpo, CancellationToken ct)
        {
            Recebidos.Add(corpo);
            return Task.FromResult(Roteiro(corpo));
        }
    }
}
