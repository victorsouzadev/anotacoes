using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Notas.Api.Tests;

public class ImageSocialTemplatesTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private const string Png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    private const string Modelo = "{\"formatId\":\"story\",\"slides\":1,\"overlays\":[]}";
    private readonly TasksApiFactory _factory;
    private HttpClient _client = null!;

    public ImageSocialTemplatesTests(TasksApiFactory factory) => _factory = factory;

    public async Task InitializeAsync() => _client = await ClienteLogado();

    public Task DisposeAsync()
    {
        _client.Dispose();
        return Task.CompletedTask;
    }

    private async Task<HttpClient> ClienteLogado()
    {
        var email = $"mod_{Guid.NewGuid():N}@example.com";
        var res = await _factory.CreateClient().PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    [Fact]
    public async Task Guarda_atualiza_lista_e_apaga()
    {
        var id = Guid.NewGuid().ToString();
        var put = await _client.PutAsJsonAsync($"/api/imagens/modelos/{id}", new { name = "Promo", group = "Story", replaces = "", data = Modelo, thumb = Png });
        put.EnsureSuccessStatusCode();

        (await _client.PutAsJsonAsync($"/api/imagens/modelos/{id}", new { name = "Promo de sábado", group = "Story", replaces = "", data = Modelo, thumb = Png })).EnsureSuccessStatusCode();

        var lista = await _client.GetFromJsonAsync<JsonElement>("/api/imagens/modelos");
        var item = lista.EnumerateArray().Single();
        Assert.Equal("Promo de sábado", item.GetProperty("name").GetString());
        Assert.Equal("Story", item.GetProperty("group").GetString());
        Assert.Equal(Modelo, item.GetProperty("data").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/imagens/modelos/{id}")).StatusCode);
        Assert.Empty((await _client.GetFromJsonAsync<JsonElement>("/api/imagens/modelos")).EnumerateArray());
    }

    [Fact]
    public async Task Recusa_grupo_json_e_miniatura_invalidos()
    {
        var url = $"/api/imagens/modelos/{Guid.NewGuid()}";
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PutAsJsonAsync(url, new { name = "x", group = "Reels", data = Modelo, thumb = Png })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PutAsJsonAsync(url, new { name = "x", group = "Feed", data = "[1,2]", thumb = Png })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PutAsJsonAsync(url, new { name = "x", group = "Feed", data = "{", thumb = Png })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PutAsJsonAsync(url, new { name = "x", group = "Feed", data = Modelo, thumb = "oi" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PutAsJsonAsync(url, new { name = " ", group = "Feed", data = Modelo, thumb = Png })).StatusCode);
    }

    [Fact]
    public async Task Um_modelo_do_editor_so_tem_uma_versao_editada()
    {
        var primeiro = Guid.NewGuid().ToString();
        (await _client.PutAsJsonAsync($"/api/imagens/modelos/{primeiro}", new { name = "Obrigada", group = "Feed", replaces = "vm-feed-obrigada", data = Modelo, thumb = Png })).EnsureSuccessStatusCode();

        var outro = await _client.PutAsJsonAsync($"/api/imagens/modelos/{Guid.NewGuid()}", new { name = "Obrigada 2", group = "Feed", replaces = "vm-feed-obrigada", data = Modelo, thumb = Png });
        Assert.Equal(HttpStatusCode.Conflict, outro.StatusCode);

        // atualizar a versão que existe continua valendo
        (await _client.PutAsJsonAsync($"/api/imagens/modelos/{primeiro}", new { name = "Obrigada!", group = "Feed", replaces = "vm-feed-obrigada", data = Modelo, thumb = Png })).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Outro_usuario_nao_ve_nem_apaga()
    {
        var id = Guid.NewGuid().ToString();
        (await _client.PutAsJsonAsync($"/api/imagens/modelos/{id}", new { name = "Meu", group = "Carrossel", data = Modelo, thumb = Png })).EnsureSuccessStatusCode();

        using var outro = await ClienteLogado();
        Assert.Empty((await outro.GetFromJsonAsync<JsonElement>("/api/imagens/modelos")).EnumerateArray());
        Assert.Equal(HttpStatusCode.NotFound, (await outro.DeleteAsync($"/api/imagens/modelos/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await outro.PutAsJsonAsync($"/api/imagens/modelos/{id}", new { name = "Roubo", group = "Feed", data = Modelo, thumb = Png })).StatusCode);
    }

    [Fact]
    public async Task Legenda_sem_ia_configurada_responde_com_o_motivo()
    {
        var res = await _client.PostAsJsonAsync("/api/imagens/legenda", new { imagem = Png, textos = new[] { "novidade" }, formato = "feed", tom = "carinhoso" });
        res.EnsureSuccessStatusCode();
        var corpo = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(corpo.GetProperty("usouIa").GetBoolean());
        Assert.Empty(corpo.GetProperty("legendas").EnumerateArray());
        Assert.False(string.IsNullOrWhiteSpace(corpo.GetProperty("motivo").GetString()));
    }

    [Fact]
    public async Task Legenda_recusa_previa_que_nao_e_imagem()
    {
        var res = await _client.PostAsJsonAsync("/api/imagens/legenda", new { imagem = "data:text/html;base64,PGgxPg==", textos = new[] { "x" } });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }
}
