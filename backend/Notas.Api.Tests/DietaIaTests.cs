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
    private WebApplicationFactory<Program> _app = null!;
    private HttpClient _client = null!;

    public DietaIaTests(TasksApiFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _app = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddScoped<IChatModeloCliente>(_ => _modelo)));
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
    public async Task Imagem_que_nao_e_data_url_de_foto_e_recusada()
    {
        await ConfigurarIa();
        var res = await _client.PostAsJsonAsync("/api/dieta/ia/reconhecer", new { modo = "prato", imagem = "https://exemplo.com/x.jpg" });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
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
