using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Notas.Api.Auth;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>Spec 030: ES256 com JWKS, janela do HS256 e selo das linhas de login.</summary>
public class LoginAssimetricoTests : IClassFixture<TasksApiFactory>
{
    private const string Segredo = "test-secret-key-for-integration-tests-only-0123456789";
    private readonly TasksApiFactory _factory;
    public LoginAssimetricoTests(TasksApiFactory factory) => _factory = factory;

    private static string PastaTemp() => Path.Combine(Path.GetTempPath(), "chaves-" + Guid.NewGuid().ToString("N"));

    private async Task<(HttpClient c, JsonElement corpo)> Registrar()
    {
        var c = _factory.CreateClient();
        var r = await c.PostAsJsonAsync("/api/auth/register", new { email = $"es_{Guid.NewGuid():N}@example.com", password = "Sup3rSecret!" });
        r.EnsureSuccessStatusCode();
        return (c, await r.Content.ReadFromJsonAsync<JsonElement>());
    }

    [Fact]
    public void Chaves_sao_geradas_uma_vez_e_recarregadas()
    {
        var pasta = PastaTemp();
        var a = new ChavesDeAssinatura(pasta);
        var b = new ChavesDeAssinatura(pasta);
        Assert.Equal(a.Atual.KeyId, b.Atual.KeyId);
        Assert.Equal(a.ChaveSelo, b.ChaveSelo);
        Assert.True(File.Exists(Path.Combine(pasta, "selo.key")));
    }

    [Fact]
    public void Rotacao_mantem_a_anterior_no_jwks()
    {
        var c = new ChavesDeAssinatura(PastaTemp());
        var antiga = c.Atual.KeyId;
        var nova = c.Rotacionar(DateTime.UtcNow.AddDays(1));
        Assert.Equal(nova, c.Atual.KeyId);
        Assert.Equal([antiga, nova], c.Validas.Select(k => k.KeyId));
        c.Rotacionar(DateTime.UtcNow.AddDays(2));
        Assert.DoesNotContain(antiga, c.Validas.Select(k => k.KeyId));
    }

    [Fact]
    public async Task Token_novo_e_es256_com_kid_do_jwks()
    {
        var (c, corpo) = await Registrar();
        var token = corpo.GetProperty("accessToken").GetString()!;
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);
        Assert.Equal("ES256", jwt.Header.Alg);
        Assert.False(string.IsNullOrEmpty(jwt.Id));

        var jwks = await c.GetFromJsonAsync<JsonElement>("/.well-known/jwks.json");
        var kids = jwks.GetProperty("keys").EnumerateArray().Select(k => k.GetProperty("kid").GetString()).ToList();
        Assert.Contains(jwt.Header.Kid, kids);
        Assert.All(jwks.GetProperty("keys").EnumerateArray(), k => Assert.False(k.TryGetProperty("d", out _)));

        // O plug-in valida só com o JWKS público.
        var publicas = new JsonWebKeySet(jwks.GetRawText()).GetSigningKeys();
        new JwtSecurityTokenHandler().ValidateToken(token, new TokenValidationParameters
        {
            ValidIssuer = "notas-vps", ValidAudience = "notas-vps", IssuerSigningKeys = publicas,
        }, out _);

        // E o hub continua aceitando o token novo.
        c.DefaultRequestHeaders.Authorization = new("Bearer", token);
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/configuracoes/ia")).StatusCode);
    }

    private static string Hs256(string sub, string email) => new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
        "notas-vps", "notas-vps", [new Claim("sub", sub), new Claim("email", email)], expires: DateTime.UtcNow.AddMinutes(10),
        signingCredentials: new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Segredo)), SecurityAlgorithms.HmacSha256)));

    [Fact]
    public void Hs256_vale_so_ate_o_limite()
    {
        var chaves = new ChavesDeAssinatura(PastaTemp());
        var agora = DateTime.UtcNow;
        var limite = agora.AddMinutes(15);
        var token = Hs256("u1", "a@b.c");
        var h = new JwtSecurityTokenHandler();

        h.ValidateToken(token, TokenService.ValidationParameters(Segredo, chaves, limite, () => agora), out _);
        Assert.ThrowsAny<SecurityTokenException>(() =>
            h.ValidateToken(token, TokenService.ValidationParameters(Segredo, chaves, limite, () => limite.AddSeconds(1)), out _));
    }

    [Fact]
    public void Token_de_chave_fora_do_jwks_e_recusado()
    {
        var nossa = new ChavesDeAssinatura(PastaTemp());
        var outra = new ChavesDeAssinatura(PastaTemp());
        var forjado = new TokenService(outra).CreateAccessToken("u1", "a@b.c");
        Assert.ThrowsAny<SecurityTokenException>(() => new JwtSecurityTokenHandler()
            .ValidateToken(forjado, TokenService.ValidationParameters(Segredo, nossa, DateTime.UtcNow.AddMinutes(15)), out _));
    }

    [Fact]
    public void Token_de_plugin_nao_entra_no_hub()
    {
        var chaves = new ChavesDeAssinatura(PastaTemp());
        var token = new TokenService(chaves).CreateAccessToken("u1", "a@b.c", "dieta");
        Assert.ThrowsAny<SecurityTokenException>(() => new JwtSecurityTokenHandler()
            .ValidateToken(token, TokenService.ValidationParameters(Segredo, chaves, DateTime.UtcNow.AddMinutes(15)), out _));
    }

    private void Sql(string sql, params (string, object?)[] p)
    {
        // Pela conexão do próprio contexto: vale no SQLite e no Postgres (spec 038).
        using var s = _factory.Services.CreateScope();
        var db = s.ServiceProvider.GetRequiredService<AppDbContext>();
        var con = db.Database.GetDbConnection();
        db.Database.OpenConnection();
        using var cmd = con.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in p)
        {
            var par = cmd.CreateParameter();
            par.ParameterName = n;
            par.Value = v ?? DBNull.Value;
            cmd.Parameters.Add(par);
        }
        cmd.ExecuteNonQuery();
        db.Database.CloseConnection();
    }

    [Fact]
    public async Task Usuario_inserido_direto_no_banco_nao_loga()
    {
        _ = await Registrar(); // garante o banco criado
        var email = $"forjado_{Guid.NewGuid():N}@example.com";
        Sql("INSERT INTO users (\"Id\", \"Email\", \"PasswordHash\", \"CreatedAt\") VALUES (@id, @e, @h, @d)",
            ("@id", Guid.NewGuid().ToString()), ("@e", email), ("@h", BCrypt.Net.BCrypt.HashPassword("Sup3rSecret!", 4)),
            ("@d", DateTime.UtcNow));
        var r = await _factory.CreateClient().PostAsJsonAsync("/api/auth/login", new { email, password = "Sup3rSecret!" });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Senha_trocada_direto_no_banco_nao_loga()
    {
        var (c, corpo) = await Registrar();
        var email = corpo.GetProperty("user").GetProperty("email").GetString();
        Assert.Equal(HttpStatusCode.OK, (await c.PostAsJsonAsync("/api/auth/login", new { email, password = "Sup3rSecret!" })).StatusCode);
        Sql("UPDATE users SET \"PasswordHash\" = @h WHERE \"Email\" = @e", ("@h", BCrypt.Net.BCrypt.HashPassword("Outra123!", 4)), ("@e", email));
        var r = await c.PostAsJsonAsync("/api/auth/login", new { email, password = "Outra123!" });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Refresh_inserido_direto_no_banco_e_recusado_e_o_legitimo_funciona()
    {
        var (c, corpo) = await Registrar();
        var userId = corpo.GetProperty("user").GetProperty("id").GetString();
        var falso = TokenService.GenerateRefreshToken();
        Sql("INSERT INTO refresh_tokens (\"Id\", \"UserId\", \"TokenHash\", \"ExpiresAt\", \"CreatedAt\") VALUES (@id, @u, @h, @x, @d)",
            ("@id", Guid.NewGuid().ToString()), ("@u", userId), ("@h", TokenService.HashToken(falso)),
            ("@x", DateTime.UtcNow.AddDays(10)), ("@d", DateTime.UtcNow));
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await c.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = falso })).StatusCode);

        var ok = await c.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = corpo.GetProperty("refreshToken").GetString() });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
    }

    [Fact]
    public void Selar_existentes_roda_uma_vez_so()
    {
        var pasta = PastaTemp();
        var chaves = new ChavesDeAssinatura(pasta);
        Assert.False(File.Exists(Path.Combine(pasta, "selado-em")));
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<Notas.Api.Data.AppDbContext>();
        Selo.SelarExistentes(db, chaves, pasta);
        Assert.True(File.Exists(Path.Combine(pasta, "selado-em")));
    }
}
