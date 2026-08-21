using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Notas.Api.Tests;

public class ImageProjectsTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private readonly TasksApiFactory _factory;
    private HttpClient _client = null!;

    public ImageProjectsTests(TasksApiFactory factory)
    {
        _factory = factory;
    }

    public async Task InitializeAsync()
    {
        _client = _factory.CreateClient();
        var token = await RegisterAndGetToken();
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        return Task.CompletedTask;
    }

    private async Task<string> RegisterAndGetToken()
    {
        var email = $"img_{Guid.NewGuid():N}@example.com";
        var res = await _factory.CreateClient()
            .PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("accessToken").GetString()!;
    }

    private static object Payload(string id, string name, string data, DateTime updatedAt) => new
    {
        id,
        name,
        data,
        createdAt = updatedAt,
        updatedAt,
        deletedAt = (DateTime?)null,
    };

    [Fact]
    public async Task Salva_le_e_lista_projeto()
    {
        var id = Guid.NewGuid().ToString();
        var now = DateTime.UtcNow;
        var data = """{"images":[{"name":"arte.png","widthMm":100}]}""";

        var put = await _client.PutAsJsonAsync($"/api/imagens/projetos/{id}", Payload(id, "Topo de bolo", data, now));
        put.EnsureSuccessStatusCode();

        var get = await _client.GetFromJsonAsync<JsonElement>($"/api/imagens/projetos/{id}");
        Assert.Equal("Topo de bolo", get.GetProperty("name").GetString());
        Assert.Equal(data, get.GetProperty("data").GetString());

        var list = await _client.GetFromJsonAsync<JsonElement>("/api/imagens/projetos");
        Assert.Contains(list.EnumerateArray(), p => p.GetProperty("id").GetString() == id);
    }

    [Fact]
    public async Task Upsert_e_idempotente_e_ignora_versao_antiga()
    {
        var id = Guid.NewGuid().ToString();
        var now = DateTime.UtcNow;

        await _client.PutAsJsonAsync($"/api/imagens/projetos/{id}", Payload(id, "v2", "{\"v\":2}", now));
        // versão mais velha não pode sobrescrever a mais nova (last-write-wins por UpdatedAt)
        var stale = await _client.PutAsJsonAsync($"/api/imagens/projetos/{id}",
            Payload(id, "v1", "{\"v\":1}", now.AddMinutes(-5)));
        stale.EnsureSuccessStatusCode();

        var get = await _client.GetFromJsonAsync<JsonElement>($"/api/imagens/projetos/{id}");
        Assert.Equal("v2", get.GetProperty("name").GetString());

        // versão mais nova sobrescreve
        await _client.PutAsJsonAsync($"/api/imagens/projetos/{id}", Payload(id, "v3", "{\"v\":3}", now.AddMinutes(5)));
        get = await _client.GetFromJsonAsync<JsonElement>($"/api/imagens/projetos/{id}");
        Assert.Equal("v3", get.GetProperty("name").GetString());
    }

    [Fact]
    public async Task Exclusao_logica_some_da_lista_e_do_get()
    {
        var id = Guid.NewGuid().ToString();
        await _client.PutAsJsonAsync($"/api/imagens/projetos/{id}", Payload(id, "descartável", "{}", DateTime.UtcNow));

        var del = await _client.DeleteAsync($"/api/imagens/projetos/{id}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        var get = await _client.GetAsync($"/api/imagens/projetos/{id}");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);

        var list = await _client.GetFromJsonAsync<JsonElement>("/api/imagens/projetos");
        Assert.DoesNotContain(list.EnumerateArray(), p => p.GetProperty("id").GetString() == id);
    }

    [Fact]
    public async Task Projeto_de_outro_usuario_nao_e_acessivel()
    {
        var id = Guid.NewGuid().ToString();
        await _client.PutAsJsonAsync($"/api/imagens/projetos/{id}", Payload(id, "meu", "{}", DateTime.UtcNow));

        using var outro = _factory.CreateClient();
        outro.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", await RegisterAndGetToken());

        var get = await outro.GetAsync($"/api/imagens/projetos/{id}");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);

        // e nem consegue sequestrar o Id de outro dono
        var put = await outro.PutAsJsonAsync($"/api/imagens/projetos/{id}", Payload(id, "roubado", "{}", DateTime.UtcNow));
        Assert.Equal(HttpStatusCode.Conflict, put.StatusCode);
    }

    [Fact]
    public async Task Exige_autenticacao()
    {
        using var anonimo = _factory.CreateClient();
        var res = await anonimo.GetAsync("/api/imagens/projetos");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Projeto_grande_demais_e_recusado()
    {
        var id = Guid.NewGuid().ToString();
        var gigante = new string('x', 9 * 1024 * 1024 + 10);
        var res = await _client.PutAsJsonAsync($"/api/imagens/projetos/{id}", Payload(id, "gigante", gigante, DateTime.UtcNow));
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, res.StatusCode);
    }
}
