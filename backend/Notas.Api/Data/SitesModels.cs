namespace Notas.Api.Data;

// Ferramenta "Publicar": sistemas (front estático + API C#) enviados como ZIP e
// servidos num subdomínio próprio. Ver docs/poc-multi-app/DISCOVERY.md.

public class Site
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string OwnerUserId { get; set; } = "";
    /// <summary>Primeiro rótulo da URL (meu-app.&lt;domínio&gt;) e nome do container.</summary>
    public string Slug { get; set; } = "";
    public string Nome { get; set; } = "";
    /// <summary>Versão que está no ar (ou que estava, se o site foi parado).</summary>
    public string? CurrentDeploymentId { get; set; }
    /// <summary>Parado pelo usuário: o container foi removido e só volta com "iniciar" ou novo deploy.</summary>
    public bool Parado { get; set; }
    public DateTime CriadoEm { get; set; } = DateTime.UtcNow;

    // Banco Postgres próprio (opcional). Banco e usuário têm o mesmo nome (site_<slug>);
    // a senha fica cifrada — o SQLite do notas vai para backup.
    public string? PostgresBanco { get; set; }
    public string? PostgresSenhaCifrada { get; set; }
}

public enum DeploymentStatus
{
    Enviado,
    Iniciando,
    NoAr,
    Falhou,
    Substituido,
}

public enum DeploymentTipo
{
    Estatico,
    DotNet,
}

public class Deployment
{
    // Sem hífens: vira nome de pasta e vai para o Deployer, que só aceita [a-f0-9]{32}.
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string SiteId { get; set; } = "";
    public int Versao { get; set; }
    public DeploymentTipo Tipo { get; set; }
    public bool TemWeb { get; set; }
    /// <summary>"9.0", "8.0"... — sai do *.runtimeconfig.json do pacote.</summary>
    public string? RuntimeVersao { get; set; }
    /// <summary>DLL de entrada (MeuApp.dll).</summary>
    public string? Entrada { get; set; }
    /// <summary>Caminho de health check configurado no publicar.json (exige 2xx).</summary>
    public string? Health { get; set; }
    public int MemoriaMb { get; set; }
    public DeploymentStatus Status { get; set; } = DeploymentStatus.Enviado;
    public long TamanhoBytes { get; set; }
    /// <summary>Linha do tempo da publicação e, se falhou, o fim do log do container.</summary>
    public string Log { get; set; } = "";
    /// <summary>Existe cópia do banco do app feita logo antes desta versão entrar no ar.</summary>
    public bool TemBackupBanco { get; set; }
    /// <summary>Existe pg_dump do banco Postgres do site feito logo antes desta versão entrar no ar.</summary>
    public bool TemBackupPostgres { get; set; }
    public DateTime CriadoEm { get; set; } = DateTime.UtcNow;
    public DateTime? TerminadoEm { get; set; }
}

public class SiteVariavel
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string SiteId { get; set; } = "";
    public string Chave { get; set; } = "";
    /// <summary>Cifrado com IProtetorDeSegredos — o SQLite vai para backup.</summary>
    public string ValorCifrado { get; set; } = "";
}
