using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;

namespace Notas.Api.Mcp;

/// <summary>
/// Token dos MCPs dos apps gerado na tela do Segundo Cérebro: ela grava só o SHA-256 dele e o e-mail do dono em um
/// arquivo (Mcp:TokenFile, montado só leitura do data/cerebro/hub/access). Os MCPs são dos plug-ins desde a spec 035;
/// o núcleo só repassa esse hash no /api/core/revogados.
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
}
