using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Notas.Api.Tests;

public class ImagePreferencesTests : IClassFixture<TasksApiFactory>
{
    private readonly TasksApiFactory _factory;

    public ImagePreferencesTests(TasksApiFactory factory) => _factory = factory;

    private async Task<HttpClient> ClienteLogado()
    {
        var email = $"pref_{Guid.NewGuid():N}@example.com";
        var res = await _factory.CreateClient().PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    [Fact]
    public async Task Comeca_vazio_grava_e_le_por_usuario()
    {
        using var a = await ClienteLogado();
        using var b = await ClienteLogado();
        Assert.Equal("{}", (await a.GetFromJsonAsync<JsonElement>("/api/imagens/preferencias")).GetProperty("data").GetString());

        var data = """{"materiais":[{"nome":"Vinil","lamina":2}]}""";
        (await a.PutAsJsonAsync("/api/imagens/preferencias", new { data })).EnsureSuccessStatusCode();
        (await a.PutAsJsonAsync("/api/imagens/preferencias", new { data })).EnsureSuccessStatusCode();

        Assert.Equal(data, (await a.GetFromJsonAsync<JsonElement>("/api/imagens/preferencias")).GetProperty("data").GetString());
        Assert.Equal("{}", (await b.GetFromJsonAsync<JsonElement>("/api/imagens/preferencias")).GetProperty("data").GetString());
    }

    [Fact]
    public async Task Recusa_o_que_nao_e_objeto_json()
    {
        using var a = await ClienteLogado();
        Assert.Equal(HttpStatusCode.BadRequest, (await a.PutAsJsonAsync("/api/imagens/preferencias", new { data = "[1,2]" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.PutAsJsonAsync("/api/imagens/preferencias", new { data = "{oops" })).StatusCode);
    }
}
