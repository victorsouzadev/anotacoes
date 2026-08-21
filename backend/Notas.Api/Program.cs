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
var anthropicApiKey = builder.Configuration["Anthropic:ApiKey"];
if (!string.IsNullOrWhiteSpace(anthropicApiKey))
{
    builder.Services.AddHttpClient<ILlmExtractor, AnthropicLlmExtractor>();
}
else
{
    builder.Services.AddSingleton<ILlmExtractor, HeuristicLlmExtractor>();
}
builder.Services.AddScoped<TransacaoExtractionService>();

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

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapAuthEndpoints();
app.MapNotesEndpoints();
app.MapFoldersEndpoints();
app.MapFinancasEndpoints();
app.MapTasksEndpoints();
app.MapImagemEndpoints();

app.Run();

// Torna a classe Program (implícita em top-level statements) acessível ao projeto de testes
// via WebApplicationFactory<Program>.
public partial class Program { }
