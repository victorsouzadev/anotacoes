using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>Sincronização do app Treino Corrida (/api/treino).</summary>
public class TreinoApiTests : IClassFixture<TasksApiFactory>
{
    private readonly TasksApiFactory _factory;

    public TreinoApiTests(TasksApiFactory factory) => _factory = factory;

    private async Task<HttpClient> NovoCliente()
    {
        var email = $"treino_{Guid.NewGuid():N}@example.com";
        var res = await _factory.CreateClient().PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString();
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    private static object Atividade(DateTime atualizado, string titulo = "Semana 1 · Sessão 1", double distancia = 3200, DateTime? excluido = null) => new
    {
        id = "ignorado", inicio = new DateTime(2026, 10, 20, 9, 0, 0, DateTimeKind.Utc), tipo = "sessao", titulo, duracaoSeg = 1800,
        distanciaM = distancia, maiorCorridaSeg = 60, esforco = 5, dor = false, meta = (string?)null, fcMedia = 150, fcMax = 171,
        nota = (string?)null, updatedAt = atualizado, deletedAt = excluido,
    };

    [Fact]
    public async Task Sem_login_401()
    {
        var res = await _factory.CreateClient().GetAsync("/api/treino/atividades");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Put_e_idempotente_e_o_mais_novo_vence()
    {
        var c = await NovoCliente();
        var id = Guid.NewGuid().ToString();
        var t0 = new DateTime(2026, 10, 20, 10, 0, 0, DateTimeKind.Utc);
        (await c.PutAsJsonAsync($"/api/treino/atividades/{id}", Atividade(t0))).EnsureSuccessStatusCode();
        (await c.PutAsJsonAsync($"/api/treino/atividades/{id}", Atividade(t0.AddMinutes(5), "Editado", 3500))).EnsureSuccessStatusCode();
        // Uma cópia antiga chegando depois não desfaz a edição.
        (await c.PutAsJsonAsync($"/api/treino/atividades/{id}", Atividade(t0.AddMinutes(1), "Antigo"))).EnsureSuccessStatusCode();

        var lista = await c.GetFromJsonAsync<JsonElement>("/api/treino/atividades");
        Assert.Equal(1, lista.GetArrayLength());
        Assert.Equal(id, lista[0].GetProperty("id").GetString());
        Assert.Equal("Editado", lista[0].GetProperty("titulo").GetString());
        Assert.Equal(3500, lista[0].GetProperty("distanciaM").GetDouble());

        var depois = await c.GetFromJsonAsync<JsonElement>($"/api/treino/atividades?desde={t0.AddMinutes(10):O}");
        Assert.Equal(0, depois.GetArrayLength());
    }

    [Fact]
    public async Task Id_de_outro_usuario_409_e_dados_invalidos_400()
    {
        var a = await NovoCliente();
        var b = await NovoCliente();
        var id = Guid.NewGuid().ToString();
        (await a.PutAsJsonAsync($"/api/treino/atividades/{id}", Atividade(DateTime.UtcNow))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await b.PutAsJsonAsync($"/api/treino/atividades/{id}", Atividade(DateTime.UtcNow))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.PutAsJsonAsync($"/api/treino/atividades/{Guid.NewGuid()}", Atividade(DateTime.UtcNow, distancia: -1))).StatusCode);
        Assert.Equal(0, (await b.GetFromJsonAsync<JsonElement>("/api/treino/atividades")).GetArrayLength());
    }

    [Fact]
    public async Task Plano_grava_e_le()
    {
        var c = await NovoCliente();
        Assert.Equal(HttpStatusCode.NoContent, (await c.GetAsync("/api/treino/plano")).StatusCode);
        (await c.PutAsJsonAsync("/api/treino/plano", new
        {
            programa = "Do zero aos 5 km", semana = 3, semanasTotal = 9, sessoesFeitas = 7, sessoesTotal = 27,
            proximaSessao = "Semana 3 · Sessão 2", updatedAt = DateTime.UtcNow,
        })).EnsureSuccessStatusCode();
        var p = await c.GetFromJsonAsync<JsonElement>("/api/treino/plano");
        Assert.Equal("Do zero aos 5 km", p.GetProperty("programa").GetString());
        Assert.Equal(7, p.GetProperty("sessoesFeitas").GetInt32());
    }
}
