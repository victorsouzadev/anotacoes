using System.ComponentModel;
using System.Text;
using System.Text.RegularExpressions;
using ModelContextProtocol.Server;

namespace Ops;

/// <summary>
/// Ferramentas MCP de operação da VPS. run_command é um shell de root sem restrição; as outras
/// são atalhos com argumentos validados. Toda chamada vai para o log de auditoria.
/// </summary>
[McpServerToolType]
public sealed partial class OpsTools
{
    private readonly HostShell _shell;
    private readonly AuditLog _audit;

    public OpsTools(HostShell shell, AuditLog audit)
    {
        _shell = shell;
        _audit = audit;
    }

    [McpServerTool(Name = "run_command", Destructive = true, OpenWorld = true)]
    [Description("Executa um comando de shell (bash) como root no host da VPS e devolve código de saída, stdout e stderr. " +
                 "Sem restrição: pode alterar ou apagar qualquer coisa. Prefira as outras ferramentas quando servirem. " +
                 "O hub fica em /opt/notas-vps (docker compose -f docker-compose.yml -f docker-compose.vps.yml).")]
    public async Task<string> RunCommand(
        [Description("Comando ou script bash.")] string command,
        [Description("Tempo máximo em segundos (1 a 1800). Padrão: 120.")] int timeout_seconds = 120,
        [Description("Opcional: diretório onde rodar, ex.: /opt/notas-vps.")] string? working_directory = null,
        CancellationToken ct = default)
    {
        var r = await _shell.RunAsync(command, timeout_seconds, working_directory, ct);
        await _audit.WriteAsync("run_command", new { command, working_directory, timeout_seconds }, r.ExitCode, r.ElapsedMs);
        return Format(r);
    }

    [McpServerTool(Name = "system_status", ReadOnly = true, OpenWorld = false)]
    [Description("Resumo da VPS: uptime e carga, memória, disco, containers em execução e os que estão parados ou reiniciando.")]
    public Task<string> SystemStatus(CancellationToken ct = default) => Run("system_status", new { }, """
        echo "## uptime"; uptime
        echo; echo "## memória"; free -h
        echo; echo "## disco"; df -h -x tmpfs -x overlay -x devtmpfs 2>/dev/null || df -h
        echo; echo "## containers"; docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
        echo; echo "## uso por container"; docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
        """, 60, ct);

    [McpServerTool(Name = "list_containers", ReadOnly = true, OpenWorld = false)]
    [Description("Lista todos os containers Docker da VPS (inclusive parados), com status, imagem e portas.")]
    public Task<string> ListContainers(CancellationToken ct = default) => Run("list_containers", new { },
        "docker ps -a --format 'table {{.Names}}\\t{{.Status}}\\t{{.Image}}\\t{{.Ports}}'", 30, ct);

    [McpServerTool(Name = "container_logs", ReadOnly = true, OpenWorld = false)]
    [Description("Últimas linhas de log de um container (stdout e stderr).")]
    public Task<string> ContainerLogs(
        [Description("Nome do container, ex.: notas-api, nginx-proxy-manager.")] string name,
        [Description("Quantidade de linhas (1 a 5000). Padrão: 200.")] int tail = 200,
        [Description("Opcional: só desde este tempo atrás, ex.: 10m, 2h, 1d.")] string? since = null,
        CancellationToken ct = default)
    {
        RequireName(name);
        if (since is not null && !SinceRegex().IsMatch(since))
            throw new ArgumentException("since deve ser como 10m, 2h ou 1d.");
        var cmd = $"docker logs --tail {Math.Clamp(tail, 1, 5000)} {(since is null ? "" : "--since " + since + " ")}{HostShell.Quote(name)} 2>&1";
        return Run("container_logs", new { name, tail, since }, cmd, 60, ct);
    }

    [McpServerTool(Name = "container_action", Destructive = true, OpenWorld = false)]
    [Description("Inicia, para ou reinicia um container.")]
    public Task<string> ContainerAction(
        [Description("Nome do container.")] string name,
        [Description("start, stop ou restart.")] string action,
        CancellationToken ct = default)
    {
        RequireName(name);
        if (action is not ("start" or "stop" or "restart"))
            throw new ArgumentException("action deve ser start, stop ou restart.");
        return Run("container_action", new { name, action }, $"docker {action} {HostShell.Quote(name)}", 120, ct);
    }

    [McpServerTool(Name = "read_file", ReadOnly = true, OpenWorld = false)]
    [Description("Lê um arquivo de texto do host (até 200 KB).")]
    public Task<string> ReadFile(
        [Description("Caminho absoluto, ex.: /opt/notas-vps/docker-compose.yml.")] string path,
        CancellationToken ct = default)
    {
        RequireAbsolute(path);
        return Run("read_file", new { path }, $"head -c 200000 -- {HostShell.Quote(path)}", 30, ct);
    }

    [McpServerTool(Name = "write_file", Destructive = true, OpenWorld = false)]
    [Description("Grava um arquivo de texto no host, substituindo o conteúdo. Se o arquivo existir, guarda antes uma cópia <arquivo>.bak-<data>.")]
    public Task<string> WriteFile(
        [Description("Caminho absoluto.")] string path,
        [Description("Conteúdo completo do arquivo.")] string content,
        CancellationToken ct = default)
    {
        RequireAbsolute(path);
        if (content.Length > 1_000_000) throw new ArgumentException("Conteúdo acima de 1 MB.");
        var p = HostShell.Quote(path);
        var b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(content));
        // Escreve num temporário ao lado e troca: o arquivo nunca fica pela metade.
        var cmd = $"""
            set -e
            if [ -e {p} ]; then cp -a -- {p} {p}.bak-$(date +%Y%m%d-%H%M%S); fi
            printf '%s' '{b64}' | base64 -d > {p}.ops-tmp
            if [ -e {p} ]; then chmod --reference={p} {p}.ops-tmp; chown --reference={p} {p}.ops-tmp; fi
            mv -f -- {p}.ops-tmp {p}
            echo "gravado: $(wc -c < {p}) bytes"
            """;
        return Run("write_file", new { path, bytes = content.Length }, cmd, 30, ct);
    }

    private async Task<string> Run(string tool, object args, string command, int timeout, CancellationToken ct)
    {
        var r = await _shell.RunAsync(command, timeout, null, ct);
        await _audit.WriteAsync(tool, args, r.ExitCode, r.ElapsedMs);
        return Format(r);
    }

    internal static string Format(ShellResult r)
    {
        var sb = new StringBuilder();
        sb.Append(r.TimedOut ? "tempo esgotado (processo encerrado)" : $"código de saída: {r.ExitCode}")
          .Append($" · {r.ElapsedMs} ms");
        if (r.Truncated) sb.Append(" · saída cortada");
        sb.Append('\n');
        if (r.Stdout.Length > 0) sb.Append("\n--- stdout ---\n").Append(r.Stdout.TrimEnd()).Append('\n');
        if (r.Stderr.Length > 0) sb.Append("\n--- stderr ---\n").Append(r.Stderr.TrimEnd()).Append('\n');
        return sb.ToString();
    }

    internal static void RequireName(string name)
    {
        if (!NameRegex().IsMatch(name)) throw new ArgumentException($"Nome de container inválido: {name}");
    }

    private static void RequireAbsolute(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !path.StartsWith('/') || path.Contains('\0'))
            throw new ArgumentException("Informe um caminho absoluto, começando com /.");
    }

    [GeneratedRegex("^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$")]
    private static partial Regex NameRegex();

    [GeneratedRegex("^[0-9]{1,5}[smhd]$")]
    private static partial Regex SinceRegex();
}
