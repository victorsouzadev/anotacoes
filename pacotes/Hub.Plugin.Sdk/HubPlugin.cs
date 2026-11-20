using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Hub.Plugin;

/// <summary>Configuração que o deployer do núcleo passa a cada plug-in por variáveis de ambiente (spec 029).</summary>
public class OpcoesDoHub
{
    public string Id { get; set; } = "";
    /// <summary><c>HUB_JWKS</c>: chaves públicas do núcleo.</summary>
    public string Jwks { get; set; } = "http://api:8080/.well-known/jwks.json";
    /// <summary><c>HUB_NUCLEO</c>: endereço interno da API do núcleo.</summary>
    public string Nucleo { get; set; } = "http://api:8080";
    /// <summary><c>HUB_BANCO</c>: banco compartilhado (spec 031).</summary>
    public string Banco { get; set; } = "/data/db/notas.db";
    /// <summary>
    /// Aceita também o token do hub (<c>aud=notas-vps</c>) enquanto os apps Android não pedem o token do
    /// plug-in (spec 030). Desligar por spec própria quando todos os APKs estiverem atualizados.
    /// </summary>
    public bool AceitarAudienciaLegada { get; set; } = true;
    public string Versao { get; set; } = "dev";

    public static OpcoesDoHub DoAmbiente(Manifesto m) => new()
    {
        Id = m.Id,
        Jwks = Environment.GetEnvironmentVariable("HUB_JWKS") ?? "http://api:8080/.well-known/jwks.json",
        Nucleo = Environment.GetEnvironmentVariable("HUB_NUCLEO") ?? "http://api:8080",
        Banco = Environment.GetEnvironmentVariable("HUB_BANCO") ?? "/data/db/notas.db",
        AceitarAudienciaLegada = Environment.GetEnvironmentVariable("HUB_ACEITAR_AUDIENCIA_LEGADA") != "false",
        Versao = Environment.GetEnvironmentVariable("VERSAO") ?? "dev",
    };
}

public static class HubPlugin
{
    public const string Emissor = "notas-vps";
    public const string AudienciaHub = "notas-vps";

    /// <summary>
    /// Lê o <c>plugin.json</c>, recusa subir fora do contrato e liga o login do núcleo (ES256 pelo JWKS,
    /// <c>aud=&lt;id&gt;</c>). O plug-in não tem segredo de assinatura nenhum: não consegue emitir login.
    /// </summary>
    public static Manifesto AdicionarPlugin(this WebApplicationBuilder builder, string arquivo = "plugin.json",
        Action<OpcoesDoHub>? configurar = null, HttpClient? http = null)
    {
        var caminho = Path.IsPathRooted(arquivo) ? arquivo : Path.Combine(AppContext.BaseDirectory, arquivo);
        var m = Manifesto.Ler(caminho);
        if (m.Problemas() is { Count: > 0 } p) throw new InvalidOperationException("plugin.json fora do contrato: " + string.Join("; ", p));

        var o = OpcoesDoHub.DoAmbiente(m);
        configurar?.Invoke(o);
        builder.Services.AddSingleton(m);
        builder.Services.AddSingleton(o);
        var jwks = new JwksDoNucleo(o.Jwks, http);
        builder.Services.AddSingleton(jwks);

        var revogacoes = new RevogacoesDoNucleo(o, http);
        builder.Services.AddSingleton(revogacoes);
        builder.Services.AddHostedService<VigiaDasRevogacoes>();

        // Um Bearer "hub_..." é token MCP estático; o resto é JWT do núcleo (login ou OAuth).
        builder.Services.AddAuthentication("Hub")
            .AddPolicyScheme("Hub", "Login do hub", p => p.ForwardDefaultSelector = ctx =>
                ctx.Request.Headers.Authorization.ToString().StartsWith("Bearer hub_") ? TokenMcpHandler.Esquema : JwtBearerDefaults.AuthenticationScheme)
            .AddScheme<AuthenticationSchemeOptions, TokenMcpHandler>(TokenMcpHandler.Esquema, null)
            .AddJwtBearer(b =>
            {
                b.MapInboundClaims = false;
                b.TokenValidationParameters = ParametrosDeValidacao(o, jwks);
                // Acesso OAuth revogado no núcleo para em até 60 s (spec 030).
                b.Events = new JwtBearerEvents
                {
                    OnTokenValidated = ctx =>
                    {
                        if (revogacoes.Revogado(ctx.Principal?.FindFirst(JwtRegisteredClaimNames.Jti)?.Value)) ctx.Fail("token revogado");
                        return Task.CompletedTask;
                    },
                };
            });
        builder.Services.AddAuthorization();
        builder.WebHost.UseUrls($"http://+:{m.Porta}");
        return m;
    }

    public static TokenValidationParameters ParametrosDeValidacao(OpcoesDoHub o, JwksDoNucleo jwks) => new()
    {
        ValidIssuer = Emissor,
        ValidAudiences = o.AceitarAudienciaLegada ? [o.Id, AudienciaHub] : [o.Id],
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidAlgorithms = [SecurityAlgorithms.EcdsaSha256],
        ClockSkew = TimeSpan.FromSeconds(30),
        NameClaimType = JwtRegisteredClaimNames.Email,
        IssuerSigningKeyResolver = (_, _, kid, _) => jwks.Chaves(kid),
    };

    /// <summary>Health do contrato: <c>200 { status: "ok", versao }</c> em <c>manifesto.health</c>, sem login.</summary>
    public static IEndpointConventionBuilder MapHealthDoPlugin(this IEndpointRouteBuilder app)
    {
        var m = app.ServiceProvider.GetRequiredService<Manifesto>();
        var o = app.ServiceProvider.GetRequiredService<OpcoesDoHub>();
        return app.MapGet(m.Health, () => Results.Ok(new { status = "ok", versao = o.Versao })).AllowAnonymous();
    }

    /// <summary>Id do usuário logado (<c>sub</c> do token do núcleo).</summary>
    public static string? UsuarioId(this HttpContext ctx) => ctx.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
}
