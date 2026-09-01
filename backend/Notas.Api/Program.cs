using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Auth;
using Notas.Api.Data;
using Notas.Api.Endpoints;
using Notas.Api.Services.Financas;
using Notas.Api.Services.Financas.Llm;
using Notas.Api.Services.Seguranca;

var builder = WebApplication.CreateBuilder(args);

var jwtSecret = builder.Configuration["JWT_SECRET"]
    ?? throw new InvalidOperationException("Defina a variável de ambiente JWT_SECRET.");
var connectionString = builder.Configuration.GetConnectionString("Db")
    ?? "Data Source=../../data/db/notas.db";

builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 10 * 1024 * 1024);

builder.Services.AddDbContext<AppDbContext>(o => o.UseSqlite(connectionString));
builder.Services.AddSingleton<TokenService>();

// Enums (ferramenta Finanças) trafegam como string no JSON, em vez de índice numérico.
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

// Ferramenta "Finanças": extração de lançamentos por LLM, com fallback heurístico
// local quando nenhuma chave de API está configurada.
builder.Services.Configure<AnthropicOptions>(builder.Configuration.GetSection(AnthropicOptions.SectionName));
builder.Services.Configure<OpenRouterOptions>(builder.Configuration.GetSection(OpenRouterOptions.SectionName));
builder.Services.Configure<ExtracaoOptions>(builder.Configuration.GetSection(ExtracaoOptions.SectionName));
builder.Services.Configure<FinancasOptions>(builder.Configuration.GetSection(FinancasOptions.SectionName));
builder.Services.AddSingleton<FinancasClock>();

// Provedor de LLM: OpenRouter (o único que lê imagem/PDF), Anthropic direto, ou o
// extrator heurístico local. O usuário pode cadastrar a própria chave e o próprio
// modelo em Configurações; as variáveis de ambiente abaixo valem como padrão do
// servidor para quem não configurou nada.
// Os clientes HTTP são nomeados porque a escolha do provedor deixou de acontecer
// na subida do processo: cada requisição resolve a chave e o modelo do usuário
// (ver LlmExtractorFactory), então o extrator é construído sob demanda.
builder.Services.AddHttpClient(nameof(OpenRouterLlmExtractor), c =>
    c.Timeout = TimeSpan.FromSeconds(
        builder.Configuration.GetValue("OpenRouter:TimeoutComAnexosSegundos", 120) + 15));

builder.Services.AddHttpClient(nameof(AnthropicLlmExtractor), c =>
    c.Timeout = TimeSpan.FromSeconds(
        Math.Clamp(builder.Configuration.GetValue("Anthropic:TimeoutSegundos", 20), 5, 120)));

builder.Services.AddSingleton<IProtetorDeSegredos, ProtetorDeSegredos>();
builder.Services.AddScoped<ILlmExtractorFactory, LlmExtractorFactory>();

builder.Services.AddScoped<TransacaoExtractionService>();
builder.Services.AddScoped<OrcamentoService>();
builder.Services.AddScoped<MetaService>();

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o => o.TokenValidationParameters = TokenService.ValidationParameters(jwtSecret));
builder.Services.AddAuthorization();

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(1),
        }));

    // Lançamento por texto livre é o único endpoint que custa dinheiro por chamada
    // (uma requisição ao LLM). O limite é por usuário autenticado, não por IP, para
    // que um token vazado não consiga queimar a chave da API em laço.
    o.AddPolicy("financas-ia", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
            ?? ctx.User.FindFirst("sub")?.Value
            ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 30,
            Window = TimeSpan.FromMinutes(1),
        }));

    // Importar arquivo custa muito mais que interpretar uma frase: uma foto de
    // cupom vale milhares de tokens e um PDF de extrato, dezenas de milhares.
    // O limite é bem mais apertado que o do lançamento por texto.
    o.AddPolicy("financas-importacao", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
            ?? ctx.User.FindFirst("sub")?.Value
            ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(5),
        }));
});

var app = builder.Build();

// Todo tráfego chega via Caddy (e futuramente NPM) — confiar no X-Forwarded-For.
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    KnownNetworks = { },
    KnownProxies = { },
});

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var dataSource = new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder(connectionString).DataSource;
    var dir = Path.GetDirectoryName(Path.GetFullPath(dataSource));
    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
    db.Database.Migrate();
    db.Database.ExecuteSqlRaw("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
}

// A autenticação vem antes do limitador porque a política "financas-ia" particiona
// por usuário: com a ordem invertida, ctx.User estaria vazio e todo mundo atrás do
// mesmo IP dividiria a mesma cota.
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapAuthEndpoints();
app.MapNotesEndpoints();
app.MapFoldersEndpoints();
app.MapFinancasEndpoints();
app.MapOrcamentoEndpoints();
app.MapMetaEndpoints();
app.MapConfiguracaoIaEndpoints();
app.MapTasksEndpoints();
app.MapImagemEndpoints();

app.Run();

// Torna a classe Program (implícita em top-level statements) acessível ao projeto de testes
// via WebApplicationFactory<Program>.
public partial class Program { }
