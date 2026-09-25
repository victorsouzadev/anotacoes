using System.Text.RegularExpressions;

namespace Notas.Deployer;

public record IniciarApp(
    string DeployId,
    string Entrada,
    string Runtime,
    int MemoriaMb,
    Dictionary<string, string>? Variaveis);

public class Configuracao
{
    /// <summary>Caminho de data/sites NO HOST — é o que o daemon do Docker enxerga nos -v.</summary>
    public required string RaizSitesNoHost { get; init; }
    /// <summary>Rede Docker dos apps (separada da rede da API; o Caddy participa das duas).</summary>
    public string Rede { get; init; } = "notas-sites";
    public string Imagem { get; init; } = "mcr.microsoft.com/dotnet/aspnet";
    public double Cpus { get; init; } = 0.5;
    /// <summary>Container do Postgres compartilhado (pg_dump/pg_restore rodam dentro dele).</summary>
    public string ContainerPostgres { get; init; } = "notas-postgres";
}

/// <summary>
/// Monta os argumentos do docker CLI. Tudo que vem da API é validado aqui: o Deployer
/// não confia no chamador para decidir o que montar ou com que privilégio rodar — ele
/// só aceita slug, versão, DLL, runtime, memória e variáveis, e o resto é fixo.
/// </summary>
public static partial class ComandosDocker
{
    public static readonly string[] Runtimes = ["8.0", "9.0", "10.0"];

    [GeneratedRegex("^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$")]
    private static partial Regex Slug();

    [GeneratedRegex("^[a-f0-9]{32}$")]
    private static partial Regex DeployId();

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.dll$")]
    private static partial Regex Entrada();

    [GeneratedRegex("^[A-Za-z_][A-Za-z0-9_]{0,127}$")]
    private static partial Regex Chave();

    [GeneratedRegex("^site_[a-z0-9_]{3,40}$")]
    private static partial Regex BancoPostgres();

    public static string NomeContainer(string slug) => "site-" + slug;

    public static string? ValidarBanco(string banco) => BancoPostgres().IsMatch(banco) ? null : "banco inválido";

    // Dentro do container do Postgres o socket local é "trust" para o superusuário (imagem
    // oficial): nenhuma senha passa por aqui. E pg_dump/pg_restore têm sempre a versão do
    // servidor.
    public static List<string> DumpPostgres(string banco, Configuracao cfg) =>
        ["exec", cfg.ContainerPostgres, "pg_dump", "-U", "postgres", "--format=custom", "--dbname", banco];

    /// <summary>Restaura num banco recém-recriado (vazio): o dono dos objetos volta a ser o usuário do site.</summary>
    public static List<string> RestaurarPostgres(string banco, Configuracao cfg) =>
        ["exec", "-i", cfg.ContainerPostgres, "pg_restore", "-U", "postgres", "--exit-on-error", "--single-transaction", "--dbname", banco];

    public static string? ValidarSlug(string slug) =>
        Slug().IsMatch(slug) && !slug.Contains("--") ? null : "slug inválido";

    public static string? Validar(string slug, IniciarApp app)
    {
        if (ValidarSlug(slug) is { } e) return e;
        if (!DeployId().IsMatch(app.DeployId ?? "")) return "deployId inválido";
        if (!Entrada().IsMatch(app.Entrada ?? "")) return "entrada inválida";
        if (!Runtimes.Contains(app.Runtime)) return "runtime não suportado";
        if (app.MemoriaMb is < 64 or > 512) return "memória fora de 64..512 MB";
        foreach (var (k, v) in app.Variaveis ?? [])
        {
            if (!Chave().IsMatch(k)) return $"variável inválida: {k}";
            if (v is null || v.Length > 8192 || v.Contains('\0')) return $"valor inválido em {k}";
        }
        return null;
    }

    public static List<string> Run(string slug, IniciarApp app, Configuracao cfg)
    {
        var raiz = cfg.RaizSitesNoHost.TrimEnd('/');
        var nome = NomeContainer(slug);
        var args = new List<string>
        {
            "run", "-d",
            "--name", nome,
            "--label", "notas.site=" + slug,
            "--network", cfg.Rede,
            "--restart", "unless-stopped",
            // Limites: um bug de um app não pode levar a VPS (1.9 GiB) junto.
            "--memory", $"{app.MemoriaMb}m",
            "--memory-swap", $"{app.MemoriaMb}m",
            "--cpus", cfg.Cpus.ToString(System.Globalization.CultureInfo.InvariantCulture),
            "--pids-limit", "200",
            // Disco só leitura, exceto /tmp (memória) e /data (o banco do app).
            "--read-only",
            "--tmpfs", "/tmp:rw,size=64m",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "--user", "1000:1000",
            "--log-opt", "max-size=10m",
            "--log-opt", "max-file=2",
            "-v", $"{raiz}/{slug}/deploys/{app.DeployId}/api:/app:ro",
            "-v", $"{raiz}/{slug}/data:/data",
            "-w", "/app",
        };

        // As do usuário primeiro: no docker, o último -e vence, e as da plataforma não
        // podem ser sobrescritas.
        foreach (var (k, v) in (app.Variaveis ?? []).OrderBy(x => x.Key, StringComparer.Ordinal))
            args.AddRange(["-e", $"{k}={v}"]);

        args.AddRange([
            "-e", "ASPNETCORE_URLS=http://0.0.0.0:8080",
            "-e", "ConnectionStrings__Default=Data Source=/data/app.db",
            "-e", "HOME=/tmp",
            "-e", "DOTNET_gcServer=0",
            "-e", "DOTNET_EnableDiagnostics=0",
            $"{cfg.Imagem}:{app.Runtime}",
            "dotnet", "/app/" + app.Entrada,
        ]);
        return args;
    }

    public static List<string> Remover(string slug) => ["rm", "-f", NomeContainer(slug)];

    public static List<string> Logs(string slug, int linhas) =>
        ["logs", "--tail", Math.Clamp(linhas, 1, 2000).ToString(), "--timestamps", NomeContainer(slug)];

    public static List<string> Listar() =>
        ["ps", "--filter", "label=notas.site", "--format", "{{.Label \"notas.site\"}}"];
}
