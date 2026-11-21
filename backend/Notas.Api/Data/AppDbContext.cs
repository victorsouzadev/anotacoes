using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Notas.Api.Data;

public class User
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>HMAC do núcleo sobre Id, Email e PasswordHash (spec 030): linha gravada por fora não loga.</summary>
    public string? Selo { get; set; }
}

public class RefreshToken
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string UserId { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? RevokedAt { get; set; }
    public string? ReplacedBy { get; set; }

    /// <summary>HMAC do núcleo sobre TokenHash, UserId e ExpiresAt (spec 030).</summary>
    public string? Selo { get; set; }
}

public class Folder
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string UserId { get; set; } = "";
    public string Name { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Note
{
    // Id é UUID gerado no cliente — base da estratégia de sync (PUT upsert idempotente).
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string? FolderId { get; set; }
    public string Title { get; set; } = "";
    public string Elements { get; set; } = "[]";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
    /// <summary>Na lixeira desde (spec 018). O conteúdo fica; depois de 30 dias vira tombstone (DeletedAt).</summary>
    public DateTime? TrashedAt { get; set; }
    /// <summary>Tags da nota em JSON (spec 021): minúsculas, únicas, até 20 de até 40 caracteres.</summary>
    public string Tags { get; set; } = "[]";
}

/// <summary>Link somente leitura de uma nota (spec 023). Só o SHA-256 do token fica no banco.</summary>
public class NoteShare
{
    public string Id { get; set; } = "";
    public string NoteId { get; set; } = "";
    public string UserId { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public string Nome { get; set; } = "";
    public DateTime? ExpiraEm { get; set; }
    public DateTime? RevogadoEm { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<Notas.Api.Services.Plugins.PluginEstado> PluginsEstado => Set<Notas.Api.Services.Plugins.PluginEstado>();
    public DbSet<Notas.Api.Services.Auth.OAuthCliente> OAuthClientes => Set<Notas.Api.Services.Auth.OAuthCliente>();
    public DbSet<Notas.Api.Services.Auth.OAuthPedido> OAuthPedidos => Set<Notas.Api.Services.Auth.OAuthPedido>();
    public DbSet<Notas.Api.Services.Auth.OAuthCodigo> OAuthCodigos => Set<Notas.Api.Services.Auth.OAuthCodigo>();
    public DbSet<Notas.Api.Services.Auth.OAuthToken> OAuthTokens => Set<Notas.Api.Services.Auth.OAuthToken>();
    public DbSet<Notas.Api.Services.Auth.OAuthRevogado> OAuthRevogados => Set<Notas.Api.Services.Auth.OAuthRevogado>();
    public DbSet<Notas.Api.Services.Auth.McpToken> McpTokens => Set<Notas.Api.Services.Auth.McpToken>();
    public DbSet<Folder> Folders => Set<Folder>();
    public DbSet<Note> Notes => Set<Note>();
    public DbSet<NoteShare> NoteShares => Set<NoteShare>();
    public DbSet<ConfiguracaoIa> ConfiguracoesIa => Set<ConfiguracaoIa>();
    public DbSet<Notas.Api.Services.Seguranca.SegredoRecifrado> SegredosRecifrados => Set<Notas.Api.Services.Seguranca.SegredoRecifrado>();
    public DbSet<Site> Sites => Set<Site>();
    public DbSet<Deployment> Deployments => Set<Deployment>();
    public DbSet<SiteVariavel> SiteVariaveis => Set<SiteVariavel>();

    // SQLite não guarda DateTimeKind — toda leitura do banco volta com Kind=Unspecified, mesmo
    // que o valor gravado fosse UTC. Sem isso, o JSON de uma entidade recém-criada (ainda em
    // memória) sai com "Z" no fim, mas a mesma entidade relida do banco (ex.: próximo GET) sai
    // sem "Z" — inconsistência que quebra parsers estritos de ISO 8601 como o do Android
    // (java.time.Instant.parse exige "Z"/offset). Força Kind=Utc em toda leitura, pra todo
    // DateTime/DateTime? do modelo, deixando a serialização sempre consistente.
    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        configurationBuilder.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>();
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        // Registro de plug-ins (spec 029): tabela do núcleo, prefixo core_.
        b.Entity<Notas.Api.Services.Plugins.PluginEstado>(e =>
        {
            e.ToTable("core_plugins_estado");
            e.HasKey(x => x.Id);
        });
        // OAuth do núcleo (spec 030).
        // Spec 035: segredos do núcleo já entregues a um plug-in para recifrar (uma vez por linha).
        b.Entity<Notas.Api.Services.Seguranca.SegredoRecifrado>(e => { e.ToTable("core_segredos_recifrados"); e.HasKey(x => new { x.Plugin, x.Tabela, x.Linha }); });
        b.Entity<Notas.Api.Services.Auth.OAuthCliente>(e => { e.ToTable("core_oauth_clientes"); e.HasKey(x => x.Id); });
        b.Entity<Notas.Api.Services.Auth.OAuthPedido>(e => { e.ToTable("core_oauth_pedidos"); e.HasKey(x => x.Id); });
        b.Entity<Notas.Api.Services.Auth.OAuthCodigo>(e => { e.ToTable("core_oauth_codigos"); e.HasKey(x => x.Hash); });
        b.Entity<Notas.Api.Services.Auth.OAuthToken>(e =>
        {
            e.ToTable("core_oauth_tokens");
            e.HasKey(x => x.Hash);
            e.HasIndex(x => x.Familia);
            e.HasIndex(x => new { x.UsuarioId, x.ClienteId });
        });
        b.Entity<Notas.Api.Services.Auth.OAuthRevogado>(e => { e.ToTable("core_oauth_revogados"); e.HasKey(x => x.Jti); e.HasIndex(x => x.Plugin); });
        b.Entity<Notas.Api.Services.Auth.McpToken>(e =>
        {
            e.ToTable("core_mcp_tokens");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Hash).IsUnique();
        });

        b.Entity<User>(e =>
        {
            e.ToTable("users");
            e.HasIndex(u => u.Email).IsUnique();
            e.Property(u => u.Email).UseCollation("NOCASE");
        });

        b.Entity<NoteShare>(e =>
        {
            e.ToTable("note_shares");
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => new { x.UserId, x.NoteId });
            e.Property(x => x.Nome).HasMaxLength(80);
        });

        b.Entity<RefreshToken>(e =>
        {
            e.ToTable("refresh_tokens");
            e.HasIndex(t => t.TokenHash).IsUnique();
            e.HasIndex(t => t.UserId);
            e.HasOne<User>().WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Folder>(e =>
        {
            e.ToTable("folders");
            e.HasIndex(f => f.UserId);
            e.HasOne<User>().WithMany().HasForeignKey(f => f.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Note>(e =>
        {
            e.ToTable("notes");
            e.HasIndex(n => new { n.UserId, n.UpdatedAt });
            e.HasIndex(n => new { n.UserId, n.FolderId });
            e.HasOne<User>().WithMany().HasForeignKey(n => n.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Folder>().WithMany().HasForeignKey(n => n.FolderId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<Site>(e =>
        {
            e.ToTable("sites");
            e.Property(x => x.Slug).IsRequired().HasMaxLength(30);
            e.Property(x => x.Nome).IsRequired().HasMaxLength(100);
            e.Property(x => x.PostgresBanco).HasMaxLength(63);
            e.HasIndex(x => x.Slug).IsUnique();
            e.HasIndex(x => x.OwnerUserId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.OwnerUserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Deployment>(e =>
        {
            e.ToTable("sites_deployments");
            e.Property(x => x.Tipo).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.RuntimeVersao).HasMaxLength(10);
            e.Property(x => x.Entrada).HasMaxLength(200);
            e.Property(x => x.Health).HasMaxLength(200);
            e.HasIndex(x => new { x.SiteId, x.Versao }).IsUnique();
            e.HasOne<Site>().WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<SiteVariavel>(e =>
        {
            e.ToTable("sites_variaveis");
            e.Property(x => x.Chave).IsRequired().HasMaxLength(128);
            e.HasIndex(x => new { x.SiteId, x.Chave }).IsUnique();
            e.HasOne<Site>().WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ConfiguracaoIa>(e =>
        {
            e.ToTable("configuracoes_ia");
            e.Property(c => c.Provedor).HasMaxLength(30);
            e.Property(c => c.Modelo).HasMaxLength(120);
            e.Property(c => c.ChaveApiSufixo).HasMaxLength(8);
            e.Property(c => c.ChaveUpscaleSufixo).HasMaxLength(8);
            // Uma configuração por usuário — o upsert do endpoint depende disso.
            e.HasIndex(c => c.UserId).IsUnique();
            e.HasOne<User>().WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}

public class UtcDateTimeConverter : ValueConverter<DateTime, DateTime>
{
    public UtcDateTimeConverter() : base(
        v => v,
        v => v.Kind == DateTimeKind.Utc ? v : DateTime.SpecifyKind(v, DateTimeKind.Utc))
    {
    }
}
