using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Hub.Plugin;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace Hub.Plugin.Sdk.Tests;

public class SdkTests : IAsyncLifetime
{
    private readonly ECDsaSecurityKey _nucleo = new(ECDsa.Create(ECCurve.NamedCurves.nistP256)) { KeyId = "k1" };
    private readonly string _pasta = Path.Combine(Path.GetTempPath(), "sdk-" + Guid.NewGuid().ToString("N"));
    private WebApplication _app = null!;
    private HttpClient _cliente = null!;

    private const string ManifestoJson = """
        { "id": "exemplo", "nome": "Exemplo", "icone": "grid", "contrato": 1, "rota": "/exemplo", "porta": 8080,
          "health": "/exemplo/api/health", "rotasLegadas": ["/api/exemplo"], "tabelas": { "prefixo": "exemplo_", "legadas": ["notas_velhas"] } }
        """;

    private sealed class JwksFalso(string json) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json) });
    }

    private string Jwks()
    {
        var p = _nucleo.ECDsa.ExportParameters(false);
        return JsonSerializer.Serialize(new
        {
            keys = new[] { new { kty = "EC", crv = "P-256", kid = "k1", use = "sig", alg = "ES256",
                x = Base64UrlEncoder.Encode(p.Q.X!), y = Base64UrlEncoder.Encode(p.Q.Y!) } },
        });
    }

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(_pasta);
        await File.WriteAllTextAsync(Path.Combine(_pasta, "plugin.json"), ManifestoJson);
        var b = WebApplication.CreateBuilder();
        b.AdicionarPlugin(Path.Combine(_pasta, "plugin.json"), o => o.Versao = "abc1234", new HttpClient(new JwksFalso(Jwks())));
        b.WebHost.UseTestServer();
        _app = b.Build();
        _app.UseAuthentication();
        _app.UseAuthorization();
        _app.MapHealthDoPlugin();
        _app.MapGet("/exemplo/api/eu", (HttpContext c) => c.UsuarioId()).RequireAuthorization();
        await _app.StartAsync();
        _cliente = _app.GetTestClient();
    }

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        try { Directory.Delete(_pasta, true); } catch (IOException) { }
    }

    private static string Token(SecurityKey chave, string alg, string aud, string kid = "k1") =>
        new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
            new JwtHeader(new SigningCredentials(chave, alg)) { ["kid"] = kid },
            new JwtPayload("notas-vps", aud, [new Claim("sub", "u-1"), new Claim("email", "a@b.c"), new Claim("jti", Guid.NewGuid().ToString("N"))], null, DateTime.UtcNow.AddMinutes(10))));

    private async Task<HttpStatusCode> Chamar(string? token)
    {
        using var r = new HttpRequestMessage(HttpMethod.Get, "/exemplo/api/eu");
        if (token is not null) r.Headers.Authorization = new("Bearer", token);
        return (await _cliente.SendAsync(r)).StatusCode;
    }

    [Fact]
    public async Task Health_responde_sem_login_com_a_versao()
    {
        var r = await _cliente.GetStringAsync("/exemplo/api/health");
        Assert.Contains("\"status\":\"ok\"", r);
        Assert.Contains("abc1234", r);
    }

    [Fact]
    public async Task Aceita_token_do_nucleo_com_a_audiencia_do_plugin_e_a_legada()
    {
        Assert.Equal(HttpStatusCode.OK, await Chamar(Token(_nucleo, SecurityAlgorithms.EcdsaSha256, "exemplo")));
        Assert.Equal(HttpStatusCode.OK, await Chamar(Token(_nucleo, SecurityAlgorithms.EcdsaSha256, "notas-vps")));
        Assert.Equal(HttpStatusCode.Unauthorized, await Chamar(null));
    }

    [Fact]
    public async Task Recusa_outra_audiencia_outra_chave_e_hs256()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, await Chamar(Token(_nucleo, SecurityAlgorithms.EcdsaSha256, "dieta")));
        var forjada = new ECDsaSecurityKey(ECDsa.Create(ECCurve.NamedCurves.nistP256)) { KeyId = "k1" };
        Assert.Equal(HttpStatusCode.Unauthorized, await Chamar(Token(forjada, SecurityAlgorithms.EcdsaSha256, "exemplo")));
        var hmac = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(new string('x', 64)));
        Assert.Equal(HttpStatusCode.Unauthorized, await Chamar(Token(hmac, SecurityAlgorithms.HmacSha256, "exemplo")));
    }

    [Fact]
    public async Task Jti_revogado_e_token_mcp_estatico()
    {
        var token = Token(_nucleo, SecurityAlgorithms.EcdsaSha256, "exemplo");
        var jti = new JwtSecurityTokenHandler().ReadJwtToken(token).Id;
        var mcp = "hub_token-estatico-de-teste";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(mcp))).ToLowerInvariant();
        Environment.SetEnvironmentVariable("HUB_SEGREDO_SERVICO", "segredo");
        var r = _app.Services.GetRequiredService<RevogacoesDoNucleo>();
        var falso = new RevogacoesDoNucleo(new OpcoesDoHub { Nucleo = "http://nucleo" },
            new HttpClient(new JwksFalso($$"""{"jtis":["{{jti}}"],"mcp":[{"hash":"{{hash}}","usuario":"u-9","email":"m@x.y"}]}""")));
        await falso.Atualizar(default);
        Assert.True(falso.Revogado(jti));
        Assert.Equal(("u-9", "m@x.y"), falso.DonoDoTokenMcp(mcp));
        Assert.Null(falso.DonoDoTokenMcp("hub_outro"));

        // No app: o mesmo estado passa pela instância registrada.
        Assert.Equal(HttpStatusCode.OK, await Chamar(token));
        Assert.Equal(HttpStatusCode.Unauthorized, await Chamar(mcp));
        Assert.NotNull(r);
    }

    [Fact]
    public void Sem_audiencia_legada_so_aceita_a_do_plugin()
    {
        var o = new OpcoesDoHub { Id = "exemplo", AceitarAudienciaLegada = false };
        Assert.Equal(["exemplo"], HubPlugin.ParametrosDeValidacao(o, new JwksDoNucleo("http://x")).ValidAudiences);
    }

    [Fact]
    public void Manifesto_fora_do_contrato_nao_sobe()
    {
        var arq = Path.Combine(_pasta, "ruim.json");
        File.WriteAllText(arq, ManifestoJson.Replace("\"/api/exemplo\"", "\"/api\""));
        var e = Assert.Throws<InvalidOperationException>(() => WebApplication.CreateBuilder().AdicionarPlugin(arq));
        Assert.Contains("reservada", e.Message);
    }

    private sealed class Contexto(DbContextOptions<Contexto> o) : DbContext(o)
    {
        protected override void OnModelCreating(ModelBuilder b)
        {
            b.ReferenciarUsuarios();
            b.Entity<Item>().ToTable("exemplo_itens");
            b.Entity<Velha>().ToTable("notas_velhas");
            b.Entity<Intrusa>().ToTable("financas_transacoes");
        }
    }

    private record Item(int Id, string UsuarioId);
    private record Velha(int Id);
    private record Intrusa(int Id);

    [Fact]
    public void Banco_do_hub_usa_historico_proprio_e_aponta_tabelas_alheias()
    {
        var banco = Path.Combine(_pasta, "notas.db");
        var o = new DbContextOptionsBuilder<Contexto>().UsarBancoDoHub(new OpcoesDoHub { Id = "exemplo", Banco = banco });
        using var db = new Contexto((DbContextOptions<Contexto>)o.Options);
        var m = Manifesto.Ler(Path.Combine(_pasta, "plugin.json"));
        Assert.Equal(["financas_transacoes"], Dados.TabelasForaDoDono(db.Model, m));

        var historico = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IHistoryRepository>();
        Assert.Contains("__EFMigrationsHistory_exemplo", historico.GetCreateIfNotExistsScript());

        db.Database.OpenConnection();
        using var cmd = db.Database.GetDbConnection().CreateCommand();
        cmd.CommandText = "PRAGMA busy_timeout";
        Assert.Equal(5000L, cmd.ExecuteScalar());
        db.Database.CloseConnection();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
    }

    [Fact]
    public void Segredo_de_um_plugin_nao_abre_no_outro()
    {
        var a = new Segredos(new string('a', 32));
        var b = new Segredos(new string('b', 32));
        var c = a.Cifrar("sk-chave-do-usuario");
        Assert.StartsWith("v1:", c);
        Assert.Equal("sk-chave-do-usuario", a.Decifrar(c));
        Assert.Null(b.Decifrar(c));
        Assert.Null(a.Decifrar("v1:lixo"));
        Assert.NotEqual(c, a.Cifrar("sk-chave-do-usuario"));
        Assert.Throws<InvalidOperationException>(() => new Segredos("curta"));
    }
}
