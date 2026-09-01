using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

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
    public DbSet<Orcamento> Orcamentos => Set<Orcamento>();
    public DbSet<OrcamentoItem> OrcamentoItens => Set<OrcamentoItem>();
    public DbSet<MetaReserva> MetasReserva => Set<MetaReserva>();
    public DbSet<MetaAporte> MetaAportes => Set<MetaAporte>();
    public DbSet<TaskCategory> TaskCategories => Set<TaskCategory>();
    public DbSet<TaskItem> TaskItems => Set<TaskItem>();
    public DbSet<TaskComment> TaskComments => Set<TaskComment>();
    public DbSet<TaskAttachment> TaskAttachments => Set<TaskAttachment>();
    public DbSet<KanbanLane> KanbanLanes => Set<KanbanLane>();
    public DbSet<ImageProject> ImageProjects => Set<ImageProject>();

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

        b.Entity<ImageProject>(e =>
        {
            e.ToTable("imagem_projetos");
            e.Property(p => p.Name).IsRequired().HasMaxLength(300);
            e.Property(p => p.Data).IsRequired();
            e.HasIndex(p => new { p.UserId, p.UpdatedAt });
            e.HasOne<User>().WithMany().HasForeignKey(p => p.UserId).OnDelete(DeleteBehavior.Cascade);
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

        b.Entity<Orcamento>(e =>
        {
            e.ToTable("financas_orcamentos");
            e.Property(o => o.ValorTotal).HasColumnType("decimal(12,2)");
            e.Property(o => o.Observacoes).HasMaxLength(500);
            // No máximo um orçamento por mês por usuário — o upsert do endpoint
            // depende disso.
            e.HasIndex(o => new { o.UserId, o.Ano, o.Mes }).IsUnique();
            e.HasOne<User>().WithMany().HasForeignKey(o => o.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(o => o.Itens).WithOne().HasForeignKey(i => i.OrcamentoId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<OrcamentoItem>(e =>
        {
            e.ToTable("financas_orcamento_itens");
            e.Property(i => i.Categoria).HasConversion<string>().HasMaxLength(30);
            e.Property(i => i.Percentual).HasColumnType("decimal(7,4)");
            // Uma categoria não pode aparecer duas vezes no mesmo orçamento.
            e.HasIndex(i => new { i.OrcamentoId, i.Categoria }).IsUnique();
        });

        b.Entity<MetaReserva>(e =>
        {
            e.ToTable("financas_metas");
            e.Property(m => m.Nome).IsRequired().HasMaxLength(120);
            e.Property(m => m.ValorAlvo).HasColumnType("decimal(12,2)");
            e.Property(m => m.Observacoes).HasMaxLength(500);
            e.HasIndex(m => m.UserId);
            e.HasOne<User>().WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(m => m.Aportes).WithOne().HasForeignKey(a => a.MetaId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<MetaAporte>(e =>
        {
            e.ToTable("financas_meta_aportes");
            e.Property(a => a.Valor).HasColumnType("decimal(12,2)");
            e.Property(a => a.Observacoes).HasMaxLength(500);
            e.HasIndex(a => a.MetaId);
            // Índice único filtrado: uma transação de investimento só pode alimentar
            // uma meta, mas vários aportes avulsos (TransacaoId nulo) convivem.
            e.HasIndex(a => a.TransacaoId).IsUnique().HasFilter("\"TransacaoId\" IS NOT NULL");
            e.HasOne<Transacao>().WithMany().HasForeignKey(a => a.TransacaoId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<TaskCategory>(e =>
        {
            e.ToTable("tasks_categories");
            e.Property(c => c.Name).IsRequired().HasMaxLength(100);
            e.Property(c => c.ColorHex).IsRequired().HasMaxLength(20);
            e.HasIndex(c => c.UserId);
            e.HasOne<User>().WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<KanbanLane>(e =>
        {
            e.ToTable("tasks_kanban_lanes");
            e.Property(l => l.Name).IsRequired().HasMaxLength(100);
            e.Property(l => l.ColorHex).IsRequired().HasMaxLength(20);
            e.HasIndex(l => new { l.UserId, l.Position });
            e.HasOne<User>().WithMany().HasForeignKey(l => l.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<TaskItem>(e =>
        {
            e.ToTable("tasks_items");
            e.Property(t => t.Title).IsRequired().HasMaxLength(300);
            e.Property(t => t.Priority).HasConversion<string>().HasMaxLength(20);
            e.Property(t => t.RecurrenceRule).HasMaxLength(100);
            e.Property(t => t.LocationLabel).HasMaxLength(300);
            e.Property(t => t.Subtasks).IsRequired();
            e.Property(t => t.CategoryIds).IsRequired();
            e.HasIndex(t => new { t.UserId, t.UpdatedAt });
            e.HasOne<User>().WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<KanbanLane>().WithMany().HasForeignKey(t => t.KanbanLaneId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<TaskComment>(e =>
        {
            e.ToTable("tasks_comments");
            e.Property(c => c.Text).IsRequired().HasMaxLength(2000);
            e.HasIndex(c => new { c.TaskId, c.CreatedAt });
            e.HasOne<User>().WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<TaskItem>().WithMany().HasForeignKey(c => c.TaskId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<TaskAttachment>(e =>
        {
            e.ToTable("tasks_attachments");
            e.Property(a => a.FileName).IsRequired().HasMaxLength(255);
            e.Property(a => a.ContentType).IsRequired().HasMaxLength(150);
            e.Property(a => a.DataBase64).IsRequired();
            e.HasIndex(a => a.TaskId);
            e.HasOne<User>().WithMany().HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<TaskItem>().WithMany().HasForeignKey(a => a.TaskId).OnDelete(DeleteBehavior.Cascade);
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
