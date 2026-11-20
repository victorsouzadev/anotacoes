using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace Notas.Deployer;

public class ConfiguracaoPlugins
{
    /// <summary>Pasta montada no deployer com o <c>plugins.lock</c>, o estado, os trechos do Caddy e as cópias do banco.</summary>
    public string Pasta { get; init; } = "/plugins";
    public string ArquivoLock { get; init; } = "/plugins/plugins.lock";
    /// <summary>Banco compartilhado (spec 031), montado também no deployer para a cópia e o retrato do esquema.</summary>
    public string Banco { get; init; } = "/data/db/notas.db";
    /// <summary>Caminho de data/db NO HOST, montado em /data/db de cada plug-in.</summary>
    public required string BancoNoHost { get; init; }
    /// <summary>Rede do compose do hub (o Caddy e a API alcançam plugin-&lt;id&gt; por ela).</summary>
    public string RedeHub { get; init; } = "notas-vps_default";
    public string ContainerCaddy { get; init; } = "notas-caddy";
    public string Jwks { get; init; } = "http://api:8080/.well-known/jwks.json";
    public string Nucleo { get; init; } = "http://api:8080";
    public TimeSpan EsperaHealth { get; init; } = TimeSpan.FromSeconds(60);
    public int CopiasGuardadas { get; init; } = 5;
    public string? MemoriaPorPlugin { get; init; } = "256m";

    public string PastaCaddy => Path.Combine(Pasta, "caddy");
    public string PastaCopias => Path.Combine(Pasta, "copias");
    public string ArquivoEstado => Path.Combine(Pasta, "estado.json");
}

public record EstadoPlugin(string Id, string Imagem, string Versao, string? VersaoAnterior, Manifesto? Manifesto,
    bool NoAr, string? UltimaFalha, DateTime AtualizadoEm, bool Ativo);

/// <summary>
/// Leva os containers ao que diz o <c>plugins.lock</c> (spec 029): sobe, atualiza, volta e desliga plug-ins,
/// um de cada vez. Antes de trocar a versão copia o banco e retrata o esquema; se a versão nova não responde
/// o health em 60 s ou mexe em tabela de outro dono (spec 031), restaura a cópia e mantém a anterior.
/// </summary>
public class SincronizadorDePlugins(ConfiguracaoPlugins cfg, Func<List<string>, TimeSpan, Task<Resultado>> docker,
    HttpClient http, ILogger log)
{
    private readonly SemaphoreSlim _trava = new(1, 1);
    private string? _ultimoLock;

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public Dictionary<string, EstadoPlugin> LerEstado()
    {
        try
        {
            return File.Exists(cfg.ArquivoEstado)
                ? JsonSerializer.Deserialize<Dictionary<string, EstadoPlugin>>(File.ReadAllText(cfg.ArquivoEstado), Json) ?? []
                : [];
        }
        catch (JsonException) { return []; }
    }

    private void GravarEstado(Dictionary<string, EstadoPlugin> e)
    {
        Directory.CreateDirectory(cfg.Pasta);
        var tmp = cfg.ArquivoEstado + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(e, Json));
        File.Move(tmp, cfg.ArquivoEstado, overwrite: true);
    }

    /// <summary>Roda só se o lock mudou desde a última vez (ou se <paramref name="forcar"/>).</summary>
    public async Task<bool> SincronizarSeMudou(bool forcar, CancellationToken ct)
    {
        var texto = File.Exists(cfg.ArquivoLock) ? await File.ReadAllTextAsync(cfg.ArquivoLock, ct) : "";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(texto)));
        if (!forcar && hash == _ultimoLock) return false;
        await Sincronizar(Plugins.LerLock(texto), ct);
        _ultimoLock = hash;
        return true;
    }

    public async Task Sincronizar(List<EntradaLock> entradas, CancellationToken ct)
    {
        await _trava.WaitAsync(ct);
        try
        {
            Directory.CreateDirectory(cfg.PastaCaddy);
            var estado = LerEstado();
            var caddyMudou = false;

            // Desligados e removidos: para o container, apaga o trecho do Caddy, mantém os dados.
            foreach (var id in estado.Keys.ToList())
            {
                var e = entradas.FirstOrDefault(x => x.Id == id);
                if (e is { Ativo: true }) continue;
                await docker(["rm", "-f", Plugins.NomeContainer(id)], TimeSpan.FromSeconds(60));
                caddyMudou |= ApagarCaddy(id);
                estado[id] = estado[id] with { Ativo = false, NoAr = false, AtualizadoEm = DateTime.UtcNow };
                log.LogInformation("Plug-in {Id} desligado (dados mantidos)", id);
            }

            foreach (var e in entradas.Where(x => x.Ativo))
            {
                var atual = estado.GetValueOrDefault(e.Id);
                if (atual is { Ativo: true, NoAr: true } && atual.Versao == e.Versao && atual.Imagem == e.Imagem
                    && await ContainerRodando(e.Id)) continue;
                var outros = estado.Values.Where(x => x.Id != e.Id && x.Ativo && x.Manifesto is not null).Select(x => x.Manifesto!);
                var novo = await Implantar(e, atual, outros, ct);
                caddyMudou = true;
                estado[e.Id] = novo;
                GravarEstado(estado);
            }

            GravarEstado(estado);
            if (caddyMudou) await RecarregarCaddy();
        }
        finally
        {
            _trava.Release();
        }
    }

    private async Task<bool> ContainerRodando(string id)
    {
        var r = await docker(["inspect", "-f", "{{.State.Running}}", Plugins.NomeContainer(id)], TimeSpan.FromSeconds(20));
        return r.Codigo == 0 && r.Saida.Trim() == "true";
    }

    private async Task<EstadoPlugin> Implantar(EntradaLock e, EstadoPlugin? atual, IEnumerable<Manifesto> outros, CancellationToken ct)
    {
        EstadoPlugin Falha(string motivo)
        {
            log.LogWarning("Plug-in {Id} {Versao} recusado: {Motivo}", e.Id, e.Versao, motivo);
            return (atual ?? new EstadoPlugin(e.Id, e.Imagem, e.Versao, null, null, false, null, DateTime.UtcNow, true))
                with { UltimaFalha = $"{e.Versao}: {motivo}", AtualizadoEm = DateTime.UtcNow, Ativo = true };
        }

        var pull = await docker(["pull", e.Referencia], TimeSpan.FromMinutes(5));
        if (pull.Codigo != 0) return Falha("não baixou a imagem: " + Curto(pull.Erro));

        var lido = await docker(["run", "--rm", "--network", "none", "--entrypoint", "cat", e.Referencia, "/app/plugin.json"],
            TimeSpan.FromMinutes(1));
        var manifesto = lido.Codigo == 0 ? Manifesto.Ler(lido.Saida) : null;
        var problemas = Plugins.Validar(manifesto, e.Id, outros);
        if (problemas.Count > 0) return Falha(string.Join("; ", problemas));

        // Spec 031: cópia do banco e retrato do esquema antes de a versão nova migrar.
        var copia = CopiarBanco(e.Id, e.Versao);
        var antes = RetratoDoEsquema();

        await docker(["rm", "-f", Plugins.NomeContainer(e.Id)], TimeSpan.FromSeconds(60));
        var run = await docker(ArgumentosRun(e, manifesto!), TimeSpan.FromMinutes(2));
        var motivo = run.Codigo != 0 ? "o container não subiu: " + Curto(run.Erro) : null;
        if (motivo is null && !await EsperarHealth(manifesto!, ct)) motivo = $"health sem 200 em {cfg.EsperaHealth.TotalSeconds:0} s";

        var depois = RetratoDoEsquema();
        var invadidas = Plugins.MudancasForaDoDono(manifesto!, antes, depois);
        if (motivo is null && invadidas.Count > 0) motivo = "mexeu em tabelas de outro dono: " + string.Join(", ", invadidas);

        if (motivo is not null)
        {
            await docker(["rm", "-f", Plugins.NomeContainer(e.Id)], TimeSpan.FromSeconds(60));
            if (!Iguais(antes, depois) && copia is not null) RestaurarBanco(copia);
            if (atual?.Manifesto is { } anterior && atual.Versao != e.Versao)
            {
                // Volta automática para a versão que estava no ar.
                await docker(ArgumentosRun(new EntradaLock(e.Id, atual.Imagem, atual.Versao, true), anterior), TimeSpan.FromMinutes(2));
                var voltou = await EsperarHealth(anterior, ct);
                GravarCaddy(anterior);
                return Falha(motivo) with { NoAr = voltou };
            }
            ApagarCaddy(e.Id);
            return Falha(motivo) with { NoAr = false };
        }

        GravarCaddy(manifesto!);
        log.LogInformation("Plug-in {Id} no ar em {Versao}", e.Id, e.Versao);
        return new EstadoPlugin(e.Id, e.Imagem, e.Versao,
            atual?.Versao != e.Versao ? atual?.Versao : atual?.VersaoAnterior, manifesto, true, null, DateTime.UtcNow, true);
    }

    /// <summary>
    /// <c>docker run</c> do plug-in: rede do hub, só <c>data/db</c> montado (nunca <c>data/core</c>, spec 030),
    /// sem <c>JWT_SECRET</c> nem segredo do núcleo no ambiente.
    /// </summary>
    public List<string> ArgumentosRun(EntradaLock e, Manifesto m)
    {
        var a = new List<string>
        {
            "run", "-d", "--name", Plugins.NomeContainer(e.Id), "--restart", "unless-stopped",
            "--network", cfg.RedeHub, "--label", "notas.plugin=" + e.Id,
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            // O notas.db é do root no host; sem CAP_DAC_OVERRIDE o root do container só escreve no que é dele.
            "--user", "0:0",
            "-v", $"{cfg.BancoNoHost.TrimEnd('/')}:/data/db",
            "-e", "HUB_PLUGIN_ID=" + e.Id,
            "-e", "HUB_BANCO=/data/db/notas.db",
            "-e", "HUB_JWKS=" + cfg.Jwks,
            "-e", "HUB_NUCLEO=" + cfg.Nucleo,
            "-e", "VERSAO=" + e.Versao,
        };
        if (cfg.MemoriaPorPlugin is { } mem) a.AddRange(["--memory", mem]);
        a.Add(e.Referencia);
        return a;
    }

    private async Task<bool> EsperarHealth(Manifesto m, CancellationToken ct)
    {
        var limite = DateTime.UtcNow + cfg.EsperaHealth;
        var url = $"http://{Plugins.NomeContainer(m.Id)}:{m.Porta}{m.Health}";
        while (DateTime.UtcNow < limite && !ct.IsCancellationRequested)
        {
            try
            {
                using var r = await http.GetAsync(url, ct);
                if (r.IsSuccessStatusCode) return true;
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException) { }
            await Task.Delay(TimeSpan.FromSeconds(2), ct);
        }
        return false;
    }

    private string? CopiarBanco(string id, string versao)
    {
        if (!File.Exists(cfg.Banco)) return null;
        Directory.CreateDirectory(cfg.PastaCopias);
        var destino = Path.Combine(cfg.PastaCopias, $"notas-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{id}-{versao}.db");
        using (var origem = new SqliteConnection($"Data Source={cfg.Banco};Mode=ReadOnly"))
        using (var copia = new SqliteConnection($"Data Source={destino};Pooling=False"))
        {
            origem.Open();
            copia.Open();
            origem.BackupDatabase(copia);
        }
        foreach (var velha in Directory.GetFiles(cfg.PastaCopias, "notas-*.db").Order().Reverse().Skip(cfg.CopiasGuardadas))
            File.Delete(velha);
        return destino;
    }

    /// <summary>Restaura pela API de backup do SQLite, com o banco em uso: os outros processos veem a troca inteira.</summary>
    private void RestaurarBanco(string copia)
    {
        using var origem = new SqliteConnection($"Data Source={copia};Mode=ReadOnly;Pooling=False");
        using var destino = new SqliteConnection($"Data Source={cfg.Banco};Pooling=False");
        origem.Open();
        destino.Open();
        origem.BackupDatabase(destino);
        log.LogWarning("Banco restaurado da cópia {Copia}", copia);
    }

    public Dictionary<string, string> RetratoDoEsquema()
    {
        var r = new Dictionary<string, string>();
        if (!File.Exists(cfg.Banco)) return r;
        using var con = new SqliteConnection($"Data Source={cfg.Banco};Mode=ReadOnly;Pooling=False");
        con.Open();
        using var cmd = con.CreateCommand();
        cmd.CommandText = "SELECT type, name, tbl_name, sql FROM sqlite_master";
        using var rd = cmd.ExecuteReader();
        while (rd.Read())
            r[$"{rd.GetString(0)}:{rd.GetString(1)}"] = $"{rd.GetString(2)}\u001f{(rd.IsDBNull(3) ? "" : rd.GetString(3))}";
        return r;
    }

    private static bool Iguais(Dictionary<string, string> a, Dictionary<string, string> b) =>
        a.Count == b.Count && a.All(kv => b.TryGetValue(kv.Key, out var v) && v == kv.Value);

    private void GravarCaddy(Manifesto m) =>
        File.WriteAllText(Path.Combine(cfg.PastaCaddy, m.Id + ".caddy"), Plugins.GerarCaddy(m));

    private bool ApagarCaddy(string id)
    {
        var arq = Path.Combine(cfg.PastaCaddy, id + ".caddy");
        if (!File.Exists(arq)) return false;
        File.Delete(arq);
        return true;
    }

    private async Task RecarregarCaddy()
    {
        var r = await docker(["exec", cfg.ContainerCaddy, "caddy", "reload", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"],
            TimeSpan.FromSeconds(30));
        if (r.Codigo != 0) log.LogWarning("Caddy não recarregou: {Erro}", Curto(r.Erro));
    }

    private static string Curto(string s) => s.Trim() is var t && t.Length > 300 ? t[..300] : s.Trim();
}
