using System.Text.RegularExpressions;

namespace Notas.Api.Services.Sites;

/// <summary>Configuração da ferramenta "Publicar" (seção "Sites" / variáveis Sites__*).</summary>
public class SitesOptions
{
    public const string SectionName = "Sites";

    /// <summary>Onde os pacotes e os bancos dos apps ficam, visto de dentro do container da API.</summary>
    public string Raiz { get; set; } = "../../data/sites";

    /// <summary>Domínio base: o site "meu-app" responde em meu-app.&lt;Dominio&gt;.</summary>
    public string Dominio { get; set; } = "191-252-177-244.sslip.io";

    /// <summary>Porta pública do Caddy, só para montar a URL mostrada ao usuário (vazio = 80).</summary>
    public string Porta { get; set; } = "8090";

    /// <summary>E-mails (separados por vírgula) que podem publicar. Vazio = ninguém.</summary>
    public string Publicadores { get; set; } = "";

    /// <summary>Endereço interno do Deployer (o único serviço com acesso ao Docker).</summary>
    public string DeployerUrl { get; set; } = "http://deployer:8080";
    public string DeployerToken { get; set; } = "";

    /// <summary>Caddy visto de dentro da rede: o health check passa pelo mesmo caminho do usuário.</summary>
    public string GatewayUrl { get; set; } = "http://caddy:8080";

    public long MaxZipBytes { get; set; } = 100L * 1024 * 1024;
    public long MaxDescompactadoBytes { get; set; } = 300L * 1024 * 1024;
    public int MaxArquivos { get; set; } = 10_000;

    public int HealthTimeoutSegundos { get; set; } = 30;
    /// <summary>Teto de apps .NET rodando ao mesmo tempo — a VPS tem 1.9 GiB.</summary>
    public int MaxAppsRodando { get; set; } = 5;
    public int MemoriaPadraoMb { get; set; } = 192;
    /// <summary>Versões guardadas por site (as mais antigas são apagadas do disco).</summary>
    public int VersoesGuardadas { get; set; } = 5;

    public bool PodePublicar(string? email) =>
        !string.IsNullOrWhiteSpace(email) &&
        Publicadores.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(p => string.Equals(p, email, StringComparison.OrdinalIgnoreCase));

    public string Url(string slug) =>
        string.IsNullOrEmpty(Porta) || Porta == "80"
            ? $"http://{slug}.{Dominio}"
            : $"http://{slug}.{Dominio}:{Porta}";
}

public static partial class SlugRegras
{
    // Nomes que parecem oficiais ou que um dia podem virar subdomínio de verdade.
    private static readonly HashSet<string> Reservados = new(StringComparer.OrdinalIgnoreCase)
    {
        "www", "api", "admin", "hub", "notas", "app", "apps", "mail", "smtp", "ftp", "ns1", "ns2",
        "static", "cdn", "deployer", "caddy", "localhost", "root", "status", "login", "auth",
    };

    [GeneratedRegex("^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$")]
    private static partial Regex Formato();

    /// <summary>Devolve a mensagem de erro, ou null se o slug é válido.</summary>
    public static string? Validar(string? slug)
    {
        if (string.IsNullOrEmpty(slug) || !Formato().IsMatch(slug) || slug.Contains("--"))
            return "Use de 3 a 30 letras minúsculas, números e hífens (sem hífen no começo, no fim ou repetido).";
        if (Reservados.Contains(slug))
            return "Esse endereço é reservado.";
        return null;
    }
}
