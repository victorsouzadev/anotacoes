using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Notas.Api.Endpoints;

namespace EditorImagens.Desktop;

/// <summary>
/// MCP do Estúdio no próprio PC (Claude Desktop e Claude Code apontam para ele): a mesma rota
/// /api/mcp/estudio do servidor, numa porta fixa do 127.0.0.1 para o endereço não mudar a cada
/// abertura. O token é gerado uma vez, guardado cifrado (DPAPI) e o servidor local só conhece o
/// hash dele, no mesmo formato do arquivo que o Segundo Cérebro grava na VPS.
/// </summary>
public static class McpLocal
{
    public const int Porta = 47820;
    private static readonly byte[] Entropia = Encoding.UTF8.GetBytes("EditorImagens.Mcp.v1");

    public static string Url(string grupo = "estudio") => $"http://127.0.0.1:{Porta}/api/mcp/{grupo}";

    /// <summary>Token em claro (para mostrar ao usuário), criando-o na primeira vez, e o arquivo de hash em dia.</summary>
    public static string Garantir(Configuracao config)
    {
        string? token = null;
        if (!string.IsNullOrEmpty(config.McpTokenCifrado))
        {
            try
            {
                token = Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(config.McpTokenCifrado), Entropia, DataProtectionScope.CurrentUser));
            }
            catch (Exception e) when (e is CryptographicException or FormatException) { token = null; }
        }
        if (token is null)
        {
            token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
            config.McpTokenCifrado = Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(token), Entropia, DataProtectionScope.CurrentUser));
            config.Salvar();
        }
        File.WriteAllText(Pastas.McpToken, JsonSerializer.Serialize(new
        {
            sha256 = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token))),
            email = DesktopAuthEndpoints.LocalEmail,
        }));
        return token;
    }

    /// <summary>Troca o token (o antigo deixa de valer na hora).</summary>
    public static string Renovar(Configuracao config)
    {
        config.McpTokenCifrado = null;
        return Garantir(config);
    }
}
