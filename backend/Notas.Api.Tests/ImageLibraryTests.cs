using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Notas.Api.Tests;

public class ImageLibraryTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private const string Png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    private readonly TasksApiFactory _factory;
    private HttpClient _client = null!;

    public ImageLibraryTests(TasksApiFactory factory) => _factory = factory;

    public async Task InitializeAsync() => _client = await ClienteLogado();

    public Task DisposeAsync()
    {
        _client.Dispose();
        return Task.CompletedTask;
    }

    private async Task<HttpClient> ClienteLogado()
    {
        var email = $"lib_{Guid.NewGuid():N}@example.com";
        var res = await _factory.CreateClient().PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    [Fact]
    public async Task Guarda_lista_so_com_miniatura_e_devolve_a_arte()
    {
        var id = Guid.NewGuid().ToString();
        var put = await _client.PutAsJsonAsync($"/api/imagens/biblioteca/{id}", new { name = "Logo", origin = "corte", data = Png, thumb = Png, widthMm = 80 });
        put.EnsureSuccessStatusCode();

        var lista = await _client.GetFromJsonAsync<JsonElement>("/api/imagens/biblioteca");
        var item = lista.EnumerateArray().Single();
        Assert.Equal("Logo", item.GetProperty("name").GetString());
        Assert.False(item.TryGetProperty("data", out _));

        var cheio = await _client.GetFromJsonAsync<JsonElement>($"/api/imagens/biblioteca/{id}");
        Assert.Equal(Png, cheio.GetProperty("data").GetString());
        Assert.Equal(80, cheio.GetProperty("widthMm").GetDouble());
    }

    [Fact]
    public async Task Recusa_o_que_nao_e_imagem()
    {
        var res = await _client.PutAsJsonAsync($"/api/imagens/biblioteca/{Guid.NewGuid()}", new { name = "x", data = "data:text/html;base64,PGgxPg==", thumb = Png, widthMm = 1 });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Outro_usuario_nao_ve_nem_apaga()
    {
        var id = Guid.NewGuid().ToString();
        (await _client.PutAsJsonAsync($"/api/imagens/biblioteca/{id}", new { name = "Minha", data = Png, thumb = Png, widthMm = 10 })).EnsureSuccessStatusCode();

        using var outro = await ClienteLogado();
        Assert.Equal(HttpStatusCode.NotFound, (await outro.GetAsync($"/api/imagens/biblioteca/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outro.DeleteAsync($"/api/imagens/biblioteca/{id}")).StatusCode);
        Assert.Empty((await outro.GetFromJsonAsync<JsonElement>("/api/imagens/biblioteca")).EnumerateArray());

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/imagens/biblioteca/{id}")).StatusCode);
    }
}
