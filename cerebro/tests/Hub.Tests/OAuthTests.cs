using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Hub.Api;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Hub.Tests;

/// <summary>OAuth 2.1 do MCP do Cérebro (spec 028): o fluxo inteiro, como o Claude web faz.</summary>
public sealed class OAuthTests : IClassFixture<OAuthTests.Factory>
{
    private const string Secret = "segredo-de-teste-oauth-com-pelo-menos-32-bytes!!";
    private const string Callback = "https://claude.ai/api/mcp/auth_callback";
    private readonly Factory _factory;

    public OAuthTests(Factory factory) => _factory = factory;

    public sealed class Factory : WebApplicationFactory<Program>
    {
        public readonly string Root = Path.Combine(Path.GetTempPath(), "cerebro-oauth-" + Guid.NewGuid().ToString("N"));

        protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
        {
            builder.UseSetting("Hub:VaultPath", Path.Combine(Root, "vault"));
            builder.UseSetting("Hub:DataPath", Path.Combine(Root, "hub"));
            builder.UseSetting("Hub:GitEnabled", "false");
            builder.UseSetting("Hub:McpToken", "token-estatico-do-mcp");
            builder.UseSetting("Hub:Web:JwtSecret", Secret);
            builder.UseSetting("Hub:Web:Usuarios", "dono@exemplo.com");
            builder.UseSetting("Hub:RateLimitPerMinute", "1000");
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            try { Directory.Delete(Root, true); } catch (IOException) { }
        }
    }

    private static string Jwt(string email) =>
        new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = "notas-vps",
            Audience = "notas-vps",
            Subject = new ClaimsIdentity([new Claim("sub", "1"), new Claim("email", email)]),
            Expires = DateTime.UtcNow.AddMinutes(15),
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Secret)), SecurityAlgorithms.HmacSha256),
        });

    private HttpClient Cliente(string? bearer = null)
    {
        var c = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        if (bearer is not null) c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        return c;
    }

    private static (string Verifier, string Challenge) Pkce()
    {
        var verifier = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var challenge = Convert.ToBase64String(SHA256.HashData(Encoding.ASCII.GetBytes(verifier))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return (verifier, challenge);
    }

    private static Dictionary<string, string> Query(string url) =>
        new Uri(url).Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(p => p.Split('=', 2)).ToDictionary(p => p[0], p => Uri.UnescapeDataString(p[1]));

    private async Task<string> Registrar()
    {
        var r = await Cliente().PostAsJsonAsync("/oauth/register", new { client_name = "Claude", redirect_uris = new[] { Callback } });
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("client_id").GetString()!;
    }

    /// <summary>Vai até o código: authorize → página /autorizar (dono aprova) → redirect com code.</summary>
    private async Task<(string ClientId, string Code, string Verifier)> AteOCodigo(bool aprovar = true, string email = "dono@exemplo.com")
    {
        var clientId = await Registrar();
        var (verifier, challenge) = Pkce();
        var auth = await Cliente().GetAsync($"/oauth/authorize?response_type=code&client_id={clientId}&redirect_uri={Uri.EscapeDataString(Callback)}" +
            $"&code_challenge={challenge}&code_challenge_method=S256&state=xyz&scope=cerebro");
        Assert.Equal(HttpStatusCode.Redirect, auth.StatusCode);
        var pedido = Query(auth.Headers.Location!.ToString())["pedido"];
        Assert.Contains("/autorizar?pedido=", auth.Headers.Location!.ToString());

        var tela = Cliente(Jwt(email));
        var info = await tela.GetFromJsonAsync<JsonElement>($"/api/v1/web/oauth/pedido/{pedido}");
        Assert.Equal("Claude", info.GetProperty("cliente").GetString());
        var r = await tela.PostAsJsonAsync("/api/v1/web/oauth/consentir", new { pedido, aprovar });
        var redirect = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("redirect").GetString()!;
        Assert.StartsWith(Callback, redirect);
        var q = Query(redirect);
        Assert.Equal("xyz", q["state"]);
        return (clientId, q.GetValueOrDefault("code") ?? q["error"], verifier);
    }

    private Task<HttpResponseMessage> Token(params (string, string)[] campos) =>
        Cliente().PostAsync("/oauth/token", new FormUrlEncodedContent(campos.Select(c => new KeyValuePair<string, string>(c.Item1, c.Item2))));

    private static async Task<(string Acesso, string Atualizacao)> Ler(HttpResponseMessage r)
    {
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var j = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Bearer", j.GetProperty("token_type").GetString());
        return (j.GetProperty("access_token").GetString()!, j.GetProperty("refresh_token").GetString()!);
    }

    private Task<HttpResponseMessage> Mcp(string? bearer, string query = "")
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/mcp" + query)
        {
            Content = new StringContent("""{"jsonrpc":"2.0","id":1,"method":"tools/list"}""", Encoding.UTF8, "application/json"),
        };
        req.Headers.Accept.ParseAdd("application/json");
        req.Headers.Accept.ParseAdd("text/event-stream");
        if (bearer is not null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        return Cliente().SendAsync(req);
    }

    [Fact]
    public async Task Sem_credencial_401_aponta_o_metadata_e_o_metadata_descreve_o_servidor()
    {
        var r = await Mcp(null);
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
        Assert.Contains("resource_metadata=\"http://localhost/.well-known/oauth-protected-resource/cerebro/mcp\"", r.Headers.WwwAuthenticate.ToString());

        var recurso = await Cliente().GetFromJsonAsync<JsonElement>("/.well-known/oauth-protected-resource/cerebro/mcp");
        Assert.Equal("http://localhost/cerebro/mcp", recurso.GetProperty("resource").GetString());
        var servidor = await Cliente().GetFromJsonAsync<JsonElement>("/.well-known/oauth-authorization-server/cerebro");
        Assert.Equal("http://localhost/cerebro/oauth/token", servidor.GetProperty("token_endpoint").GetString());
        Assert.Equal("S256", servidor.GetProperty("code_challenge_methods_supported")[0].GetString());
    }

    [Fact]
    public async Task Fluxo_completo_da_acesso_ao_mcp_e_codigo_vale_uma_vez()
    {
        var (clientId, code, verifier) = await AteOCodigo();
        var (acesso, _) = await Ler(await Token(("grant_type", "authorization_code"), ("code", code), ("client_id", clientId),
            ("redirect_uri", Callback), ("code_verifier", verifier)));

        Assert.Equal(HttpStatusCode.OK, (await Mcp(acesso)).StatusCode);

        // O mesmo código de novo: recusado, e o que ele gerou é revogado (alguém o interceptou).
        var reuso = await Token(("grant_type", "authorization_code"), ("code", code), ("client_id", clientId),
            ("redirect_uri", Callback), ("code_verifier", verifier));
        Assert.Equal(HttpStatusCode.BadRequest, reuso.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Mcp(acesso)).StatusCode);
    }

    [Fact]
    public async Task Verifier_ou_redirect_errados_nao_trocam_o_codigo()
    {
        var (clientId, code, _) = await AteOCodigo();
        var errado = await Token(("grant_type", "authorization_code"), ("code", code), ("client_id", clientId),
            ("redirect_uri", Callback), ("code_verifier", Pkce().Verifier));
        Assert.Equal(HttpStatusCode.BadRequest, errado.StatusCode);

        var (c2, code2, v2) = await AteOCodigo();
        var outroRedirect = await Token(("grant_type", "authorization_code"), ("code", code2), ("client_id", c2),
            ("redirect_uri", "https://evil.example/cb"), ("code_verifier", v2));
        Assert.Equal(HttpStatusCode.BadRequest, outroRedirect.StatusCode);
    }

    [Fact]
    public async Task Atualizacao_gira_e_reuso_revoga_a_familia()
    {
        var (clientId, code, verifier) = await AteOCodigo();
        var (_, r1) = await Ler(await Token(("grant_type", "authorization_code"), ("code", code), ("client_id", clientId),
            ("redirect_uri", Callback), ("code_verifier", verifier)));
        var (a2, r2) = await Ler(await Token(("grant_type", "refresh_token"), ("refresh_token", r1), ("client_id", clientId)));
        Assert.Equal(HttpStatusCode.OK, (await Mcp(a2)).StatusCode);

        var reuso = await Token(("grant_type", "refresh_token"), ("refresh_token", r1), ("client_id", clientId));
        Assert.Equal(HttpStatusCode.BadRequest, reuso.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Mcp(a2)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Token(("grant_type", "refresh_token"), ("refresh_token", r2), ("client_id", clientId))).StatusCode);
    }

    [Fact]
    public async Task Recusar_devolve_access_denied_e_revogar_corta_na_hora()
    {
        var (_, erro, _) = await AteOCodigo(aprovar: false);
        Assert.Equal("access_denied", erro);

        var (clientId, code, verifier) = await AteOCodigo();
        var (acesso, _) = await Ler(await Token(("grant_type", "authorization_code"), ("code", code), ("client_id", clientId),
            ("redirect_uri", Callback), ("code_verifier", verifier)));
        var tela = Cliente(Jwt("dono@exemplo.com"));
        var lista = await tela.GetFromJsonAsync<JsonElement>("/api/v1/web/oauth/clientes");
        Assert.Contains(lista.EnumerateArray(), c => c.GetProperty("id").GetString() == clientId);
        Assert.Equal(HttpStatusCode.NoContent, (await tela.DeleteAsync($"/api/v1/web/oauth/clientes/{clientId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Mcp(acesso)).StatusCode);
    }

    [Fact]
    public async Task Fora_da_lista_nao_consente_cliente_desconhecido_nao_redireciona_e_token_estatico_segue()
    {
        var clientId = await Registrar();
        var (_, challenge) = Pkce();
        var auth = await Cliente().GetAsync($"/oauth/authorize?response_type=code&client_id={clientId}&redirect_uri={Uri.EscapeDataString(Callback)}" +
            $"&code_challenge={challenge}&code_challenge_method=S256&state=s");
        var pedido = Query(auth.Headers.Location!.ToString())["pedido"];
        var intruso = await Cliente(Jwt("intruso@exemplo.com")).PostAsJsonAsync("/api/v1/web/oauth/consentir", new { pedido, aprovar = true });
        Assert.Equal(HttpStatusCode.Forbidden, intruso.StatusCode);

        var desconhecido = await Cliente().GetAsync($"/oauth/authorize?response_type=code&client_id=inventado&redirect_uri={Uri.EscapeDataString("https://evil.example/cb")}&code_challenge={challenge}&code_challenge_method=S256");
        Assert.Equal(HttpStatusCode.BadRequest, desconhecido.StatusCode);

        var semPkce = await Cliente().GetAsync($"/oauth/authorize?response_type=code&client_id={clientId}&redirect_uri={Uri.EscapeDataString(Callback)}&state=s");
        Assert.Contains("error=invalid_request", semPkce.Headers.Location!.ToString());

        var registroRuim = await Cliente().PostAsJsonAsync("/oauth/register", new { client_name = "x", redirect_uris = new[] { "http://evil.example/cb" } });
        Assert.Equal(HttpStatusCode.BadRequest, registroRuim.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await Mcp("token-estatico-do-mcp")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Mcp(null, "?key=token-estatico-do-mcp")).StatusCode);
    }

    [Fact]
    public void Pkce_s256() =>
        Assert.True(OAuthStore.PkceValido("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"));
}
