using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api.Data;
using Notas.Api.Services.Auth;
using Notas.Api.Services.Plugins;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>Spec 030, fase 5: OAuth do núcleo para os MCPs dos plug-ins (portado dos testes da 028).</summary>
public class OAuthNucleoTests : IClassFixture<TasksApiFactory>
{
    private const string Redirect = "https://claude.ai/api/mcp/auth_callback";
    private const string SegredoServico = "segredo-de-servico-do-plugin-exemplo-0123456789";
    private readonly TasksApiFactory _factory;
    public OAuthNucleoTests(TasksApiFactory factory) => _factory = factory;

    private static string Hash(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s))).ToLowerInvariant();

    private async Task GarantirPlugin()
    {
        using var s = _factory.Services.CreateScope();
        var db = s.ServiceProvider.GetRequiredService<AppDbContext>();
        if (db.PluginsEstado.Any(p => p.Id == "exemplo")) return;
        db.PluginsEstado.Add(new PluginEstado
        {
            Id = "exemplo", Versao = "v1", Manifesto = """{"id":"exemplo","nome":"Exemplo","icone":"grid","rota":"/exemplo","porta":8080,"health":"/exemplo/api/health"}""",
            SegredoServicoHash = Hash(SegredoServico),
        });
        await db.SaveChangesAsync();
    }

    private async Task<HttpClient> Logado()
    {
        var c = _factory.CreateClient(new() { AllowAutoRedirect = false });
        var r = await c.PostAsJsonAsync("/api/auth/register", new { email = $"oa_{Guid.NewGuid():N}@example.com", password = "Sup3rSecret!" });
        c.DefaultRequestHeaders.Authorization = new("Bearer", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString());
        return c;
    }

    private static (string verifier, string challenge) Pkce()
    {
        var v = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var ch = Convert.ToBase64String(SHA256.HashData(Encoding.ASCII.GetBytes(v))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return (v, ch);
    }

    private async Task<string> RegistrarCliente(HttpClient c)
    {
        var r = await c.PostAsJsonAsync("/api/core/oauth/register", new { client_name = "Claude", redirect_uris = new[] { Redirect } });
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("client_id").GetString()!;
    }

    /// <summary>Fluxo completo: autorizar → consentir → trocar o código. Devolve o corpo do /token.</summary>
    private async Task<(JsonElement tokens, string cliente, HttpClient c)> Autorizar()
    {
        await GarantirPlugin();
        var c = await Logado();
        var cliente = await RegistrarCliente(c);
        var (v, ch) = Pkce();
        var auth = await c.GetAsync($"/api/core/oauth/authorize?response_type=code&client_id={cliente}&redirect_uri={Uri.EscapeDataString(Redirect)}" +
            $"&code_challenge={ch}&code_challenge_method=S256&state=xyz&resource={Uri.EscapeDataString("http://localhost/exemplo/mcp")}");
        Assert.Equal(HttpStatusCode.Redirect, auth.StatusCode);
        var pedido = auth.Headers.Location!.Query.Split("pedido=")[1];
        Assert.Contains("/autorizar?pedido=", auth.Headers.Location!.ToString());

        var info = await c.GetFromJsonAsync<JsonElement>($"/api/core/oauth/pedido/{pedido}");
        Assert.Equal("exemplo", info.GetProperty("plugin").GetString());

        var cons = await (await c.PostAsJsonAsync("/api/core/oauth/consentir", new { pedido = Uri.UnescapeDataString(pedido), aprovar = true }))
            .Content.ReadFromJsonAsync<JsonElement>();
        var redirect = new Uri(cons.GetProperty("redirect").GetString()!);
        Assert.Contains("state=xyz", redirect.Query);
        var codigo = Uri.UnescapeDataString(redirect.Query.Split("code=")[1].Split('&')[0]);

        var tk = await c.PostAsync("/api/core/oauth/token", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code", ["code"] = codigo, ["client_id"] = cliente, ["redirect_uri"] = Redirect, ["code_verifier"] = v,
        }));
        Assert.Equal(HttpStatusCode.OK, tk.StatusCode);
        return (await tk.Content.ReadFromJsonAsync<JsonElement>(), cliente, c);
    }

    private async Task<JsonElement> Revogados()
    {
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new("Bearer", SegredoServico);
        return await c.GetFromJsonAsync<JsonElement>("/api/core/revogados");
    }

    private static Task<HttpResponseMessage> Refresh(HttpClient c, string refresh, string cliente) =>
        c.PostAsync("/api/core/oauth/token", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token", ["refresh_token"] = refresh, ["client_id"] = cliente,
        }));

    [Fact]
    public async Task Metadata_do_servidor_e_do_recurso_do_plugin()
    {
        await GarantirPlugin();
        var c = _factory.CreateClient();
        var s = await c.GetFromJsonAsync<JsonElement>("/.well-known/oauth-authorization-server");
        Assert.EndsWith("/api/core/oauth/token", s.GetProperty("token_endpoint").GetString());
        var r = await c.GetFromJsonAsync<JsonElement>("/.well-known/oauth-protected-resource/exemplo/mcp");
        Assert.EndsWith("/exemplo/mcp", r.GetProperty("resource").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync("/.well-known/oauth-protected-resource/nao-existe/mcp")).StatusCode);
    }

    [Fact]
    public async Task Acesso_e_jwt_com_a_audiencia_do_plugin()
    {
        var (t, _, _) = await Autorizar();
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(t.GetProperty("access_token").GetString());
        Assert.Equal(["exemplo"], jwt.Audiences);
        Assert.Equal("ES256", jwt.Header.Alg);
        Assert.Equal(900, t.GetProperty("expires_in").GetInt32());
    }

    [Fact]
    public async Task Recurso_de_plugin_desconhecido_e_recusado()
    {
        var c = await Logado();
        var cliente = await RegistrarCliente(c);
        var (_, ch) = Pkce();
        var r = await c.GetAsync($"/api/core/oauth/authorize?response_type=code&client_id={cliente}&redirect_uri={Uri.EscapeDataString(Redirect)}" +
            $"&code_challenge={ch}&code_challenge_method=S256&resource={Uri.EscapeDataString("http://localhost/financas/mcp")}");
        Assert.Contains("error=invalid_target", r.Headers.Location!.ToString());
    }

    [Fact]
    public async Task Refresh_gira_e_reuso_derruba_a_familia_e_publica_o_jti()
    {
        var (t, cliente, c) = await Autorizar();
        var r1 = t.GetProperty("refresh_token").GetString()!;
        var novo = await Refresh(c, r1, cliente);
        Assert.Equal(HttpStatusCode.OK, novo.StatusCode);
        var t2 = await novo.Content.ReadFromJsonAsync<JsonElement>();
        var jti2 = new JwtSecurityTokenHandler().ReadJwtToken(t2.GetProperty("access_token").GetString()).Id;

        Assert.Equal(HttpStatusCode.BadRequest, (await Refresh(c, r1, cliente)).StatusCode); // reuso
        Assert.Equal(HttpStatusCode.BadRequest, (await Refresh(c, t2.GetProperty("refresh_token").GetString()!, cliente)).StatusCode);
        Assert.Contains(jti2, (await Revogados()).GetProperty("jtis").EnumerateArray().Select(j => j.GetString()));
    }

    [Fact]
    public async Task Revogar_aplicativo_na_tela_publica_o_jti_em_ate_60s()
    {
        var (t, cliente, c) = await Autorizar();
        var lista = await c.GetFromJsonAsync<JsonElement>("/api/core/oauth/clientes");
        Assert.Contains(lista.EnumerateArray(), x => x.GetProperty("id").GetString() == cliente && x.GetProperty("plugin").GetString() == "exemplo");
        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/core/oauth/clientes/{cliente}")).StatusCode);
        var jti = new JwtSecurityTokenHandler().ReadJwtToken(t.GetProperty("access_token").GetString()).Id;
        Assert.Contains(jti, (await Revogados()).GetProperty("jtis").EnumerateArray().Select(j => j.GetString()));
        Assert.Equal(HttpStatusCode.BadRequest, (await Refresh(c, t.GetProperty("refresh_token").GetString()!, cliente)).StatusCode);
    }

    [Fact]
    public async Task Codigo_usado_duas_vezes_e_recusado()
    {
        await GarantirPlugin();
        var c = await Logado();
        var cliente = await RegistrarCliente(c);
        var (v, ch) = Pkce();
        var auth = await c.GetAsync($"/api/core/oauth/authorize?response_type=code&client_id={cliente}&redirect_uri={Uri.EscapeDataString(Redirect)}" +
            $"&code_challenge={ch}&code_challenge_method=S256&resource={Uri.EscapeDataString("http://localhost/exemplo/mcp")}");
        var pedido = Uri.UnescapeDataString(auth.Headers.Location!.Query.Split("pedido=")[1]);
        var cons = await (await c.PostAsJsonAsync("/api/core/oauth/consentir", new { pedido, aprovar = true })).Content.ReadFromJsonAsync<JsonElement>();
        var codigo = Uri.UnescapeDataString(new Uri(cons.GetProperty("redirect").GetString()!).Query.Split("code=")[1].Split('&')[0]);
        var form = new Dictionary<string, string> { ["grant_type"] = "authorization_code", ["code"] = codigo, ["client_id"] = cliente, ["redirect_uri"] = Redirect, ["code_verifier"] = v };
        Assert.Equal(HttpStatusCode.OK, (await c.PostAsync("/api/core/oauth/token", new FormUrlEncodedContent(form))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsync("/api/core/oauth/token", new FormUrlEncodedContent(form))).StatusCode);
        // PKCE errado também não passa
        Assert.Equal(HttpStatusCode.NotFound, (await c.PostAsJsonAsync("/api/core/oauth/consentir", new { pedido, aprovar = true })).StatusCode);
    }

    [Fact]
    public async Task Consentir_exige_login_do_hub() =>
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await _factory.CreateClient().PostAsJsonAsync("/api/core/oauth/consentir", new { pedido = "x", aprovar = true })).StatusCode);

    [Fact]
    public async Task Token_mcp_estatico_aparece_uma_vez_e_vai_para_o_plugin_em_hash()
    {
        await GarantirPlugin();
        var c = await Logado();
        var r = await (await c.PostAsJsonAsync("/api/core/mcp-tokens", new { plugin = "exemplo" })).Content.ReadFromJsonAsync<JsonElement>();
        var token = r.GetProperty("token").GetString()!;
        Assert.StartsWith("hub_", token);
        var lista = await c.GetStringAsync("/api/core/mcp-tokens");
        Assert.DoesNotContain(token, lista);
        var rev = await Revogados();
        Assert.Contains(rev.GetProperty("mcp").EnumerateArray(), m => m.GetProperty("hash").GetString() == OAuthDoNucleo.Hash(token));

        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/core/mcp-tokens/{r.GetProperty("id").GetString()}")).StatusCode);
        Assert.DoesNotContain((await Revogados()).GetProperty("mcp").EnumerateArray(), m => m.GetProperty("hash").GetString() == OAuthDoNucleo.Hash(token));
    }

    [Fact]
    public async Task Revogados_exige_o_segredo_de_servico_do_plugin()
    {
        await GarantirPlugin();
        var c = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/core/revogados")).StatusCode);
        c.DefaultRequestHeaders.Authorization = new("Bearer", "outro-segredo-qualquer-com-tamanho-suficiente-xx");
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/core/revogados")).StatusCode);
    }

    [Fact]
    public async Task Token_mcp_inserido_direto_no_banco_nao_vale()
    {
        await GarantirPlugin();
        using (var s = _factory.Services.CreateScope())
        {
            var db = s.ServiceProvider.GetRequiredService<AppDbContext>();
            using var con = new Microsoft.Data.Sqlite.SqliteConnection(db.Database.GetDbConnectionString());
            con.Open();
            using var cmd = con.CreateCommand();
            cmd.CommandText = "INSERT INTO core_mcp_tokens (Id, Plugin, Hash, UsuarioId, Email, CriadoEm) VALUES ('f1', 'exemplo', 'abc', 'u', 'e', '2026-01-01')";
            cmd.ExecuteNonQuery();
        }
        Assert.DoesNotContain((await Revogados()).GetProperty("mcp").EnumerateArray(), m => m.GetProperty("hash").GetString() == "abc");
    }
}

file static class DbExt
{
    public static string GetDbConnectionString(this Microsoft.EntityFrameworkCore.Infrastructure.DatabaseFacade d) =>
        Microsoft.EntityFrameworkCore.RelationalDatabaseFacadeExtensions.GetConnectionString(d)!;
}
