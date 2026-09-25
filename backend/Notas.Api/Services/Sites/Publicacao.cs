using System.Diagnostics;
using System.Text;
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Notas.Api.Data;
using Notas.Api.Services.Seguranca;

namespace Notas.Api.Services.Sites;

public enum AcaoSite { Publicar, Reiniciar, Parar, Excluir }

public record TarefaSite(AcaoSite Acao, string SiteId, string? DeploymentId = null, bool RestaurarBanco = false)
{
    /// <summary>Concluída quando a tarefa termina: null = ok, senão a mensagem de erro.</summary>
    public TaskCompletionSource<string?> Conclusao { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
}

/// <summary>
/// Fila única de operações em sites. Um consumidor só: duas publicações do mesmo site
/// nunca disputam o container, o link "current" ou o banco.
/// </summary>
public class FilaSites
{
    private readonly Channel<TarefaSite> _canal = Channel.CreateUnbounded<TarefaSite>(new UnboundedChannelOptions { SingleReader = true });

    public TarefaSite Enfileirar(TarefaSite tarefa)
    {
        _canal.Writer.TryWrite(tarefa);
        return tarefa;
    }

    public ChannelReader<TarefaSite> Leitor => _canal.Reader;
}

public class PublicacaoWorker(FilaSites fila, IServiceScopeFactory scopes, ILogger<PublicacaoWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await foreach (var tarefa in fila.Leitor.ReadAllAsync(ct))
        {
            try
            {
                using var scope = scopes.CreateScope();
                var executor = scope.ServiceProvider.GetRequiredService<ExecutorSites>();
                tarefa.Conclusao.TrySetResult(await executor.ExecutarAsync(tarefa, ct));
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                tarefa.Conclusao.TrySetResult("Servidor desligando.");
                return;
            }
            catch (Exception e)
            {
                logger.LogError(e, "Falha na tarefa {Acao} do site {SiteId}", tarefa.Acao, tarefa.SiteId);
                tarefa.Conclusao.TrySetResult(e.Message);
            }
        }
    }
}

public class ExecutorSites(
    AppDbContext db,
    SitesArmazenamento disco,
    IDeployer deployer,
    IVerificadorSaude saude,
    IProtetorDeSegredos protetor,
    IPostgresProvisionador postgres,
    IOptions<SitesOptions> options,
    ILogger<ExecutorSites> logger)
{
    private const int MaxLog = 64 * 1024;
    private readonly SitesOptions _opt = options.Value;

    public async Task<string?> ExecutarAsync(TarefaSite t, CancellationToken ct)
    {
        var site = await db.Sites.FirstOrDefaultAsync(s => s.Id == t.SiteId, ct);
        if (site is null) return "Site não encontrado.";

        return t.Acao switch
        {
            AcaoSite.Publicar => await PublicarAsync(site, t.DeploymentId!, t.RestaurarBanco, ct),
            AcaoSite.Reiniciar => await ReiniciarAsync(site, ct),
            AcaoSite.Parar => await PararAsync(site, ct),
            AcaoSite.Excluir => await ExcluirAsync(site, ct),
            _ => "Ação desconhecida.",
        };
    }

    private async Task<string?> PublicarAsync(Site site, string deploymentId, bool restaurarBanco, CancellationToken ct)
    {
        var dep = await db.Deployments.FirstOrDefaultAsync(d => d.Id == deploymentId && d.SiteId == site.Id, ct);
        if (dep is null) return "Versão não encontrada.";
        var atual = site.CurrentDeploymentId is { } cid && cid != dep.Id
            ? await db.Deployments.FirstOrDefaultAsync(d => d.Id == cid, ct)
            : null;

        var log = new Linha(dep.Log);
        var relogio = Stopwatch.StartNew();
        dep.Status = DeploymentStatus.Iniciando;
        dep.TerminadoEm = null;
        log.Add(atual is null ? $"Publicando v{dep.Versao}." : $"Publicando v{dep.Versao} (no ar: v{atual.Versao}).");
        dep.Log = log.Texto;
        await db.SaveChangesAsync(ct);

        // Antes de mexer em qualquer coisa: cópia do SQLite e pg_dump do Postgres. Se o
        // backup falha, o deploy para aqui — a versão no ar nem é tocada.
        if (dep.Tipo == DeploymentTipo.DotNet && !restaurarBanco)
        {
            var erroBackup = await FazerBackupsAsync(site, dep, log, ct);
            if (erroBackup is not null)
            {
                erroBackup = "backup do banco falhou, nada foi trocado: " + erroBackup;
                dep.Status = DeploymentStatus.Falhou;
                log.Add("Falhou: " + erroBackup);
                dep.TerminadoEm = DateTime.UtcNow;
                dep.Log = log.Texto;
                await db.SaveChangesAsync(ct);
                return erroBackup;
            }
        }

        string? erro;
        try
        {
            if (dep.Tipo == DeploymentTipo.DotNet && restaurarBanco)
            {
                if (atual is { TemBackupBanco: true } or { TemBackupPostgres: true })
                {
                    await deployer.RemoverAsync(site.Slug, ct);
                    await RestaurarBancosAsync(site, atual, log, ct);
                }
                else
                {
                    log.Add("Não há cópia do banco de antes da versão atual: o banco fica como está.");
                }
            }
            erro = await SubirAsync(site, dep, log, ct);
        }
        catch (Exception e) when (e is DeployerException or IOException or UnauthorizedAccessException
            or Microsoft.Data.Sqlite.SqliteException or ProvisionamentoPostgresException)
        {
            erro = e.Message;
        }

        if (erro is null)
        {
            var outros = await db.Deployments
                .Where(d => d.SiteId == site.Id && d.Id != dep.Id && d.Status == DeploymentStatus.NoAr)
                .ToListAsync(ct);
            foreach (var o in outros) o.Status = DeploymentStatus.Substituido;
            dep.Status = DeploymentStatus.NoAr;
            site.CurrentDeploymentId = dep.Id;
            site.Parado = false;
            log.Add($"No ar em {relogio.Elapsed.TotalSeconds:0.0} s: {_opt.Url(site.Slug)}");
        }
        else
        {
            dep.Status = DeploymentStatus.Falhou;
            log.Add("Falhou: " + erro);
            // A versão nova pode ter rodado migrations antes de cair: o banco volta junto,
            // senão a versão anterior sobe contra um schema que não conhece.
            if (!restaurarBanco && (dep.TemBackupBanco || dep.TemBackupPostgres))
            {
                var erroBanco = await TentarAsync(async () =>
                {
                    await deployer.RemoverAsync(site.Slug, ct);
                    await RestaurarBancosAsync(site, dep, log, ct);
                    return null;
                });
                if (erroBanco is not null) log.Add("Não consegui restaurar o banco: " + erroBanco);
            }
            if (atual is not null && !site.Parado)
            {
                log.Add($"Voltando para a v{atual.Versao}.");
                var erroVolta = await TentarAsync(() => SubirAsync(site, atual, new Linha(""), ct));
                log.Add(erroVolta is null ? $"v{atual.Versao} de volta no ar." : $"A v{atual.Versao} também não subiu: {erroVolta}");
                if (erroVolta is not null) atual.Status = DeploymentStatus.Falhou;
            }
            else
            {
                await TentarAsync(async () => { await deployer.RemoverAsync(site.Slug, ct); disco.Desativar(site.Slug); return null; });
            }
        }

        dep.TerminadoEm = DateTime.UtcNow;
        dep.Log = log.Texto;
        await db.SaveChangesAsync(ct);
        if (erro is null) await LimparVersoesAntigasAsync(site, ct);
        return erro;
    }

    /// <summary>Cópia do SQLite e pg_dump do Postgres, guardados com o id da versão que vai entrar.</summary>
    private async Task<string?> FazerBackupsAsync(Site site, Deployment dep, Linha log, CancellationToken ct)
    {
        dep.TemBackupBanco = false;
        dep.TemBackupPostgres = false;
        try
        {
            disco.PrepararDados(site.Slug);
            dep.TemBackupBanco = disco.CopiarBanco(site.Slug, dep.Id);
            if (dep.TemBackupBanco) log.Add("Cópia do banco SQLite feita antes da troca.");

            if (site.PostgresBanco is { } banco)
            {
                var destino = disco.ArquivoBackupPostgres(site.Slug, dep.Id);
                Directory.CreateDirectory(Path.GetDirectoryName(destino)!);
                var temporario = destino + ".tmp";
                await using (var arquivo = File.Create(temporario))
                    await deployer.DumpPostgresAsync(banco, arquivo, ct);
                File.Move(temporario, destino, overwrite: true);
                dep.TemBackupPostgres = true;
                log.Add($"pg_dump de {banco} feito antes da troca ({new FileInfo(destino).Length / 1024.0:0.#} KB).");
            }
            return null;
        }
        catch (Exception e) when (e is DeployerException or IOException or UnauthorizedAccessException or Microsoft.Data.Sqlite.SqliteException)
        {
            return e.Message;
        }
    }

    /// <summary>
    /// Devolve os bancos ao estado guardado antes de "origem" entrar no ar. O container já
    /// precisa estar parado: um app de pé recriaria as tabelas no banco vazio antes do restore.
    /// </summary>
    private async Task RestaurarBancosAsync(Site site, Deployment origem, Linha log, CancellationToken ct)
    {
        if (origem.TemBackupBanco && disco.RestaurarBanco(site.Slug, origem.Id))
            log.Add($"Banco SQLite devolvido ao estado de antes da v{origem.Versao}.");

        var dump = disco.ArquivoBackupPostgres(site.Slug, origem.Id);
        if (origem.TemBackupPostgres && site.PostgresBanco is { } banco && File.Exists(dump))
        {
            await postgres.RecriarBancoAsync(banco, ct);
            await using var arquivo = File.OpenRead(dump);
            await deployer.RestaurarPostgresAsync(banco, arquivo, ct);
            log.Add($"Banco Postgres {banco} devolvido ao estado de antes da v{origem.Versao} (pg_restore).");
        }
    }

    /// <summary>Coloca a versão no ar: troca o link e, se tiver API, (re)cria o container e espera ele responder.</summary>
    private async Task<string?> SubirAsync(Site site, Deployment dep, Linha log, CancellationToken ct)
    {
        if (!Directory.Exists(disco.PastaDeploy(site.Slug, dep.Id)))
            return $"Os arquivos da v{dep.Versao} não estão mais no disco.";

        if (dep.Tipo == DeploymentTipo.Estatico)
        {
            disco.Ativar(site.Slug, dep.Id);
            await deployer.RemoverAsync(site.Slug, ct);
            log.Add("Site estático: arquivos no ar, sem container.");
            return null;
        }

        var rodando = await deployer.RodandoAsync(ct);
        if (!rodando.Contains(site.Slug) && rodando.Count >= _opt.MaxAppsRodando)
            return $"Já há {rodando.Count} apps rodando (limite {_opt.MaxAppsRodando}). Pare algum antes.";

        disco.PrepararDados(site.Slug);
        disco.Ativar(site.Slug, dep.Id);
        var variaveis = await VariaveisAsync(site, ct);
        log.Add($"Subindo container .NET {dep.RuntimeVersao} ({dep.Entrada}, {dep.MemoriaMb} MB).");
        await deployer.IniciarAsync(site.Slug, new IniciarApp(dep.Id, dep.Entrada!, dep.RuntimeVersao!, dep.MemoriaMb, variaveis), ct);

        var caminho = dep.Health ?? (dep.TemWeb ? "/api/" : "/");
        var limite = DateTime.UtcNow.AddSeconds(_opt.HealthTimeoutSegundos);
        string? falha;
        while (true)
        {
            falha = await saude.VerificarAsync(site.Slug, caminho, exige2xx: dep.Health is not null, ct);
            if (falha is null || DateTime.UtcNow >= limite) break;
            await Task.Delay(TimeSpan.FromSeconds(1), ct);
        }
        if (falha is null)
        {
            log.Add($"Respondeu em {caminho}.");
            return null;
        }

        var logs = await TentarTextoAsync(() => deployer.LogsAsync(site.Slug, 60, ct));
        if (!string.IsNullOrWhiteSpace(logs)) log.Add("Últimas linhas do container:\n" + logs.TrimEnd());
        return $"o app não respondeu em {_opt.HealthTimeoutSegundos} s ({falha}).";
    }

    private async Task<string?> ReiniciarAsync(Site site, CancellationToken ct)
    {
        if (site.CurrentDeploymentId is null) return "O site ainda não tem versão publicada.";
        var dep = await db.Deployments.FirstAsync(d => d.Id == site.CurrentDeploymentId, ct);
        var log = new Linha(dep.Log);
        log.Add("Reiniciando.");
        var erro = await TentarAsync(() => SubirAsync(site, dep, log, ct));
        dep.Status = erro is null ? DeploymentStatus.NoAr : DeploymentStatus.Falhou;
        log.Add(erro is null ? "No ar." : "Falhou: " + erro);
        dep.Log = log.Texto;
        site.Parado = erro is not null;
        if (erro is not null) await TentarAsync(async () => { await deployer.RemoverAsync(site.Slug, ct); return null; });
        await db.SaveChangesAsync(ct);
        return erro;
    }

    private async Task<string?> PararAsync(Site site, CancellationToken ct)
    {
        var erro = await TentarAsync(async () => { await deployer.RemoverAsync(site.Slug, ct); return null; });
        if (erro is not null) return erro;
        disco.Desativar(site.Slug);
        site.Parado = true;
        await db.SaveChangesAsync(ct);
        return null;
    }

    private async Task<string?> ExcluirAsync(Site site, CancellationToken ct)
    {
        var erro = await TentarAsync(async () => { await deployer.RemoverAsync(site.Slug, ct); return null; });
        if (erro is not null) return erro;
        if (site.PostgresBanco is { } banco)
        {
            try { await postgres.RemoverAsync(banco, ct); }
            catch (ProvisionamentoPostgresException e) { return "Não consegui apagar o banco Postgres: " + e.Message; }
        }
        disco.ApagarSite(site.Slug);
        db.Sites.Remove(site);
        await db.SaveChangesAsync(ct);
        return null;
    }

    private async Task LimparVersoesAntigasAsync(Site site, CancellationToken ct)
    {
        var antigas = await db.Deployments
            .Where(d => d.SiteId == site.Id && d.Id != site.CurrentDeploymentId)
            .OrderByDescending(d => d.Versao)
            .Skip(Math.Max(0, _opt.VersoesGuardadas - 1))
            .ToListAsync(ct);
        foreach (var d in antigas)
        {
            try { disco.ApagarVersao(site.Slug, d.Id); }
            catch (IOException e) { logger.LogWarning(e, "Não apaguei a versão {Id}", d.Id); continue; }
            db.Deployments.Remove(d);
        }
        await db.SaveChangesAsync(ct);
    }

    private async Task<Dictionary<string, string>> VariaveisAsync(Site site, CancellationToken ct)
    {
        var lista = await db.SiteVariaveis.AsNoTracking().Where(v => v.SiteId == site.Id).ToListAsync(ct);
        var r = new Dictionary<string, string>();
        foreach (var v in lista)
            if (protetor.Desproteger(v.ValorCifrado) is { } valor) r[v.Chave] = valor;
        // As do Postgres por último: vencem qualquer variável do usuário com o mesmo nome.
        if (site.PostgresBanco is { } banco && site.PostgresSenhaCifrada is { } cifrada && protetor.Desproteger(cifrada) is { } senha)
            foreach (var (k, v) in PostgresNomes.Variaveis(_opt, banco, senha)) r[k] = v;
        return r;
    }

    private static async Task<string?> TentarAsync(Func<Task<string?>> acao)
    {
        try { return await acao(); }
        catch (Exception e) when (e is DeployerException or IOException or UnauthorizedAccessException
            or ProvisionamentoPostgresException or Microsoft.Data.Sqlite.SqliteException) { return e.Message; }
    }

    private static async Task<string> TentarTextoAsync(Func<Task<string>> acao)
    {
        try { return await acao(); }
        catch (DeployerException) { return ""; }
    }

    /// <summary>Log com horário, cortado no começo quando passa do teto.</summary>
    private sealed class Linha(string inicial)
    {
        private readonly StringBuilder _sb = new(inicial);

        public void Add(string texto)
        {
            if (_sb.Length > 0) _sb.Append('\n');
            _sb.Append('[').Append(DateTime.UtcNow.ToString("HH:mm:ss")).Append("] ").Append(texto);
        }

        public string Texto => _sb.Length <= MaxLog ? _sb.ToString() : _sb.ToString(_sb.Length - MaxLog, MaxLog);
    }
}
