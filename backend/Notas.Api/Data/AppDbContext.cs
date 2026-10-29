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
    public DbSet<ConfiguracaoIa> ConfiguracoesIa => Set<ConfiguracaoIa>();
    public DbSet<ConfiguracaoAuvp> ConfiguracoesAuvp => Set<ConfiguracaoAuvp>();
    public DbSet<TransacaoExcluida> TransacoesExcluidas => Set<TransacaoExcluida>();
    public DbSet<RegraCategoria> RegrasCategoria => Set<RegraCategoria>();
    public DbSet<PreferenciasFinancas> PreferenciasFinancas => Set<PreferenciasFinancas>();
    public DbSet<Divida> Dividas => Set<Divida>();
    public DbSet<ProvisaoAnual> ProvisoesAnuais => Set<ProvisaoAnual>();
    public DbSet<FechamentoMes> FechamentosMes => Set<FechamentoMes>();
    public DbSet<TaskCategory> TaskCategories => Set<TaskCategory>();
    public DbSet<TaskItem> TaskItems => Set<TaskItem>();
    public DbSet<TaskComment> TaskComments => Set<TaskComment>();
    public DbSet<TaskAttachment> TaskAttachments => Set<TaskAttachment>();
    public DbSet<TaskProject> TaskProjects => Set<TaskProject>();
    public DbSet<KanbanLane> KanbanLanes => Set<KanbanLane>();
    public DbSet<TaskProjectMembership> TaskProjectMemberships => Set<TaskProjectMembership>();
    public DbSet<ImageProject> ImageProjects => Set<ImageProject>();
    public DbSet<ImageLibraryItem> ImageLibrary => Set<ImageLibraryItem>();
    public DbSet<ImagePreferences> ImagePreferences => Set<ImagePreferences>();
    public DbSet<ImageSocialTemplate> ImageSocialTemplates => Set<ImageSocialTemplate>();
    public DbSet<Site> Sites => Set<Site>();
    public DbSet<Deployment> Deployments => Set<Deployment>();
    public DbSet<SiteVariavel> SiteVariaveis => Set<SiteVariavel>();
    public DbSet<DietaPerfil> DietaPerfis => Set<DietaPerfil>();
    public DbSet<DietaAlimento> DietaAlimentos => Set<DietaAlimento>();
    public DbSet<DietaRegistro> DietaRegistros => Set<DietaRegistro>();
    public DbSet<DietaPeso> DietaPesos => Set<DietaPeso>();
    public DbSet<DietaAgua> DietaAguas => Set<DietaAgua>();
    public DbSet<DietaPlanoItem> DietaPlano => Set<DietaPlanoItem>();
    public DbSet<DietaFoto> DietaFotos => Set<DietaFoto>();
    public DbSet<DietaCompartilhamento> DietaCompartilhamentos => Set<DietaCompartilhamento>();
    public DbSet<TreinoAtividade> TreinoAtividades => Set<TreinoAtividade>();
    public DbSet<TreinoPlano> TreinoPlanos => Set<TreinoPlano>();
    public DbSet<AcaoOperacao> AcaoOperacoes => Set<AcaoOperacao>();

    // SQLite não guarda DateTimeKind — toda leitura do banco volta com Kind=Unspecified, mesmo
    // que o valor gravado fosse UTC. Sem isso, o JSON de uma entidade recém-criada (ainda em
    // memória) sai com "Z" no fim, mas a mesma entidade relida do banco (ex.: próximo GET) sai
    // sem "Z" — inconsistência que quebra parsers estritos de ISO 8601 como o do Android
    // (java.time.Instant.parse exige "Z"/offset). Força Kind=Utc em toda leitura, pra todo
    // DateTime/DateTime? do modelo, deixando a serialização sempre consistente.
    // Competência vazia = mês da data. Fica aqui, e não em cada lugar que cria
    // lançamento, para nenhum caminho (texto, arquivo, banco, teste) esquecer.
    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        PreencherCompetencia();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        PreencherCompetencia();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    private void PreencherCompetencia()
    {
        foreach (var entrada in ChangeTracker.Entries<Transacao>())
        {
            if (entrada.State is EntityState.Added or EntityState.Modified && entrada.Entity.Competencia == default)
                entrada.Entity.Competencia = Transacao.CompetenciaDe(entrada.Entity.Data);
        }
    }

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

        b.Entity<DietaPerfil>(e =>
        {
            e.ToTable("dieta_perfis");
            e.HasKey(x => x.UserId);
            e.Property(x => x.Sexo).HasMaxLength(1);
            e.Property(x => x.Objetivo).HasMaxLength(10);
            e.HasOne<User>().WithOne().HasForeignKey<DietaPerfil>(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<DietaAlimento>(e =>
        {
            e.ToTable("dieta_alimentos");
            e.Property(x => x.Nome).IsRequired().HasMaxLength(200);
            e.Property(x => x.Fonte).HasMaxLength(10);
            e.Property(x => x.CodigoBarras).HasMaxLength(32);
            e.HasIndex(x => new { x.UserId, x.UpdatedAt });
            e.HasIndex(x => new { x.UserId, x.CodigoBarras });
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<DietaRegistro>(e =>
        {
            e.ToTable("dieta_registros");
            e.Property(x => x.Nome).IsRequired().HasMaxLength(200);
            e.Property(x => x.Refeicao).HasMaxLength(10);
            e.HasIndex(x => new { x.UserId, x.Data });
            e.HasIndex(x => new { x.UserId, x.UpdatedAt });
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<TreinoAtividade>(e =>
        {
            e.ToTable("treino_atividades");
            e.Property(x => x.Titulo).IsRequired().HasMaxLength(200);
            e.Property(x => x.Tipo).HasMaxLength(10);
            e.Property(x => x.Meta).HasMaxLength(200);
            e.Property(x => x.Nota).HasMaxLength(2000);
            e.HasIndex(x => new { x.UserId, x.Inicio });
            e.HasIndex(x => new { x.UserId, x.UpdatedAt });
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<AcaoOperacao>(e =>
        {
            e.ToTable("acoes_operacoes");
            e.Property(x => x.Ticker).IsRequired().HasMaxLength(12);
            e.Property(x => x.Tipo).HasMaxLength(10);
            e.Property(x => x.Quantidade).HasColumnType("decimal(18,6)");
            e.Property(x => x.PrecoUnitario).HasColumnType("decimal(18,6)");
            e.Property(x => x.Taxas).HasColumnType("decimal(14,2)");
            e.Property(x => x.Observacoes).HasMaxLength(500);
            e.HasIndex(x => new { x.UserId, x.Ticker });
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<TreinoPlano>(e =>
        {
            e.ToTable("treino_planos");
            e.HasKey(x => x.UserId);
            e.Property(x => x.Programa).IsRequired().HasMaxLength(200);
            e.Property(x => x.ProximaSessao).HasMaxLength(200);
            e.HasOne<User>().WithOne().HasForeignKey<TreinoPlano>(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<DietaPeso>(e =>
        {
            e.ToTable("dieta_pesos");
            e.HasIndex(x => new { x.UserId, x.Data });
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<DietaAgua>(e =>
        {
            e.ToTable("dieta_agua");
            e.HasIndex(x => new { x.UserId, x.Data });
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<DietaPlanoItem>(e =>
        {
            e.ToTable("dieta_plano");
            e.Property(x => x.Nome).IsRequired().HasMaxLength(200);
            e.Property(x => x.Refeicao).HasMaxLength(10);
            e.HasIndex(x => x.UserId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<DietaFoto>(e =>
        {
            e.ToTable("dieta_fotos");
            e.Property(x => x.Tipo).HasMaxLength(10);
            e.Property(x => x.Rotulo).HasMaxLength(10);
            e.Property(x => x.ContentType).HasMaxLength(50);
            e.HasIndex(x => new { x.UserId, x.Data });
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<DietaCompartilhamento>(e =>
        {
            e.ToTable("dieta_compartilhamentos");
            e.Property(x => x.Token).IsRequired().HasMaxLength(64);
            e.Property(x => x.Titulo).HasMaxLength(100);
            e.Property(x => x.Escopos).HasMaxLength(200);
            e.HasIndex(x => x.Token).IsUnique();
            e.HasIndex(x => x.UserId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
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

        b.Entity<ImageProject>(e =>
        {
            e.ToTable("imagem_projetos");
            e.Property(p => p.Name).IsRequired().HasMaxLength(300);
            e.Property(p => p.Data).IsRequired();
            e.HasIndex(p => new { p.UserId, p.UpdatedAt });
            e.HasOne<User>().WithMany().HasForeignKey(p => p.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ImagePreferences>(e =>
        {
            e.ToTable("imagem_preferencias");
            e.HasKey(p => p.UserId);
            e.Property(p => p.Data).IsRequired();
            e.HasOne<User>().WithOne().HasForeignKey<ImagePreferences>(p => p.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ImageSocialTemplate>(e =>
        {
            e.ToTable("imagem_modelos");
            e.Property(t => t.Name).IsRequired().HasMaxLength(120);
            e.Property(t => t.Group).HasMaxLength(20);
            e.Property(t => t.Replaces).HasMaxLength(64);
            e.Property(t => t.Data).IsRequired();
            e.Property(t => t.Thumb).IsRequired();
            e.HasIndex(t => new { t.UserId, t.UpdatedAt });
            e.HasOne<User>().WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ImageLibraryItem>(e =>
        {
            e.ToTable("imagem_biblioteca");
            e.Property(i => i.Name).IsRequired().HasMaxLength(200);
            e.Property(i => i.Origin).HasMaxLength(20);
            e.Property(i => i.Data).IsRequired();
            e.Property(i => i.Thumb).IsRequired();
            e.HasIndex(i => new { i.UserId, i.UpdatedAt });
            e.HasOne<User>().WithMany().HasForeignKey(i => i.UserId).OnDelete(DeleteBehavior.Cascade);
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
            e.Property(t => t.OrigemExterna).HasMaxLength(20);
            e.Property(t => t.IdExterno).HasMaxLength(64);
            // Lançamentos digitados têm origem nula e não entram na unicidade (NULLs
            // são distintos no SQLite); os importados não podem se repetir.
            e.HasIndex(t => new { t.UserId, t.OrigemExterna, t.IdExterno }).IsUnique();
            e.HasIndex(t => new { t.UserId, t.Competencia });
            e.Property(t => t.Conta).HasMaxLength(120);
            e.Property(t => t.Tags).HasMaxLength(500);
            e.Property(t => t.OrcamentoAuvp).HasMaxLength(40);
            e.HasOne<User>().WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<TransacaoExcluida>(e =>
        {
            e.ToTable("financas_transacoes_excluidas");
            e.Property(x => x.Origem).HasMaxLength(20);
            e.Property(x => x.IdExterno).HasMaxLength(64);
            e.HasIndex(x => new { x.UserId, x.Origem, x.IdExterno }).IsUnique();
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<RegraCategoria>(e =>
        {
            e.ToTable("financas_regras_categoria");
            e.Property(x => x.Chave).HasMaxLength(120);
            e.Property(x => x.Categoria).HasConversion<string>().HasMaxLength(30);
            e.HasIndex(x => new { x.UserId, x.Chave }).IsUnique();
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<PreferenciasFinancas>(e =>
        {
            e.ToTable("financas_preferencias");
            e.Property(x => x.Metodo).HasMaxLength(20);
            e.Property(x => x.PercentualPagueSePrimeiro).HasColumnType("decimal(5,2)");
            e.Property(x => x.PatrimonioInvestido).HasColumnType("decimal(14,2)");
            e.Property(x => x.SaldoInicialFluxo).HasColumnType("decimal(14,2)");
            e.HasIndex(x => x.UserId).IsUnique();
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Divida>(e =>
        {
            e.ToTable("financas_dividas");
            e.Property(x => x.Nome).HasMaxLength(120);
            e.Property(x => x.Saldo).HasColumnType("decimal(14,2)");
            e.Property(x => x.JurosMensal).HasColumnType("decimal(6,3)");
            e.Property(x => x.ParcelaMinima).HasColumnType("decimal(14,2)");
            e.HasIndex(x => x.UserId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ProvisaoAnual>(e =>
        {
            e.ToTable("financas_provisoes");
            e.Property(x => x.Nome).HasMaxLength(120);
            e.Property(x => x.Valor).HasColumnType("decimal(14,2)");
            e.Property(x => x.ValorReservado).HasColumnType("decimal(14,2)");
            e.HasIndex(x => x.UserId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<FechamentoMes>(e =>
        {
            e.ToTable("financas_fechamentos");
            e.Property(x => x.MetaPoupanca).HasColumnType("decimal(14,2)");
            e.Property(x => x.Reflexao).HasMaxLength(2000);
            e.Property(x => x.Compromisso).HasMaxLength(2000);
            e.HasIndex(x => new { x.UserId, x.Ano, x.Mes }).IsUnique();
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
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

        b.Entity<ConfiguracaoAuvp>(e =>
        {
            e.ToTable("configuracoes_auvp");
            e.Property(c => c.ChaveSufixo).HasMaxLength(8);
            e.HasIndex(c => c.UserId).IsUnique();
            e.HasOne<User>().WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<TaskCategory>(e =>
        {
            e.ToTable("tasks_categories");
            e.Property(c => c.Name).IsRequired().HasMaxLength(100);
            e.Property(c => c.ColorHex).IsRequired().HasMaxLength(20);
            e.HasIndex(c => c.UserId);
            e.HasOne<User>().WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<TaskProject>(e =>
        {
            e.ToTable("tasks_projects");
            e.Property(p => p.Name).IsRequired().HasMaxLength(100);
            e.Property(p => p.ColorHex).IsRequired().HasMaxLength(20);
            e.HasIndex(p => p.UserId);
            e.HasOne<User>().WithMany().HasForeignKey(p => p.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<KanbanLane>(e =>
        {
            e.ToTable("tasks_kanban_lanes");
            e.Property(l => l.Name).IsRequired().HasMaxLength(100);
            e.Property(l => l.ColorHex).IsRequired().HasMaxLength(20);
            e.HasIndex(l => new { l.ProjectId, l.Position });
            e.HasOne<User>().WithMany().HasForeignKey(l => l.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<TaskProject>().WithMany().HasForeignKey(l => l.ProjectId).OnDelete(DeleteBehavior.Cascade);
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
        });

        b.Entity<TaskProjectMembership>(e =>
        {
            e.ToTable("tasks_project_memberships");
            e.HasIndex(m => new { m.TaskId, m.ProjectId }).IsUnique();
            e.HasIndex(m => new { m.ProjectId, m.Position });
            e.HasOne<User>().WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<TaskItem>().WithMany().HasForeignKey(m => m.TaskId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<TaskProject>().WithMany().HasForeignKey(m => m.ProjectId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<KanbanLane>().WithMany().HasForeignKey(m => m.KanbanLaneId).OnDelete(DeleteBehavior.SetNull);
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
