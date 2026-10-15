using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using Ops;

var builder = WebApplication.CreateBuilder(args);

var section = builder.Configuration.GetSection("Ops");
builder.Services.Configure<OpsOptions>(section);
var options = section.Get<OpsOptions>() ?? new OpsOptions();

// Este token dá root na VPS: um token fraco é pior que nenhum, então nem sobe.
if (options.Token.Length is > 0 and < OpsOptions.MinTokenLength)
    throw new InvalidOperationException($"Ops__Token precisa de pelo menos {OpsOptions.MinTokenLength} caracteres (use: openssl rand -hex 32).");
if (options.Mode is not ("nsenter" or "local"))
    throw new InvalidOperationException("Ops__Mode deve ser nsenter ou local.");

builder.Services.AddSingleton<HostShell>();
builder.Services.AddSingleton<AuditLog>();

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("mcp", _ => RateLimitPartition.GetFixedWindowLimiter("mcp", _ => new FixedWindowRateLimiterOptions
    {
        PermitLimit = Math.Max(1, options.RateLimitPerMinute),
        Window = TimeSpan.FromMinutes(1),
        QueueLimit = 0,
    }));
});

// Streamable HTTP sem estado: sobrevive a restarts.
builder.Services
    .AddMcpServer()
    .WithHttpTransport(o => o.Stateless = true)
    .WithTools<OpsTools>();

var app = builder.Build();

var tokens = new TokenSource(options);

// Authorization: Bearer <token>, ou ?key=<token> para conectores que só aceitam URL.
app.Use(async (http, next) =>
{
    if (http.Request.Path.StartsWithSegments("/mcp"))
    {
        var tokenHash = tokens.Current();
        if (tokenHash is null)
        {
            http.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            await http.Response.WriteAsync("MCP desativado: gere o token na tela do Segundo Cérebro ou defina Ops__Token.");
            return;
        }
        var auth = http.Request.Headers.Authorization.FirstOrDefault();
        var token = auth?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true ? auth[7..].Trim() : null;
        token ??= http.Request.Query["key"].FirstOrDefault();
        if (string.IsNullOrEmpty(token) || !CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(token)), tokenHash))
        {
            app.Logger.LogWarning("ops: token recusado de {Ip}", http.Request.Headers["X-Forwarded-For"].FirstOrDefault() ?? http.Connection.RemoteIpAddress?.ToString());
            http.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }
    }
    await next(http);
});

app.UseRateLimiter();

app.MapGet("/health", (HostShell shell) => Results.Ok(new { status = "ok", modo = shell.Mode, mcp = tokens.Current() is not null, token = tokens.Origin }));
app.MapMcp("/mcp").RequireRateLimiting("mcp");

app.Run();

public partial class Program { }
