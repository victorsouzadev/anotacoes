using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;

namespace Notas.Api.Mcp;

/// <summary>
/// Autenticação dos MCPs dos apps (/api/mcp/{grupo}). O token é gerado na tela do Segundo Cérebro,
/// que grava só o SHA-256 dele e o e-mail do dono em um arquivo (Mcp:TokenFile, montado só leitura
/// do data/cerebro/hub/access). O MCP age como esse usuário. Sem o arquivo, os MCPs ficam desligados.
/// Aceita Authorization: Bearer ou ?key= (conectores do Claude web só aceitam URL).
/// </summary>
public sealed class AppsMcpAuth
{
    private readonly string _path;
    private readonly ILogger<AppsMcpAuth> _log;
    private readonly object _lock = new();
    private DateTime _stamp;
    private (byte[] Hash, string Email)? _current;

    public AppsMcpAuth(IConfiguration config, ILogger<AppsMcpAuth> log)
    {
        _path = config["Mcp:TokenFile"] ?? "/access/apps-token.json";
        _log = log;
    }

    public sealed record TokenFile(string Sha256, string Email);

    /// <summary>Hash e e-mail atuais, relidos quando o arquivo muda. Null = MCP desligado.</summary>
    public (byte[] Hash, string Email)? Current()
    {
        if (!File.Exists(_path)) return null;
        lock (_lock)
        {
            var stamp = File.GetLastWriteTimeUtc(_path);
            if (stamp != _stamp)
            {
                try
                {
                    var f = JsonSerializer.Deserialize<TokenFile>(File.ReadAllText(_path), new JsonSerializerOptions(JsonSerializerDefaults.Web));
                    _current = f is { Sha256.Length: 64 } && !string.IsNullOrWhiteSpace(f.Email)
                        ? (Convert.FromHexString(f.Sha256), f.Email.Trim())
                        : null;
                }
                catch (Exception e) when (e is IOException or JsonException or FormatException)
                {
                    _log.LogWarning(e, "MCP dos apps: arquivo de token inválido em {Path}", _path);
                    _current = null;
                }
                _stamp = stamp;
            }
            return _current;
        }
    }

    public static async Task Middleware(HttpContext http, Func<Task> next)
    {
        if (!http.Request.Path.StartsWithSegments("/api/mcp"))
        {
            await next();
            return;
        }

        var auth = http.RequestServices.GetRequiredService<AppsMcpAuth>();
        if (auth.Current() is not { } expected)
        {
            http.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            await http.Response.WriteAsync("MCP dos apps desligado: gere o token na tela do Segundo Cérebro (Conectar).");
            return;
        }

        var header = http.Request.Headers.Authorization.FirstOrDefault();
        var token = header?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true ? header[7..].Trim() : null;
        token ??= http.Request.Query["key"].FirstOrDefault();
        if (string.IsNullOrEmpty(token) ||
            !CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(token)), expected.Hash))
        {
            http.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        var db = http.RequestServices.GetRequiredService<AppDbContext>();
        var email = expected.Email.ToLowerInvariant();
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Email.ToLower() == email, http.RequestAborted);
        if (user is null)
        {
            http.Response.StatusCode = StatusCodes.Status403Forbidden;
            await http.Response.WriteAsync($"Nenhuma conta do hub com o e-mail do dono do Cérebro.");
            return;
        }

        http.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", user.Id), new Claim("email", user.Email)], "apps-mcp"));
        await next();
    }
}

/// <summary>Quem está chamando o MCP (o dono do Cérebro), para as ferramentas.</summary>
public sealed class McpUser(IHttpContextAccessor http)
{
    public string Id => http.HttpContext?.User.FindFirst("sub")?.Value
        ?? throw new InvalidOperationException("MCP sem usuário autenticado.");
}
