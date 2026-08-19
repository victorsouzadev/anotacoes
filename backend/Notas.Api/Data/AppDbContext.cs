using Microsoft.EntityFrameworkCore;

namespace Notas.Api.Data;

public class User
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
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
}

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<Folder> Folders => Set<Folder>();
    public DbSet<Note> Notes => Set<Note>();
    public DbSet<Transacao> Transacoes => Set<Transacao>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>(e =>
        {
            e.ToTable("users");
            e.HasIndex(u => u.Email).IsUnique();
            e.Property(u => u.Email).UseCollation("NOCASE");
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

        b.Entity<Transacao>(e =>
        {
            e.ToTable("financas_transacoes");
            e.Property(t => t.Descricao).IsRequired().HasMaxLength(500);
            e.Property(t => t.Valor).HasColumnType("decimal(10,2)");
            e.Property(t => t.Tipo).HasConversion<string>().HasMaxLength(20);
            e.Property(t => t.Categoria).HasConversion<string>().HasMaxLength(30);
            e.Property(t => t.FormaPagamento).HasConversion<string>().HasMaxLength(20);
            e.Property(t => t.Status).HasConversion<string>().HasMaxLength(30);
            e.Property(t => t.TextoOriginal).HasMaxLength(1000);
            e.HasIndex(t => new { t.UserId, t.Data });
            e.HasOne<User>().WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
