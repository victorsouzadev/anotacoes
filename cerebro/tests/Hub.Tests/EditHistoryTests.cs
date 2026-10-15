using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Hub.Tests;

/// <summary>Edição pela tela com histórico git real: conflito, log e restauração.</summary>
public sealed class EditHistoryTests : IClassFixture<EditHistoryTests.Factory>
{
    private const string Secret = "segredo-de-teste-com-pelo-menos-32-bytes!!";
    private readonly Factory _factory;

    public EditHistoryTests(Factory factory) => _factory = factory;

    public sealed class Factory : WebApplicationFactory<Program>
    {
        public readonly string Root = Path.Combine(Path.GetTempPath(), "cerebro-edit-" + Guid.NewGuid().ToString("N"));

        protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
        {
            builder.UseSetting("Hub:VaultPath", Path.Combine(Root, "vault"));
            builder.UseSetting("Hub:DataPath", Path.Combine(Root, "hub"));
            builder.UseSetting("Hub:GitEnabled", "true");
            builder.UseSetting("Hub:GitDebounceSeconds", "1");
            builder.UseSetting("Hub:Web:JwtSecret", Secret);
            builder.UseSetting("Hub:Web:Usuarios", "dono@exemplo.com");
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            try { Directory.Delete(Root, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    private HttpClient Client()
    {
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = "notas-vps",
            Audience = "notas-vps",
            Subject = new ClaimsIdentity([new Claim("sub", "1"), new Claim("email", "dono@exemplo.com")]),
            Expires = DateTime.UtcNow.AddMinutes(15),
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Secret)), SecurityAlgorithms.HmacSha256),
        });
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    private static async Task<JsonElement> Json(HttpResponseMessage r)
    {
        Assert.True(r.IsSuccessStatusCode, $"{(int)r.StatusCode}: {await r.Content.ReadAsStringAsync()}");
        return await r.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<JsonElement> WaitHistory(HttpClient c, string path, int min)
    {
        JsonElement h = default;
        for (var i = 0; i < 100; i++)
        {
            h = await c.GetFromJsonAsync<JsonElement>("/api/v1/web/historico?path=" + Uri.EscapeDataString(path));
            if (h.GetProperty("versoes").GetArrayLength() >= min) return h;
            await Task.Delay(100);
        }
        return h;
    }

    [Fact]
    public async Task Criar_editar_conflito_historico_e_restaurar()
    {
        var c = Client();

        var criada = await Json(await c.PostAsJsonAsync("/api/v1/web/notas", new { pasta = "10-Projetos", titulo = "Plano: viagem", conteudo = "versão um" }));
        var path = criada.GetProperty("path").GetString()!;
        Assert.Equal("10-Projetos/Plano viagem.md", path);
        var v1 = criada.GetProperty("versao").GetString()!;
        await WaitHistory(c, path, 1);

        // Edita com a versão certa.
        var salva = await Json(await c.PutAsJsonAsync("/api/v1/web/nota", new { path, conteudo = "# Plano: viagem\n\nversão dois\n", versao = v1 }));
        var v2 = salva.GetProperty("versao").GetString()!;
        Assert.NotEqual(v1, v2);

        // Salvar de novo com a versão velha: conflito, sem perder a edição.
        var conflito = await c.PutAsJsonAsync("/api/v1/web/nota", new { path, conteudo = "atropelaria", versao = v1 });
        Assert.Equal(HttpStatusCode.Conflict, conflito.StatusCode);
        Assert.Contains("versão dois", (await Json(await c.GetAsync("/api/v1/web/nota?path=" + Uri.EscapeDataString(path)))).GetProperty("raw").GetString());

        // O log mostra as duas versões, com quem mudou.
        var historico = await WaitHistory(c, path, 2);
        var versoes = historico.GetProperty("versoes").EnumerateArray().ToList();
        Assert.True(versoes.Count >= 2);
        Assert.Equal("tela", versoes[0].GetProperty("origem").GetString());
        var primeira = versoes[^1].GetProperty("versao").GetString()!;

        var antiga = await Json(await c.GetAsync($"/api/v1/web/historico/versao?versao={primeira}&path={Uri.EscapeDataString(path)}"));
        Assert.Contains("versão um", antiga.GetProperty("conteudo").GetString());

        // Restaura a nota para a primeira versão.
        await Json(await c.PostAsJsonAsync("/api/v1/web/historico/restaurar-nota", new { versao = primeira, path }));
        var agora = await Json(await c.GetAsync("/api/v1/web/nota?path=" + Uri.EscapeDataString(path)));
        Assert.Contains("versão um", agora.GetProperty("raw").GetString());

        // Ponto de restauração do Cérebro inteiro: só esta nota existe.
        var ponto = (await WaitHistory(c, path, 1)).GetProperty("versoes")[0].GetProperty("versao").GetString()!;

        // Cria outra nota e exclui a primeira (vai para a lixeira).
        var outra = (await Json(await c.PostAsJsonAsync("/api/v1/web/notas", new { pasta = "30-Recursos", titulo = "Depois do ponto" }))).GetProperty("path").GetString()!;
        var lixo = (await Json(await c.PostAsJsonAsync("/api/v1/web/nota/excluir", new { path }))).GetProperty("path").GetString()!;
        Assert.StartsWith("_sistema/lixeira/", lixo);
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync("/api/v1/web/nota?path=" + Uri.EscapeDataString(path))).StatusCode);
        await WaitHistory(c, outra, 1);

        // Volta o Cérebro para o ponto: a excluída volta, a criada depois vai para a lixeira.
        var rel = await Json(await c.PostAsJsonAsync("/api/v1/web/historico/restaurar-cerebro", new { versao = ponto }));
        Assert.True(rel.GetProperty("restored").GetInt32() >= 1);
        Assert.True(rel.GetProperty("trashed").GetInt32() >= 1);
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/v1/web/nota?path=" + Uri.EscapeDataString(path))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync("/api/v1/web/nota?path=" + Uri.EscapeDataString(outra))).StatusCode);
    }

    [Fact]
    public async Task Mover_renomear_e_limites()
    {
        var c = Client();
        var path = (await Json(await c.PostAsJsonAsync("/api/v1/web/notas", new { pasta = "00-Inbox", titulo = "Rascunho" }))).GetProperty("path").GetString()!;
        var movida = (await Json(await c.PostAsJsonAsync("/api/v1/web/nota/mover", new { path, pasta = "20-Areas", nome = "Saúde" }))).GetProperty("path").GetString();
        Assert.Equal("20-Areas/Saúde.md", movida);

        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/v1/web/notas", new { pasta = "../fora", titulo = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/v1/web/notas", new { pasta = "_sistema/anexos", titulo = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/v1/web/nota/mover", new { path = movida, pasta = ".obsidian" })).StatusCode);
    }
}
