using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Notas.Api.Data;

namespace Notas.Api.Services.Plugins;

public class PluginsOptions
{
    public const string SectionName = "Plugins";

    /// <summary>Estado gravado pelo deployer (spec 029). Ausente = nenhum plug-in instalado.</summary>
    public string Estado { get; set; } = "../../data/plugins/estado.json";

    public int IntervaloHealthSegundos { get; set; } = 30;
}

/// <summary>Linha de <c>core_plugins_estado</c> (dono: núcleo).</summary>
public class PluginEstado
{
    public string Id { get; set; } = "";
    public string Versao { get; set; } = "";
    public string? VersaoAnterior { get; set; }
    public string Manifesto { get; set; } = "{}";
    public bool NoAr { get; set; }
    public DateTime? UltimoHealth { get; set; }
    public string? UltimaFalha { get; set; }
}

public record ItemDoHub(string Id, string Nome, string Icone, string Rota, string Origem, string Estado, string Versao,
    string? Descricao = null, string? Android = null, string? UltimaFalha = null);

/// <summary>Ferramentas que ainda são módulos do núcleo, no mesmo formato do manifesto (spec 029).</summary>
public static class ModulosDoNucleo
{
    public static readonly (string Id, string Nome, string Icone, string Rota)[] Todos =
    [
        ("notas", "Notas", "pen", "/notes"),
        ("financas", "Finanças", "wallet", "/financas"),
        ("tarefas", "Tarefas", "checklist", "/tasks"),
        ("dieta", "Dieta", "apple", "/dieta"),
        ("treino", "Treino", "run", "/treino"),
        ("imagens", "Editor de Imagens", "image", "/imagens"),
        ("moldes", "Moldes", "box", "/moldes"),
        ("bolo-3d", "Simulador de Bolo 3D", "cake", "/bolo-3d"),
        ("precificacao", "Precificação", "calculator", "/precificacao"),
    ];
}

public static class RegistroDePlugins
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private record Manifesto(string Id, string Nome, string Icone, string? Descricao, string Rota, int Porta, string Health, string? Android);
    private record EstadoDeployer(string Id, string Versao, string? VersaoAnterior, JsonElement? Manifesto, bool NoAr,
        string? UltimaFalha, bool Ativo);

    /// <summary>Lê o estado do deployer e leva para a tabela; desligados saem da lista (os dados ficam).</summary>
    public static async Task Importar(AppDbContext db, string arquivo, CancellationToken ct)
    {
        Dictionary<string, EstadoDeployer>? lido = null;
        try
        {
            if (File.Exists(arquivo))
                lido = JsonSerializer.Deserialize<Dictionary<string, EstadoDeployer>>(await File.ReadAllTextAsync(arquivo, ct), Json);
        }
        catch (Exception e) when (e is JsonException or IOException) { return; }
        lido ??= [];

        var linhas = await db.PluginsEstado.ToDictionaryAsync(p => p.Id, ct);
        foreach (var (id, e) in lido)
        {
            if (!e.Ativo || e.Manifesto is null)
            {
                if (linhas.Remove(id, out var velha)) db.PluginsEstado.Remove(velha);
                continue;
            }
            if (!linhas.TryGetValue(id, out var l))
            {
                l = new PluginEstado { Id = id };
                db.PluginsEstado.Add(l);
                linhas[id] = l;
            }
            l.Versao = e.Versao;
            l.VersaoAnterior = e.VersaoAnterior;
            l.Manifesto = e.Manifesto.Value.GetRawText();
            l.UltimaFalha = e.UltimaFalha;
            if (!e.NoAr) l.NoAr = false;
        }
        foreach (var sobra in linhas.Keys.Except(lido.Keys).ToList()) db.PluginsEstado.Remove(linhas[sobra]);
        await db.SaveChangesAsync(ct);
    }

    public static async Task<List<ItemDoHub>> Listar(AppDbContext db, string versaoNucleo, CancellationToken ct)
    {
        var plugins = (await db.PluginsEstado.AsNoTracking().ToListAsync(ct))
            .Select(p => (p, m: JsonSerializer.Deserialize<Manifesto>(p.Manifesto, Json)))
            .Where(x => x.m is not null)
            .Select(x => new ItemDoHub(x.p.Id, x.m!.Nome, x.m.Icone, x.m.Rota, "plugin", x.p.NoAr ? "no-ar" : "indisponivel",
                x.p.Versao, x.m.Descricao, x.m.Android, x.p.UltimaFalha))
            .ToList();
        // Um plug-in extraído substitui o módulo do núcleo com o mesmo id.
        var modulos = ModulosDoNucleo.Todos.Where(m => plugins.All(p => p.Id != m.Id))
            .Select(m => new ItemDoHub(m.Id, m.Nome, m.Icone, m.Rota, "nucleo", "no-ar", versaoNucleo));
        return modulos.Concat(plugins).ToList();
    }

    public static string? UrlHealth(PluginEstado p)
    {
        var m = JsonSerializer.Deserialize<Manifesto>(p.Manifesto, Json);
        return m is null ? null : $"http://plugin-{p.Id}:{m.Porta}{m.Health}";
    }
}

/// <summary>Health dos plug-ins a cada 30 s, gravado na tabela: o hub nunca espera um plug-in responder.</summary>
public sealed class CacheDeHealth(IServiceScopeFactory escopos, IHttpClientFactory http, IOptions<PluginsOptions> opcoes,
    ILogger<CacheDeHealth> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var intervalo = TimeSpan.FromSeconds(Math.Max(5, opcoes.Value.IntervaloHealthSegundos));
        while (!ct.IsCancellationRequested)
        {
            try { await Rodada(ct); }
            catch (Exception e) when (e is not OperationCanceledException) { log.LogWarning(e, "Health dos plug-ins falhou"); }
            await Task.Delay(intervalo, ct);
        }
    }

    public async Task Rodada(CancellationToken ct)
    {
        using var escopo = escopos.CreateScope();
        var db = escopo.ServiceProvider.GetRequiredService<AppDbContext>();
        await RegistroDePlugins.Importar(db, opcoes.Value.Estado, ct);
        var cliente = http.CreateClient(nameof(CacheDeHealth));
        foreach (var p in await db.PluginsEstado.ToListAsync(ct))
        {
            var ok = false;
            if (RegistroDePlugins.UrlHealth(p) is { } url)
            {
                try { using var r = await cliente.GetAsync(url, ct); ok = r.IsSuccessStatusCode; }
                catch (Exception e) when (e is HttpRequestException or TaskCanceledException) { }
            }
            p.NoAr = ok;
            p.UltimoHealth = DateTime.UtcNow;
        }
        await db.SaveChangesAsync(ct);
    }
}
