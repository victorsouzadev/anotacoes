namespace Ops;

/// <summary>Configuração do MCP de operação da VPS (seção "Ops", variáveis Ops__*).</summary>
public sealed class OpsOptions
{
    /// <summary>Menor token aceito. Este token dá root na VPS: curto demais, o serviço nem sobe.</summary>
    public const int MinTokenLength = 32;

    /// <summary>Bearer token do /mcp. Vazio = MCP desligado (503).</summary>
    public string Token { get; set; } = "";

    /// <summary>
    /// "nsenter": executa no host (namespaces do PID 1; exige pid: host e privileged).
    /// "local": executa dentro do próprio container (testes e desenvolvimento).
    /// </summary>
    public string Mode { get; set; } = "nsenter";

    /// <summary>
    /// Arquivo com o SHA-256 (hex) do token gerado pela tela do Segundo Cérebro. Quando existe,
    /// substitui o Token do .env (gerar outro na tela revoga o anterior). Relido quando muda.
    /// </summary>
    public string TokenHashFile { get; set; } = "/access/ops-token.sha256";

    /// <summary>Pasta do log de auditoria (audit.log, uma linha JSON por chamada).</summary>
    public string DataPath { get; set; } = "/data";

    /// <summary>Teto de bytes devolvidos por stdout e por stderr de cada comando.</summary>
    public int MaxOutputBytes { get; set; } = 100_000;

    /// <summary>Tempo máximo que um comando pode pedir.</summary>
    public int MaxTimeoutSeconds { get; set; } = 1800;

    public int RateLimitPerMinute { get; set; } = 60;
}
