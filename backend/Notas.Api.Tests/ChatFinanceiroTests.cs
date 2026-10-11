using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api.Data;
using Notas.Api.Services.Financas.Chat;
using Notas.Api.Services.Financas.Llm;
using Xunit;

namespace Notas.Api.Tests;

// Chat financeiro com o provedor de IA trocado por um falso que roteiriza as
// respostas: primeiro pede uma consulta, depois responde com o que recebeu.
public class ChatFinanceiroTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private readonly TasksApiFactory _factory;
    private readonly ModeloFalso _modelo = new();
    private WebApplicationFactory<Program> _app = null!;
    private HttpClient _client = null!;
    private string _email = "";

    public ChatFinanceiroTests(TasksApiFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _app = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
            s.AddScoped<IChatModeloCliente>(_ => _modelo)));
        _client = _app.CreateClient();
        _email = $"chat_{Guid.NewGuid():N}@example.com";
        var res = await _client.PostAsJsonAsync("/api/auth/register", new { email = _email, password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString();
        _client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        return Task.CompletedTask;
    }

    private async Task ConfigurarIa(string provedor) =>
        (await _client.PutAsJsonAsync("/api/configuracoes/ia",
            new { provedor, modelo = "modelo-teste", chaveApi = "sk-teste" })).EnsureSuccessStatusCode();

    private async Task Semear()
    {
        using var scope = _app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var userId = (await db.Users.FirstAsync(u => u.Email == _email)).Id;
        var hoje = scope.ServiceProvider.GetRequiredService<Notas.Api.Services.Financas.FinancasClock>().Hoje();
        db.Transacoes.AddRange(
            new Transacao { UserId = userId, Descricao = "iFood *Pizzaria", Valor = 80m, Tipo = TipoTransacao.Despesa,
                Categoria = Categoria.Alimentacao, Data = hoje },
            new Transacao { UserId = userId, Descricao = "IFOOD Mercado", Valor = 40m, Tipo = TipoTransacao.Despesa,
                Categoria = Categoria.Alimentacao, Data = hoje },
            new Transacao { UserId = userId, Descricao = "Uber", Valor = 25m, Tipo = TipoTransacao.Despesa,
                Categoria = Categoria.Transporte, Data = hoje });
        await db.SaveChangesAsync();
    }

    private static object Pergunta(string texto) => new { mensagens = new[] { new { papel = "usuario", texto } } };

    [Fact]
    public async Task Sem_provedor_de_ia_pede_para_configurar()
    {
        var res = await _client.PostAsJsonAsync("/api/financas/chat", Pergunta("Quanto gastei?"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("Configure", (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("erro").GetString());
    }

    [Fact]
    public async Task Anthropic_consulta_os_dados_e_responde()
    {
        await ConfigurarIa("anthropic");
        await Semear();
        _modelo.Roteiro = corpo => corpo["messages"]!.AsArray().Count == 1
            ? JsonNode.Parse("""
                {"stop_reason":"tool_use","content":[{"type":"tool_use","id":"t1","name":"buscar_transacoes","input":{"texto":"ifood"}}]}
                """)!.AsObject()
            : new JsonObject
            {
                ["stop_reason"] = "end_turn",
                ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = "Você gastou R$ 120,00 no iFood." }),
            };

        var res = await _client.PostAsJsonAsync("/api/financas/chat", Pergunta("Quanto gastei no ifood?"));
        res.EnsureSuccessStatusCode();
        var corpo = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Você gastou R$ 120,00 no iFood.", corpo.GetProperty("resposta").GetString());
        Assert.Equal("buscar_transacoes", corpo.GetProperty("consultas")[0].GetString());

        // O resultado da consulta voltou ao modelo com os dados do usuário.
        var segunda = _modelo.Recebidos[1];
        Assert.Equal("modelo-teste", segunda["model"]!.GetValue<string>());
        var resultado = segunda["messages"]![2]!["content"]![0]!["content"]!.GetValue<string>();
        var dados = JsonNode.Parse(resultado)!;
        Assert.Equal(2, dados["quantidade"]!.GetValue<int>());
        Assert.Equal(120m, dados["somaDespesas"]!.GetValue<decimal>());
        Assert.Equal("sk-teste", _modelo.Credenciais!.Chave);
    }

    [Fact]
    public async Task OpenRouter_usa_formato_de_funcoes()
    {
        await ConfigurarIa("openrouter");
        await Semear();
        _modelo.Roteiro = corpo => corpo["messages"]!.AsArray().Count == 2
            ? JsonNode.Parse("""
                {"choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","content":null,
                 "tool_calls":[{"id":"c1","type":"function","function":{"name":"evolucao_mensal","arguments":"{\"meses\":3}"}}]}}]}
                """)!.AsObject()
            : JsonNode.Parse("""{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"Ok."}}]}""")!.AsObject();

        var res = await _client.PostAsJsonAsync("/api/financas/chat", Pergunta("Como foram os últimos meses?"));
        res.EnsureSuccessStatusCode();
        Assert.Equal("Ok.", (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("resposta").GetString());

        var msgs = _modelo.Recebidos[1]["messages"]!.AsArray();
        Assert.Equal("system", msgs[0]!["role"]!.GetValue<string>());
        Assert.Equal("tool", msgs[3]!["role"]!.GetValue<string>());
        var meses = JsonNode.Parse(msgs[3]!["content"]!.GetValue<string>())!.AsArray();
        Assert.Equal(3, meses.Count);
        Assert.Equal(145m, meses[2]!["consumo"]!.GetValue<decimal>());
    }

    [Fact]
    public async Task Conversa_precisa_terminar_numa_pergunta()
    {
        var res = await _client.PostAsJsonAsync("/api/financas/chat",
            new { mensagens = new[] { new { papel = "assistente", texto = "Olá" } } });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    private sealed class ModeloFalso : IChatModeloCliente
    {
        public Func<JsonObject, JsonObject> Roteiro { get; set; } = _ => new JsonObject();
        public List<JsonObject> Recebidos { get; } = [];
        public CredenciaisLlm? Credenciais { get; private set; }

        public Task<JsonObject> EnviarAsync(CredenciaisLlm credenciais, JsonObject corpo, CancellationToken ct)
        {
            Credenciais = credenciais;
            Recebidos.Add(corpo);
            return Task.FromResult(Roteiro(corpo));
        }
    }
}
