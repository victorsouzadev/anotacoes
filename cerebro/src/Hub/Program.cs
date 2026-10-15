using System.Text.Json;
using System.Threading.RateLimiting;
using Hub.Api;
using Hub.Core;
using Hub.Data;
using Hub.Index;
using Hub.Mcp;
using Hub.Pipeline;
using Hub.Vault;
using Microsoft.AspNetCore.Http.Features;

var builder = WebApplication.CreateBuilder(args);

var hubSection = builder.Configuration.GetSection("Hub");
builder.Services.Configure<HubOptions>(hubSection);
var hubOptions = hubSection.Get<HubOptions>() ?? new HubOptions();

// Limites de upload
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = hubOptions.MaxUploadBytes);
builder.Services.Configure<FormOptions>(f => f.MultipartBodyLengthLimit = hubOptions.MaxUploadBytes);

// JSON em snake_case (external_id, occurred_at...)
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
    o.SerializerOptions.Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping;
});

// Núcleo
builder.Services.AddSingleton<HubClock>();
builder.Services.AddSingleton<VaultStore>();
builder.Services.AddSingleton<HubDb>();
builder.Services.AddSingleton<NoteIndex>();
builder.Services.AddSingleton<AccessStore>();
builder.Services.AddSingleton<ApiKeyAuth>();
builder.Services.AddSingleton<SecretBox>();
builder.Services.AddSingleton<AiSettings>();

// Pipeline
builder.Services.AddSingleton<ProcessingQueue>();
builder.Services.AddSingleton<IngestService>();
builder.Services.AddSingleton<ApprovalService>();
builder.Services.AddSingleton<LinkExtractor>();
builder.Services.AddSingleton<Transcriber>();
builder.Services.AddSingleton<ClaudeClassifier>();

// Serviços de fundo (singletons para o /health ler o estado deles)
builder.Services.AddSingleton<GitSnapshotter>();
builder.Services.AddSingleton<VersionService>();
builder.Services.AddSingleton<IndexWatcher>();
builder.Services.AddSingleton<ProcessingWorker>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<GitSnapshotter>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<IndexWatcher>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<ProcessingWorker>());
// Rotina que traz os dados dos apps do hub (Tarefas, Finanças, Criativo) pelos MCPs deles.
builder.Services.AddSingleton<AppsSyncService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<AppsSyncService>());

// HTTP de saída
// Classificação (Anthropic ou OpenRouter): mesmo cliente, mesmo teto de tempo.
builder.Services.AddHttpClient("anthropic", c => c.Timeout = TimeSpan.FromSeconds(90));
builder.Services.AddHttpClient("transcribe", c => c.Timeout = TimeSpan.FromMinutes(5));
builder.Services.AddHttpClient("fetch", c =>
{
    c.Timeout = TimeSpan.FromSeconds(20);
    c.DefaultRequestHeaders.UserAgent.ParseAdd("SegundoCerebroHub/0.1 (+self-hosted)");
}).ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false });

// Rate limit por chave (ou IP)
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("api", http =>
    {
        var key = http.Request.Headers["X-Api-Key"].FirstOrDefault()
                  ?? http.Request.Query["key"].FirstOrDefault()
                  ?? http.Connection.RemoteIpAddress?.ToString()
                  ?? "anon";
        return RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = Math.Max(1, hubOptions.RateLimitPerMinute),
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        });
    });
});

// Tela do Cérebro no hub: login único (JWT do notas-api)
builder.Services.AddHubWebAuth(hubOptions.Web);

// MCP (Streamable HTTP, sem estado de sessão: sobrevive a restarts)
builder.Services
    .AddMcpServer(o => o.ServerInstructions = McpInstructions.Text)
    .WithHttpTransport(o => o.Stateless = true)
    .WithTools<VaultTools>();

var app = builder.Build();

app.Services.GetRequiredService<VaultStore>().EnsureLayout();
app.Services.GetRequiredService<AccessStore>().SyncOpsTokenFile();

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

// Autenticação do MCP: Authorization: Bearer <token> ou ?key=<token>
app.Use(async (http, next) =>
{
    if (http.Request.Path.StartsWithSegments("/mcp"))
    {
        var auth = http.RequestServices.GetRequiredService<ApiKeyAuth>();
        if (!auth.McpEnabled)
        {
            http.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            await http.Response.WriteAsync("MCP desativado: defina Hub__McpToken.");
            return;
        }
        if (!auth.AuthenticateMcp(http))
        {
            http.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }
    }
    await next(http);
});

// O Caddy pergunta aqui antes de repassar /dav ao rclone (forward_auth). Login do WebDAV gerenciado
// pela tela. O Caddy bloqueia /cerebro/internal/* de fora: só ele alcança esta rota.
app.MapGet("/internal/webdav-auth", (HttpContext http, ApiKeyAuth auth) =>
{
    if (auth.AuthenticateWebdav(http)) return Results.NoContent();
    http.Response.Headers.WWWAuthenticate = "Basic realm=\"Segundo Cerebro\", charset=\"UTF-8\"";
    return Results.Unauthorized();
}).RequireRateLimiting("api");

app.MapHubApi();
app.MapHubWeb();
app.MapMcp("/mcp");

app.Run();

public partial class Program { }
