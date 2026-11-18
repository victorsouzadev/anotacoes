using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>Link somente leitura de nota (spec 023).</summary>
public class NoteShareTests : IClassFixture<TasksApiFactory>
{
    private readonly TasksApiFactory _factory;
    public NoteShareTests(TasksApiFactory factory) => _factory = factory;

    private async Task<HttpClient> Logado()
    {
        var client = _factory.CreateClient();
        var res = await client.PostAsJsonAsync("/api/auth/register", new { email = $"share_{Guid.NewGuid():N}@example.com", password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString();
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<string> NovaNota(HttpClient c, string titulo = "Receita de bolo")
    {
        var id = Guid.NewGuid().ToString();
        var t = DateTime.UtcNow.AddMinutes(-1);
        (await c.PutAsJsonAsync($"/api/notes/{id}", new
        {
            id, folderId = (string?)null, title = titulo, elements = "[{\"id\":\"p1\",\"elements\":[]}]",
            createdAt = t, updatedAt = t, deletedAt = (DateTime?)null,
        })).EnsureSuccessStatusCode();
        return id;
    }

    private static string TokenDa(JsonElement criado) => criado.GetProperty("url").GetString()!.Split("/p/nota/")[1];

    [Fact]
    public async Task Link_abre_sem_login_e_so_mostra_titulo_e_paginas()
    {
        var dona = await Logado();
        var id = await NovaNota(dona);
        var criado = await (await dona.PostAsJsonAsync($"/api/notes/{id}/links", new { nome = "Ana", diasValidade = 7 })).Content.ReadFromJsonAsync<JsonElement>();
        var token = TokenDa(criado);

        var anonimo = _factory.CreateClient();
        var res = await anonimo.GetAsync($"/api/notes/publico/{token}");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        var campos = json.EnumerateObject().Select(p => p.Name).OrderBy(n => n).ToArray();
        Assert.Equal(new[] { "elements", "title", "updatedAt" }, campos);
        Assert.Equal("Receita de bolo", json.GetProperty("title").GetString());

        var lista = await dona.GetFromJsonAsync<JsonElement>($"/api/notes/{id}/links");
        var item = Assert.Single(lista.EnumerateArray());
        Assert.False(item.TryGetProperty("url", out _));
    }

    [Fact]
    public async Task Revogar_e_mandar_para_a_lixeira_param_o_link()
    {
        var dona = await Logado();
        var id = await NovaNota(dona);
        var a = await (await dona.PostAsJsonAsync($"/api/notes/{id}/links", new { nome = "A" })).Content.ReadFromJsonAsync<JsonElement>();
        var b = await (await dona.PostAsJsonAsync($"/api/notes/{id}/links", new { nome = "B" })).Content.ReadFromJsonAsync<JsonElement>();
        var anonimo = _factory.CreateClient();

        Assert.Equal(HttpStatusCode.NoContent, (await dona.DeleteAsync($"/api/notes/{id}/links/{a.GetProperty("id").GetString()}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await anonimo.GetAsync($"/api/notes/publico/{TokenDa(a)}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anonimo.GetAsync($"/api/notes/publico/{TokenDa(b)}")).StatusCode);

        var agora = DateTime.UtcNow;
        await dona.PutAsJsonAsync($"/api/notes/{id}", new
        {
            id, folderId = (string?)null, title = "x", elements = "[]", createdAt = agora, updatedAt = agora,
            deletedAt = (DateTime?)null, trashedAt = agora,
        });
        Assert.Equal(HttpStatusCode.NotFound, (await anonimo.GetAsync($"/api/notes/publico/{TokenDa(b)}")).StatusCode);
    }

    [Fact]
    public async Task Ninguem_cria_link_para_nota_alheia_e_validade_e_conferida()
    {
        var dona = await Logado();
        var outra = await Logado();
        var id = await NovaNota(dona);
        Assert.Equal(HttpStatusCode.NotFound, (await outra.PostAsJsonAsync($"/api/notes/{id}/links", new { nome = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outra.GetAsync($"/api/notes/{id}/links")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await dona.PostAsJsonAsync($"/api/notes/{id}/links", new { nome = "x", diasValidade = 5 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _factory.CreateClient().GetAsync("/api/notes/publico/token-inventado-que-nao-existe-123")).StatusCode);
    }
}
