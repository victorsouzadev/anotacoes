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

// Ferramenta "Finanças": extração de lançamentos via LLM (Anthropic), com
// fallback heurístico local quando nenhuma chave de API está configurada.
builder.Services.Configure<AnthropicOptions>(builder.Configuration.GetSection(AnthropicOptions.SectionName));
builder.Services.Configure<ExtracaoOptions>(builder.Configuration.GetSection(ExtracaoOptions.SectionName));
builder.Services.Configure<FinancasOptions>(builder.Configuration.GetSection(FinancasOptions.SectionName));
builder.Services.AddSingleton<FinancasClock>();

var anthropicApiKey = builder.Configuration["Anthropic:ApiKey"];
if (!string.IsNullOrWhiteSpace(anthropicApiKey))
{
    var timeout = builder.Configuration.GetValue("Anthropic:TimeoutSegundos", 20);
    builder.Services.AddHttpClient<ILlmExtractor, AnthropicLlmExtractor>(
        c => c.Timeout = TimeSpan.FromSeconds(Math.Clamp(timeout, 5, 120)));
}
else
{
    builder.Services.AddSingleton<ILlmExtractor, HeuristicLlmExtractor>();
}
builder.Services.AddScoped<TransacaoExtractionService>();
builder.Services.AddScoped<OrcamentoService>();

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
app.MapTasksEndpoints();
app.MapImagemEndpoints();

app.Run();

// Torna a classe Program (implícita em top-level statements) acessível ao projeto de testes
// via WebApplicationFactory<Program>.
public partial class Program { }
