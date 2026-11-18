using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Notas.Api.Endpoints;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>Tags nas notas (spec 021).</summary>
public class NotesTagsTests : IClassFixture<TasksApiFactory>
{
    private readonly TasksApiFactory _factory;
    public NotesTagsTests(TasksApiFactory factory) => _factory = factory;

    private async Task<HttpClient> Logado()
    {
        var client = _factory.CreateClient();
        var res = await client.PostAsJsonAsync("/api/auth/register", new { email = $"tags_{Guid.NewGuid():N}@example.com", password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString();
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static object Nota(string id, DateTime t, string[]? tags) => tags is null
        ? new { id, folderId = (string?)null, title = "N", elements = "[]", createdAt = t, updatedAt = t, deletedAt = (DateTime?)null }
        : new { id, folderId = (string?)null, title = "N", elements = "[]", createdAt = t, updatedAt = t, deletedAt = (DateTime?)null, tags };

    private static string[] Tags(JsonElement dto) => dto.GetProperty("tags").EnumerateArray().Select(t => t.GetString()!).ToArray();

    [Fact]
    public async Task Normaliza_e_guarda_as_tags()
    {
        var c = await Logado();
        var id = Guid.NewGuid().ToString();
        var dto = await (await c.PutAsJsonAsync($"/api/notes/{id}", Nota(id, DateTime.UtcNow.AddMinutes(-2), [" Faculdade ", "provas", "faculdade", ""]))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(new[] { "faculdade", "provas" }, Tags(dto));
    }

    [Fact]
    public async Task Cliente_sem_tags_nao_apaga_as_existentes_e_lista_vazia_apaga()
    {
        var c = await Logado();
        var id = Guid.NewGuid().ToString();
        await c.PutAsJsonAsync($"/api/notes/{id}", Nota(id, DateTime.UtcNow.AddMinutes(-3), ["casa"]));
        var semCampo = await (await c.PutAsJsonAsync($"/api/notes/{id}", Nota(id, DateTime.UtcNow.AddMinutes(-2), null))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(new[] { "casa" }, Tags(semCampo));
        var vazia = await (await c.PutAsJsonAsync($"/api/notes/{id}", Nota(id, DateTime.UtcNow.AddMinutes(-1), []))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Empty(Tags(vazia));
    }

    [Fact]
    public async Task Recusa_acima_dos_limites()
    {
        var c = await Logado();
        var id = Guid.NewGuid().ToString();
        var muitas = Enumerable.Range(0, 21).Select(i => $"t{i}").ToArray();
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PutAsJsonAsync($"/api/notes/{id}", Nota(id, DateTime.UtcNow, muitas))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PutAsJsonAsync($"/api/notes/{id}", Nota(id, DateTime.UtcNow, [new string('a', 41)]))).StatusCode);
    }

    [Fact]
    public void Normalizacao_pura() =>
        Assert.Equal(new[] { "a", "b" }, NotesEndpoints.NormalizarTags(["A", " b", "a ", null])!);
}
