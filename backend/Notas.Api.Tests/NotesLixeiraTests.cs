using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api.Data;
using Notas.Api.Services.Lixeira;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>Lixeira de notas (spec 018): o conteúdo fica, sincroniza e some de vez em 30 dias.</summary>
public class NotesLixeiraTests : IClassFixture<TasksApiFactory>
{
    private readonly TasksApiFactory _factory;
    public NotesLixeiraTests(TasksApiFactory factory) => _factory = factory;

    private async Task<HttpClient> Logado()
    {
        var client = _factory.CreateClient();
        var res = await client.PostAsJsonAsync("/api/auth/register", new { email = $"lixeira_{Guid.NewGuid():N}@example.com", password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString();
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static object Nota(string id, DateTime updatedAt, DateTime? trashedAt = null, DateTime? deletedAt = null) => new
    {
        id, folderId = (string?)null, title = "Caderno", elements = "[{\"id\":\"p1\",\"elements\":[{\"id\":\"e1\",\"type\":\"text\"}]}]",
        createdAt = updatedAt, updatedAt, deletedAt, trashedAt,
    };

    [Fact]
    public async Task Mandar_para_a_lixeira_guarda_o_conteudo_e_sai_da_lista()
    {
        var client = await Logado();
        var id = Guid.NewGuid().ToString();
        var t0 = DateTime.UtcNow.AddMinutes(-5);
        (await client.PutAsJsonAsync($"/api/notes/{id}", Nota(id, t0))).EnsureSuccessStatusCode();

        var lixo = DateTime.UtcNow;
        var res = await client.PutAsJsonAsync($"/api/notes/{id}", Nota(id, lixo, trashedAt: lixo));
        var dto = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("e1", dto.GetProperty("elements").GetString());
        Assert.NotEqual(JsonValueKind.Null, dto.GetProperty("trashedAt").ValueKind);

        var lista = await client.GetFromJsonAsync<JsonElement>("/api/notes");
        Assert.DoesNotContain(lista.EnumerateArray(), n => n.GetProperty("id").GetString() == id);

        var delta = await client.GetFromJsonAsync<JsonElement>($"/api/notes?since={t0.AddMinutes(-1):O}");
        var item = Assert.Single(delta.EnumerateArray(), n => n.GetProperty("id").GetString() == id);
        Assert.NotEqual(JsonValueKind.Null, item.GetProperty("trashedAt").ValueKind);
    }

    [Fact]
    public async Task Restaurar_tira_da_lixeira_e_edicao_mais_velha_nao_vence()
    {
        var client = await Logado();
        var id = Guid.NewGuid().ToString();
        var t = DateTime.UtcNow.AddMinutes(-10);
        await client.PutAsJsonAsync($"/api/notes/{id}", Nota(id, t, trashedAt: t));

        // Um aparelho offline com versão mais velha não tira a nota da lixeira.
        var velho = await (await client.PutAsJsonAsync($"/api/notes/{id}", Nota(id, t.AddMinutes(-1)))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.NotEqual(JsonValueKind.Null, velho.GetProperty("trashedAt").ValueKind);

        var restaurada = await (await client.PutAsJsonAsync($"/api/notes/{id}", Nota(id, DateTime.UtcNow))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, restaurada.GetProperty("trashedAt").ValueKind);
    }

    [Fact]
    public async Task Excluir_para_sempre_zera_e_tira_da_lixeira()
    {
        var client = await Logado();
        var id = Guid.NewGuid().ToString();
        var t = DateTime.UtcNow.AddMinutes(-3);
        await client.PutAsJsonAsync($"/api/notes/{id}", Nota(id, t, trashedAt: t));
        var agora = DateTime.UtcNow;
        var dto = await (await client.PutAsJsonAsync($"/api/notes/{id}", Nota(id, agora, trashedAt: t, deletedAt: agora))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("[]", dto.GetProperty("elements").GetString());
        Assert.Equal(JsonValueKind.Null, dto.GetProperty("trashedAt").ValueKind);
    }

    [Fact]
    public async Task Limpeza_exclui_de_vez_so_o_que_passou_de_30_dias()
    {
        var client = await Logado();
        var antiga = Guid.NewGuid().ToString();
        var recente = Guid.NewGuid().ToString();
        var t = DateTime.UtcNow.AddMinutes(-1);
        await client.PutAsJsonAsync($"/api/notes/{antiga}", Nota(antiga, t, trashedAt: DateTime.UtcNow.AddDays(-31)));
        await client.PutAsJsonAsync($"/api/notes/{recente}", Nota(recente, t, trashedAt: DateTime.UtcNow.AddDays(-29)));

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await NotesLixeiraWorker.LimparAsync(db, DateTime.UtcNow, CancellationToken.None);

        var a = await db.Notes.AsNoTracking().SingleAsync(n => n.Id == antiga);
        var r = await db.Notes.AsNoTracking().SingleAsync(n => n.Id == recente);
        Assert.NotNull(a.DeletedAt);
        Assert.Equal("[]", a.Elements);
        Assert.Null(a.TrashedAt);
        Assert.True(a.UpdatedAt > t);
        Assert.Null(r.DeletedAt);
        Assert.NotNull(r.TrashedAt);
    }
}
