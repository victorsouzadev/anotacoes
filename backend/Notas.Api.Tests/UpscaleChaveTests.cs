using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>
/// A chave de ampliação cadastrada pela interface, ponta a ponta: sobe a API de
/// verdade, cadastra a chave pelo mesmo endpoint da tela de Configurações e
/// confere o que o Editor de Imagens enxerga.
/// </summary>
public class UpscaleChaveTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private readonly TasksApiFactory _factory;
    private HttpClient _client = null!;

    public UpscaleChaveTests(TasksApiFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _client = _factory.CreateClient();
        var email = $"ups_{Guid.NewGuid():N}@example.com";
        var res = await _factory.CreateClient()
            .PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString();
        _client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        return Task.CompletedTask;
    }

    private async Task<JsonElement> SalvarAsync(object corpo)
    {
        var res = await _client.PutAsJsonAsync("/api/configuracoes/ia", corpo);
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    private async Task<bool> EditorVeAmpliacaoAsync()
    {
        var res = await _client.GetAsync("/api/imagens/upscale");
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("disponivel").GetBoolean();
    }

    [Fact]
    public async Task Sem_chave_o_editor_nao_oferece_ampliacao()
    {
        Assert.False(await EditorVeAmpliacaoAsync());
    }

    [Fact]
    public async Task Chave_cadastrada_na_tela_liga_o_recurso_no_editor()
    {
        var salvo = await SalvarAsync(new { provedor = "", modelo = (string?)null, chaveApi = (string?)null, chaveUpscale = "r8_chave_de_teste_1234" });

        Assert.True(salvo.GetProperty("chaveUpscaleConfigurada").GetBoolean());
        // Só os últimos caracteres voltam; a chave inteira nunca chega ao cliente.
        Assert.Equal("••••••••1234", salvo.GetProperty("chaveUpscaleMascarada").GetString());
        Assert.DoesNotContain("r8_chave", salvo.ToString());
        Assert.True(await EditorVeAmpliacaoAsync());
    }

    [Fact]
    public async Task Salvar_o_modelo_depois_nao_apaga_a_chave()
    {
        await SalvarAsync(new { provedor = "", modelo = (string?)null, chaveApi = (string?)null, chaveUpscale = "r8_chave_de_teste_5678" });

        // Campo ausente = "não mexer" — é assim que a tela salva quando o usuário
        // mudou só o modelo e deixou o campo da chave em branco.
        var salvo = await SalvarAsync(new { provedor = "openrouter", modelo = "anthropic/claude-haiku-4.5", chaveApi = (string?)null, chaveUpscale = (string?)null });

        Assert.True(salvo.GetProperty("chaveUpscaleConfigurada").GetBoolean());
        Assert.True(await EditorVeAmpliacaoAsync());
    }

    [Fact]
    public async Task A_chave_de_llm_e_a_de_ampliação_sao_independentes()
    {
        await SalvarAsync(new { provedor = "openrouter", modelo = (string?)null, chaveApi = "sk-or-v1-chave-de-teste", chaveUpscale = "r8_chave_de_teste_9999" });

        // Remover a chave de LLM não pode levar a de ampliação junto.
        var apos = await _client.DeleteAsync("/api/configuracoes/ia/chave");
        apos.EnsureSuccessStatusCode();
        var corpo = await apos.Content.ReadFromJsonAsync<JsonElement>();

        Assert.False(corpo.GetProperty("chaveConfigurada").GetBoolean());
        Assert.True(corpo.GetProperty("chaveUpscaleConfigurada").GetBoolean());
        Assert.True(await EditorVeAmpliacaoAsync());
    }

    [Fact]
    public async Task Remover_a_chave_de_ampliação_desliga_o_recurso()
    {
        await SalvarAsync(new { provedor = "", modelo = (string?)null, chaveApi = (string?)null, chaveUpscale = "r8_chave_de_teste_0000" });

        var res = await _client.DeleteAsync("/api/configuracoes/ia/chave-upscale");
        res.EnsureSuccessStatusCode();
        var corpo = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.False(corpo.GetProperty("chaveUpscaleConfigurada").GetBoolean());
        Assert.False(await EditorVeAmpliacaoAsync());
    }

    [Fact]
    public async Task Chave_curta_demais_e_recusada()
    {
        var res = await _client.PutAsJsonAsync("/api/configuracoes/ia",
            new { provedor = "", modelo = (string?)null, chaveApi = (string?)null, chaveUpscale = "r8_" });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Ampliar_sem_chave_explica_onde_cadastrar()
    {
        var res = await _client.PostAsJsonAsync("/api/imagens/upscale",
            new { imagem = "data:image/png;base64,AAECAwQ=", escala = 2 });

        Assert.Equal(HttpStatusCode.ServiceUnavailable, res.StatusCode);
        var corpo = await res.Content.ReadAsStringAsync();
        Assert.Contains("Configurações", corpo);
    }
}
