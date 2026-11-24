using System.Text.Json;
using System.Text.RegularExpressions;
using Hub.Plugin;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Notas.Api.Data;
using Notas.Api.Endpoints;
using Notas.Api.Services.Plugins;
using Notas.Api.Services.Sites;

namespace Notas.Api.Services.Painel;

public record PainelDePlugins(List<PluginNoPainel> Plugins, RecursosDoPainel Recursos, List<string> Avisos);

public record VersaoDisponivel(string Versao, string Mensagem, DateTime? Data);

/// <summary>
/// Junta as fontes do painel (spec 040, R6): registro, estado do deployer, GitHub e banco. Cada fonte tem prazo; a que
/// falha vira "não conferida" e as outras continuam.
/// </summary>
public partial class ListaDoPainel(AppDbContext db, IOptions<PluginsOptions> plugins, IOptions<PainelOptions> painel,
    IGithubDoPainel github, IDeployerDoPainel deployer, ILogger<ListaDoPainel> log)
{
    /// <summary>Teto da lista inteira (SC-002: 10 s na tela).</summary>
    public static readonly TimeSpan Prazo = TimeSpan.FromSeconds(8);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [GeneratedRegex(@"^(?<id>[a-z][a-z0-9-]*)\s*:\s*[a-z0-9./_-]+@(?<ver>[A-Za-z0-9._-]+)$")] private static partial Regex Linha();

    /// <summary>A mesma leitura do deployer: linha ativa ganha da comentada com o mesmo id.</summary>
    public static List<LinhaDoLock> LerLock(string texto)
    {
        var l = new List<LinhaDoLock>();
        foreach (var bruta in texto.Split('\n'))
        {
            var t = bruta.Trim();
            var ativo = !t.StartsWith('#');
            var m = Linha().Match(t.TrimStart('#').Trim().Split('#', 2)[0].Trim());
            if (m.Success) l.Add(new LinhaDoLock(m.Groups["id"].Value, m.Groups["ver"].Value, ativo));
        }
        return l.GroupBy(x => x.Id).Select(g => g.FirstOrDefault(x => x.Ativo) ?? g.First()).ToList();
    }

    public async Task<PainelDePlugins> Listar(CancellationToken ct)
    {
        using var prazo = CancellationTokenSource.CreateLinkedTokenSource(ct);
        prazo.CancelAfter(Prazo);
        // A lista de repositórios não pode gastar o tempo das outras fontes.
        using var prazoDaLista = CancellationTokenSource.CreateLinkedTokenSource(prazo.Token);
        prazoDaLista.CancelAfter(Prazo / 2);

        var avisos = painel.Value.Avisos(DateOnly.FromDateTime(DateTime.UtcNow));
        var (linhas, lockLido) = await Registro(ct);
        if (!lockLido) avisos.Add("Não deu para ler o registro (plugins.lock).");
        var estados = await Estados(ct);
        if (estados is null) avisos.Add("Não deu para ler o estado do deployer.");
        var saude = await db.PluginsEstado.AsNoTracking().Where(p => p.UltimoHealth != null).ToDictionaryAsync(p => p.Id, p => p.NoAr, ct);

        var recursos = Tentar("recursos", async t => await deployer.RecursosAsync(t), prazo.Token);
        var repositorios = github.Ligado ? Tentar("repositórios", async t => await github.IdsAsync(t), prazoDaLista.Token) : Task.FromResult<List<string>?>(null);
        await Task.WhenAll(recursos, repositorios);
        if (recursos.Result is null) avisos.Add("O deployer não respondeu: memória, banco e imagens não foram conferidos.");
        if (github.Ligado && repositorios.Result is null) avisos.Add("O GitHub não respondeu: ferramentas fora do registro podem não aparecer.");

        var ids = linhas.Where(l => l.Ativo || !GithubDoPainel.ForaDaLista.Contains(l.Id)).Select(l => l.Id)
            .Concat(repositorios.Result ?? []).Distinct().Order(StringComparer.Ordinal).ToList();
        var ativos = (estados?.Values ?? Enumerable.Empty<EstadoDoDeployer>())
            .Where(e => e is { Ativo: true, Manifesto: not null }).Select(e => e.Manifesto!).ToList();

        using var vagas = new SemaphoreSlim(6);
        var lista = await Task.WhenAll(ids.Select(async id =>
        {
            var f = new FontesDoPlugin(id)
            {
                Lock = linhas.FirstOrDefault(l => l.Id == id),
                LockLido = lockLido,
                Estado = estados?.GetValueOrDefault(id),
                Health = saude.TryGetValue(id, out var ok) ? ok : null,
                MemoriaMb = recursos.Result?.Plugins?.FirstOrDefault(p => p.Id == id)?.MemoriaMb,
                LimiteMb = recursos.Result?.Plugins?.FirstOrDefault(p => p.Id == id)?.LimiteMb,
            };
            return SituacaoDoPlugin.Calcular(await Completar(f, ativos, recursos.Result is not null, vagas, prazo.Token));
        }));
        ct.ThrowIfCancellationRequested();
        return new PainelDePlugins([.. lista], RecursosLivres.Calcular(recursos.Result, linhas.Count(l => l.Ativo)), avisos);
    }

    /// <summary>Até 10 commits da <c>main</c> com CI verde e imagem publicada. Nulo = id fora do registro e dos repositórios.</summary>
    public async Task<List<VersaoDisponivel>?> Versoes(string id, CancellationToken ct)
    {
        if (!RegrasDoManifesto.IdPermitido(id)) return null;
        if (!(await Registro(ct)).Linhas.Any(l => l.Id == id) && !(await github.IdsAsync(ct)).Contains(id)) return null;
        var commits = github.CommitsAsync(id, ct);
        var ci = github.CiAsync(id, ct);
        await Task.WhenAll(commits, ci);
        var verdes = commits.Result.Where(c => ci.Result.GetValueOrDefault(c.Versao)?.Estado == Etapas.Feita).Take(10).ToList();
        using var vagas = new SemaphoreSlim(4);
        var publicadas = await Task.WhenAll(verdes.Select(c => ComVaga(vagas, t => deployer.ImagemAsync(id, c.Versao, t), ct)));
        return verdes.Where((_, i) => publicadas[i]).Select(c => new VersaoDisponivel(c.Versao, c.Mensagem, c.Data)).ToList();
    }

    /// <summary>Fontes caras, só para quem não está no ar: banco, e o GitHub para quem está fora do registro ou desligado.</summary>
    private async Task<FontesDoPlugin> Completar(FontesDoPlugin f, List<Manifesto> ativos, bool deployerNoAr, SemaphoreSlim vagas, CancellationToken ct)
    {
        var ligado = f.Lock is { Ativo: true };
        if (ligado && (f.Health ?? f.Estado?.NoAr ?? false)) return f;
        var id = f.Id;
        var valido = RegrasDoManifesto.IdPermitido(id);
        var preparo = valido && deployerNoAr ? Tentar($"banco de {id}", t => ComVaga(vagas, x => deployer.PreparoAsync(id, x), t), ct) : Nada<PreparoDoPlugin>();
        if (ligado || !valido || !github.Ligado) return f with { Preparo = await preparo };

        var commits = Tentar($"commits de {id}", t => ComVaga(vagas, x => github.CommitsAsync(id, x), t), ct);
        var ci = Tentar($"CI de {id}", t => ComVaga(vagas, x => github.CiAsync(id, x), t), ct);
        await Task.WhenAll(preparo, commits, ci);
        // Desligado volta na versão do registro; o novo usa a ponta da main.
        var versao = f.Lock?.Versao ?? commits.Result?.FirstOrDefault()?.Versao;
        f = f with
        {
            Preparo = preparo.Result,
            Candidato = versao,
            Ci = ci.Result is null || versao is null ? null : ci.Result.GetValueOrDefault(versao)?.Estado ?? (f.Lock is null ? Etapas.Pendente : null),
        };
        if (versao is null) return f;

        var manifesto = Tentar($"manifesto de {id}", async t => new Lido(await ComVaga(vagas, x => github.ManifestoAsync(id, versao, x), t)), ct);
        var imagem = deployerNoAr
            ? Tentar($"imagem de {id}", async t => (object)await ComVaga(vagas, x => deployer.ImagemAsync(id, versao, x), t), ct)
            : Nada<object>();
        await Task.WhenAll(manifesto, imagem);
        f = f with { Imagem = imagem.Result as bool? };
        if (manifesto.Result is not { } lido) return f;
        var m = lido.Texto is null ? null : RegrasDoManifesto.LerJson(lido.Texto);
        return f with { ManifestoLido = true, Manifesto = m, ProblemasDoManifesto = RegrasDoManifesto.Validar(m, id, ativos) };
    }

    private record Lido(string? Texto);

    private static Task<T?> Nada<T>() where T : class => Task.FromResult<T?>(null);

    private static async Task<T> ComVaga<T>(SemaphoreSlim vagas, Func<CancellationToken, Task<T>> f, CancellationToken ct)
    {
        await vagas.WaitAsync(ct);
        try { return await f(ct); }
        finally { vagas.Release(); }
    }

    /// <summary>Fonte fora do ar ou lenta vira nulo. O registro leva só o nome da fonte e a mensagem já limpa.</summary>
    private async Task<T?> Tentar<T>(string fonte, Func<CancellationToken, Task<T>> f, CancellationToken ct) where T : class
    {
        // WaitAsync: uma fonte que ignora o cancelamento não segura a lista.
        try { return await f(ct).WaitAsync(ct); }
        catch (Exception e) when (e is GithubException or DeployerException) { log.LogWarning("Painel: {Fonte}: {Motivo}", fonte, e.Message); }
        catch (OperationCanceledException) { log.LogWarning("Painel: {Fonte}: passou do prazo", fonte); }
        catch (Exception e) when (e is InvalidOperationException or KeyNotFoundException or ArgumentOutOfRangeException or NullReferenceException)
        {
            log.LogWarning("Painel: {Fonte}: resposta inesperada ({Tipo})", fonte, e.GetType().Name);
        }
        return null;
    }

    private async Task<(List<LinhaDoLock> Linhas, bool Lido)> Registro(CancellationToken ct)
    {
        var arq = AgenteNucleoEndpoints.ArquivoLock(plugins.Value);
        try { return File.Exists(arq) ? (LerLock(await File.ReadAllTextAsync(arq, ct)), true) : ([], false); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return ([], false); }
    }

    /// <summary>
    /// O <c>estado.json</c> do deployer, o mesmo conteúdo do <c>GET /plugins</c>: assim a lista funciona com o deployer fora
    /// do ar e mostra a primeira subida que falhou (manifesto nulo), que não entra em <c>core_plugins_estado</c>.
    /// </summary>
    private async Task<Dictionary<string, EstadoDoDeployer>?> Estados(CancellationToken ct)
    {
        try
        {
            var arq = plugins.Value.Estado;
            return File.Exists(arq) ? JsonSerializer.Deserialize<Dictionary<string, EstadoDoDeployer>>(await File.ReadAllTextAsync(arq, ct), Json) ?? [] : [];
        }
        catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException) { return null; }
    }
}
