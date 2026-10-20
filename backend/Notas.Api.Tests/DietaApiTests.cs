using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api.Services.Dieta;
using Notas.Api.Services.Financas;
using Xunit;

namespace Notas.Api.Tests;

public class DietaApiTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private readonly TasksApiFactory _factory;
    private HttpClient _client = null!;
    private DateOnly _hoje;

    public DietaApiTests(TasksApiFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _client = await NovoCliente();
        _hoje = _factory.Services.GetRequiredService<FinancasClock>().Hoje();
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        return Task.CompletedTask;
    }

    private async Task<HttpClient> NovoCliente()
    {
        var email = $"dieta_{Guid.NewGuid():N}@example.com";
        var res = await _factory.CreateClient().PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString();
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    private Task<HttpResponseMessage> Registrar(HttpClient c, string alimentoId, double gramas, DateOnly data, string refeicao = "almoco") =>
        c.PutAsJsonAsync($"/api/dieta/registros/{Guid.NewGuid()}", new
        {
            data, refeicao, alimentoId, quantidadeG = gramas, updatedAt = DateTime.UtcNow,
        });

    [Fact]
    public async Task Taco_vem_carregada_e_a_busca_ignora_acento()
    {
        var achados = await _client.GetFromJsonAsync<JsonElement>("/api/dieta/alimentos?q=feijao carioca");
        Assert.True(achados.GetArrayLength() > 0);
        Assert.All(achados.EnumerateArray(), a => Assert.Contains("Feijão", a.GetProperty("nome").GetString()));
        Assert.Equal("taco", achados[0].GetProperty("fonte").GetString());
    }

    [Fact]
    public async Task Registro_sem_valores_e_calculado_pelo_alimento()
    {
        // taco-1 = arroz integral cozido, 124 kcal / 100 g.
        var res = await Registrar(_client, "taco-1", 150, _hoje);
        res.EnsureSuccessStatusCode();
        var r = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(186, r.GetProperty("kcal").GetDouble());
        Assert.Equal("Arroz, integral, cozido", r.GetProperty("nome").GetString());

        var dia = await _client.GetFromJsonAsync<JsonElement>($"/api/dieta/dia/{_hoje:yyyy-MM-dd}");
        Assert.Equal(186, dia.GetProperty("totais").GetProperty("kcal").GetDouble());
        Assert.Equal(1, dia.GetProperty("registros").GetArrayLength());
    }

    [Fact]
    public async Task Sync_ignora_versao_mais_antiga_e_exclui_por_tombstone()
    {
        var id = Guid.NewGuid().ToString();
        var t1 = DateTime.UtcNow;
        object Corpo(double kg, DateTime em, DateTime? del = null) => new { data = _hoje, kg, updatedAt = em, deletedAt = del };
        (await _client.PutAsJsonAsync($"/api/dieta/pesos/{id}", Corpo(80, t1))).EnsureSuccessStatusCode();
        var antigo = await (await _client.PutAsJsonAsync($"/api/dieta/pesos/{id}", Corpo(90, t1.AddMinutes(-5)))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(80, antigo.GetProperty("kg").GetDouble());

        (await _client.PutAsJsonAsync($"/api/dieta/pesos/{id}", Corpo(80, t1.AddMinutes(1), t1.AddMinutes(1)))).EnsureSuccessStatusCode();
        var todos = await _client.GetFromJsonAsync<JsonElement>("/api/dieta/pesos");
        Assert.NotEqual(JsonValueKind.Null, todos[0].GetProperty("deletedAt").ValueKind);
    }

    [Fact]
    public async Task Outro_usuario_nao_ve_nem_sobrescreve()
    {
        var res = await Registrar(_client, "taco-1", 100, _hoje);
        var id = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        using var outro = await NovoCliente();
        Assert.Equal(0, (await outro.GetFromJsonAsync<JsonElement>("/api/dieta/registros")).GetArrayLength());
        var tentativa = await outro.PutAsJsonAsync($"/api/dieta/registros/{id}", new { data = _hoje, refeicao = "cafe", alimentoId = "taco-1", quantidadeG = 1, updatedAt = DateTime.UtcNow.AddHours(1) });
        Assert.Equal(HttpStatusCode.Conflict, tentativa.StatusCode);
    }

    [Fact]
    public async Task Metas_sugeridas_pelo_perfil_e_peso()
    {
        (await _client.PutAsJsonAsync("/api/dieta/perfil", new
        {
            alturaCm = 180, nascimento = new DateOnly(1990, 1, 1), sexo = "M", atividade = 1.2, objetivo = "manter",
        })).EnsureSuccessStatusCode();
        (await _client.PutAsJsonAsync($"/api/dieta/pesos/{Guid.NewGuid()}", new { data = _hoje, kg = 80, updatedAt = DateTime.UtcNow })).EnsureSuccessStatusCode();
        var p = await _client.GetFromJsonAsync<JsonElement>("/api/dieta/perfil");
        var kcal = p.GetProperty("metas").GetProperty("kcal").GetInt32();
        Assert.InRange(kcal, 2000, 2300);
        Assert.Equal(2800, p.GetProperty("metas").GetProperty("aguaMl").GetInt32());
    }

    [Fact]
    public async Task Receita_calcula_valores_por_100g()
    {
        var itens = JsonSerializer.Serialize(new[] { new { alimentoId = "taco-1", nome = "arroz", gramas = 100 }, new { alimentoId = "taco-1", nome = "arroz", gramas = 100 } });
        var res = await _client.PutAsJsonAsync($"/api/dieta/alimentos/{Guid.NewGuid()}", new
        {
            nome = "Arroz da casa", porcaoG = 200, fonte = "receita", itens, updatedAt = DateTime.UtcNow,
        });
        res.EnsureSuccessStatusCode();
        Assert.Equal(124, (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("kcal").GetDouble());
    }

    [Fact]
    public async Task Progresso_da_xp_sequencia_e_conquista()
    {
        for (var i = 0; i < 7; i++) (await Registrar(_client, "taco-1", 100, _hoje.AddDays(-i))).EnsureSuccessStatusCode();
        var p = await _client.GetFromJsonAsync<JsonElement>("/api/dieta/progresso");
        Assert.Equal(7, p.GetProperty("sequenciaRegistro").GetInt32());
        Assert.True(p.GetProperty("xpTotal").GetInt32() >= 70);
        var conquistas = p.GetProperty("conquistas").EnumerateArray().ToList();
        Assert.Contains(conquistas, c => c.GetProperty("codigo").GetString() == "sequencia_7" && c.GetProperty("em").ValueKind != JsonValueKind.Null);
    }

    [Fact]
    public void Um_dia_em_branco_por_semana_nao_quebra_a_sequencia_e_niveis_crescem()
    {
        Assert.Equal((1, 0, 100), DietaProgresso.Nivel(0));
        Assert.Equal((2, 0, 200), DietaProgresso.Nivel(100));
        Assert.Equal((2, 150, 200), DietaProgresso.Nivel(250));
    }

    [Fact]
    public async Task Fotos_sobem_baixam_e_saem_do_link_publico_so_com_escopo()
    {
        var fotoId = Guid.NewGuid().ToString();
        using var form = new MultipartFormDataContent
        {
            { new StringContent(fotoId), "id" }, { new StringContent(_hoje.ToString("yyyy-MM-dd")), "data" },
            { new StringContent("corpo"), "tipo" }, { new StringContent("frente"), "rotulo" },
        };
        var arquivo = new ByteArrayContent([0xFF, 0xD8, 0xFF, 0xD9]);
        arquivo.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(arquivo, "arquivo", "f.jpg");
        (await _client.PostAsync("/api/dieta/fotos", form)).EnsureSuccessStatusCode();
        Assert.Equal(4, (await _client.GetByteArrayAsync($"/api/dieta/fotos/{fotoId}/arquivo")).Length);

        var anon = _factory.CreateClient();
        async Task<JsonElement> Link(params string[] escopos) =>
            await (await _client.PostAsJsonAsync("/api/dieta/compartilhamentos", new { titulo = "Teste", escopos })).Content.ReadFromJsonAsync<JsonElement>();

        var semCorpo = await Link("peso", "conquistas");
        var url = new Uri(semCorpo.GetProperty("url").GetString()!).AbsolutePath;
        var html = await anon.GetStringAsync(url);
        Assert.Contains("Nível", html);
        Assert.DoesNotContain("Fotos de progresso", html);
        Assert.Equal(HttpStatusCode.NotFound, (await anon.GetAsync(url + "fotos/" + fotoId)).StatusCode);

        var comCorpo = new Uri((await Link("fotos_corpo")).GetProperty("url").GetString()!).AbsolutePath;
        Assert.Equal(HttpStatusCode.OK, (await anon.GetAsync(comCorpo + "fotos/" + fotoId)).StatusCode);

        (await _client.DeleteAsync($"/api/dieta/compartilhamentos/{semCorpo.GetProperty("id").GetString()}")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await anon.GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task Sem_login_401()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await _factory.CreateClient().GetAsync("/api/dieta/progresso")).StatusCode);
    }
}
