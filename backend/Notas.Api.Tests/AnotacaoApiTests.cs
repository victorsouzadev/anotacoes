using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>
/// O cadastro do hub é aberto: a ferramenta Anotação só pode mostrar relato a quem está
/// em Anotacao__Usuarios. Sobe a API de verdade com um lote numa pasta temporária.
/// </summary>
public class AnotacaoApiTests : IClassFixture<AnotacaoApiTests.Factory>
{
    public class Factory : TasksApiFactory
    {
        public readonly string Dir = Path.Combine(Path.GetTempPath(), $"anotacao-api-{Guid.NewGuid():N}");

        public Factory()
        {
            Directory.CreateDirectory(Dir);
            File.WriteAllText(Path.Combine(Dir, "documents.jsonl"), "{\"row_id\": \"1\", \"original_text\": \"ANA PRADO\"}\n");
            File.WriteAllText(Path.Combine(Dir, "claude_proposals.jsonl"),
                "{\"row_id\": \"1\", \"entities\": [{\"entity_type\": \"PERSON\", \"extracted_text\": \"ANA PRADO\", \"span_start\": 0, \"span_end\": 9}], \"model\": \"claude\"}\n");
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("Anotacao:RunDir", Dir);
            builder.UseSetting("Anotacao:Usuarios", "dono@example.com, outra@example.com");
        }
    }

    private readonly Factory _factory;

    public AnotacaoApiTests(Factory factory) => _factory = factory;

    private async Task<HttpClient> LogadoComo(string email)
    {
        var client = _factory.CreateClient();
        var res = await client.PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString();
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    [Fact]
    public async Task Quem_nao_esta_na_lista_nao_ve_nenhum_relato()
    {
        var client = await LogadoComo($"intruso_{Guid.NewGuid():N}@example.com");

        var estado = await client.GetFromJsonAsync<JsonElement>("/api/anotacao/estado");
        Assert.False(estado.GetProperty("habilitado").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/anotacao/proximo")).StatusCode);
        var post = await client.PostAsJsonAsync("/api/anotacao/1/decisao", new { entidades = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.NotFound, post.StatusCode);
        Assert.False(File.Exists(Path.Combine(_factory.Dir, "manual_review.jsonl")));
    }

    [Fact]
    public async Task Quem_esta_na_lista_recebe_o_lote()
    {
        var client = await LogadoComo("OUTRA@example.com");

        var estado = await client.GetFromJsonAsync<JsonElement>("/api/anotacao/estado");
        Assert.True(estado.GetProperty("habilitado").GetBoolean());
        var doc = await client.GetFromJsonAsync<JsonElement>("/api/anotacao/proximo");
        Assert.Equal("1", doc.GetProperty("rowId").GetString());
    }

    [Fact]
    public async Task Sem_login_nada_responde()
    {
        var res = await _factory.CreateClient().GetAsync("/api/anotacao/estado");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }
}
