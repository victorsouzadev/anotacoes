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

/// <summary>Tela do Cérebro no hub: só o JWT do login único, e só do dono do vault.</summary>
public sealed class WebAuthTests : IClassFixture<WebAuthTests.Factory>
{
    private const string Secret = "segredo-de-teste-com-pelo-menos-32-bytes!!";
    private readonly Factory _factory;

    public WebAuthTests(Factory factory) => _factory = factory;

    public sealed class Factory : WebApplicationFactory<Program>
    {
        public readonly string Root = Path.Combine(Path.GetTempPath(), "cerebro-web-" + Guid.NewGuid().ToString("N"));

        protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
        {
            builder.UseSetting("Hub:VaultPath", Path.Combine(Root, "vault"));
            builder.UseSetting("Hub:DataPath", Path.Combine(Root, "hub"));
            builder.UseSetting("Hub:GitEnabled", "false");
            builder.UseSetting("Hub:McpToken", "mcp");
            builder.UseSetting("Hub:Web:JwtSecret", Secret);
            builder.UseSetting("Hub:Web:Usuarios", "dono@exemplo.com, outra@exemplo.com");
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            try { Directory.Delete(Root, true); } catch (IOException) { }
        }
    }

    private static string Token(string email, string secret = Secret, string issuer = "notas-vps", DateTime? expires = null) =>
        new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = "notas-vps",
            Subject = new ClaimsIdentity([new Claim("sub", "1"), new Claim("email", email)]),
            NotBefore = (expires ?? DateTime.UtcNow.AddMinutes(15)).AddMinutes(-30),
            Expires = expires ?? DateTime.UtcNow.AddMinutes(15),
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)), SecurityAlgorithms.HmacSha256),
        });

    private HttpClient Client(string? token)
    {
        var c = _factory.CreateClient();
        if (token is not null) c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    [Fact]
    public async Task Sem_token_401()
    {
        var r = await Client(null).GetAsync("/api/v1/web/me");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Theory]
    [InlineData("outro-segredo-com-pelo-menos-32-bytes-aqui!", "notas-vps")]
    [InlineData(Secret, "outro-emissor")]
    public async Task Token_de_outra_origem_401(string secret, string issuer)
    {
        var r = await Client(Token("dono@exemplo.com", secret, issuer)).GetAsync("/api/v1/web/me");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Token_expirado_401()
    {
        var r = await Client(Token("dono@exemplo.com", expires: DateTime.UtcNow.AddMinutes(-5))).GetAsync("/api/v1/web/me");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Usuario_do_hub_fora_da_lista_403()
    {
        var r = await Client(Token("intruso@exemplo.com")).GetAsync("/api/v1/web/inbox");
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Api_key_nao_abre_a_tela_web()
    {
        var c = Client(null);
        c.DefaultRequestHeaders.Add("X-Api-Key", "mcp");
        var r = await c.GetAsync("/api/v1/web/me");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Dono_captura_lista_e_rejeita()
    {
        var c = Client(Token("DONO@exemplo.com"));

        var me = await c.GetFromJsonAsync<JsonElement>("/api/v1/web/me");
        Assert.Equal("DONO@exemplo.com", me.GetProperty("email").GetString());

        var cap = await c.PostAsJsonAsync("/api/v1/web/captures", new { content = "Ideia vinda da tela web" });
        Assert.Equal(HttpStatusCode.OK, cap.StatusCode);
        var path = (await cap.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("path").GetString()!;
        Assert.StartsWith("00-Inbox/", path);

        var inbox = await c.GetFromJsonAsync<JsonElement>("/api/v1/web/inbox");
        Assert.Contains(inbox.EnumerateArray(), i => i.GetProperty("path").GetString() == path);

        var rej = await c.PostAsJsonAsync("/api/v1/web/inbox/reject", new { path });
        Assert.Equal(HttpStatusCode.OK, rej.StatusCode);

        inbox = await c.GetFromJsonAsync<JsonElement>("/api/v1/web/inbox");
        Assert.DoesNotContain(inbox.EnumerateArray(), i => i.GetProperty("path").GetString() == path);
    }

    [Fact]
    public async Task Aprovar_fora_da_inbox_400()
    {
        var c = Client(Token("dono@exemplo.com"));
        var r = await c.PostAsJsonAsync("/api/v1/web/inbox/approve", new { path = "../../etc/passwd", folder = "30-Recursos" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Link_que_nao_e_http_400()
    {
        var c = Client(Token("dono@exemplo.com"));
        var r = await c.PostAsJsonAsync("/api/v1/web/captures", new { url = "file:///etc/passwd" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Aprovada_aparece_nas_notas_e_nas_decisoes()
    {
        var c = Client(Token("dono@exemplo.com"));
        var cap = await c.PostAsJsonAsync("/api/v1/web/captures", new { content = "Revisar gastos fixos todo mês. Ver [[Inexistente]]." });
        var path = (await cap.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("path").GetString()!;
        var ok = await c.PostAsJsonAsync("/api/v1/web/inbox/approve", new { path, folder = "20-Areas" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var dest = (await ok.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("path").GetString()!;
        Assert.StartsWith("20-Areas/", dest);

        var decisoes = await c.GetFromJsonAsync<JsonElement>("/api/v1/web/decisoes");
        Assert.Contains(decisoes.EnumerateArray(), d => d.GetProperty("path").GetString() == dest && d.GetProperty("status").GetString() == "aprovada");

        // O índice é atualizado pelo watcher: espera a nota aparecer na pasta.
        JsonElement notas = default;
        for (var i = 0; i < 50; i++)
        {
            notas = await c.GetFromJsonAsync<JsonElement>("/api/v1/web/notas?pasta=20-Areas");
            if (notas.GetProperty("notas").EnumerateArray().Any(n => n.GetProperty("path").GetString() == dest)) break;
            await Task.Delay(100);
        }
        Assert.Contains(notas.GetProperty("notas").EnumerateArray(), n => n.GetProperty("path").GetString() == dest);
        Assert.Contains(notas.GetProperty("pastas").EnumerateArray(), p => p.GetProperty("pasta").GetString() == "20-Areas");

        var nota = await c.GetFromJsonAsync<JsonElement>("/api/v1/web/nota?path=" + Uri.EscapeDataString(dest));
        Assert.Contains("Revisar gastos fixos", nota.GetProperty("body").GetString());
        Assert.Equal(JsonValueKind.Null, nota.GetProperty("links").GetProperty("Inexistente").ValueKind);
    }

    [Fact]
    public async Task Ler_nota_fora_do_vault_400()
    {
        var c = Client(Token("dono@exemplo.com"));
        var r = await c.GetAsync("/api/v1/web/nota?path=" + Uri.EscapeDataString("../../etc/passwd.md"));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Client(null).GetAsync("/api/v1/web/notas")).StatusCode);
    }
}
