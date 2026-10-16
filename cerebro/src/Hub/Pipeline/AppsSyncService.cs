using System.Globalization;
using System.Text;
using System.Text.Json;
using Hub.Api;
using Hub.Core;
using Hub.Data;
using Hub.Vault;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace Hub.Pipeline;

/// <summary>Um app do hub que o Cérebro sincroniza pelo MCP dele.</summary>
public sealed record HubApp(string Id, string Name, string Tool, string Note, string Description);

/// <summary>
/// Rotina que busca dados dos apps do hub (Tarefas, Finanças, Criativo) pelos MCPs deles, em horários
/// configuráveis (padrão 08:00 e 20:00), e grava um resumo de cada um em _sistema/apps/. O MCP do
/// notas-api age como o dono do Cérebro (token gerado na tela, aba Conectar).
/// </summary>
public sealed class AppsSyncService : BackgroundService
{
    public static readonly IReadOnlyList<HubApp> Apps =
    [
        new("tarefas", "Tarefas", "tarefas_resumo", "Tarefas (app)", "Atrasadas, hoje, próximos 7 dias, concluídas e projetos."),
        new("financas", "Finanças", "financas_resumo", "Finanças (app)", "Mês atual e anterior, saúde financeira e metas."),
        new("criativo", "Publicar e Imagens", "criativo_resumo", "Publicar e Imagens (app)", "Sites publicados e projetos do Editor de Imagens."),
    ];

    private const string Key = "apps-sync";

    public sealed record AppResult(string App, bool Ok, string? Error, string? Note);
    public sealed record LastRun(DateTimeOffset At, string Trigger, IReadOnlyList<AppResult> Results);

    public sealed record Settings(
        bool Enabled = true,
        IReadOnlyList<string>? Times = null,
        IReadOnlyList<string>? DisabledApps = null,
        LastRun? Last = null,
        string? LastSlot = null)
    {
        public IReadOnlyList<string> EffectiveTimes => Times is { Count: > 0 } ? Times : ["08:00", "20:00"];
        public bool AppEnabled(string id) => DisabledApps is null || !DisabledApps.Contains(id);
    }

    private readonly HubDb _db;
    private readonly AccessStore _access;
    private readonly VaultStore _vault;
    private readonly HubClock _clock;
    private readonly HubOptions _options;
    private readonly ILoggerFactory _loggers;
    private readonly ILogger<AppsSyncService> _log;
    private readonly SemaphoreSlim _running = new(1, 1);

    public AppsSyncService(HubDb db, AccessStore access, VaultStore vault, HubClock clock,
        IOptions<HubOptions> options, ILoggerFactory loggers, ILogger<AppsSyncService> log)
    {
        _db = db;
        _access = access;
        _vault = vault;
        _clock = clock;
        _options = options.Value;
        _loggers = loggers;
        _log = log;
    }

    public Settings Load()
    {
        var row = _db.GetSetting(Key);
        return row is null ? new Settings() : JsonSerializer.Deserialize<Settings>(row.Value.Value) ?? new Settings();
    }

    private void Save(Settings s) => _db.SetSetting(Key, JsonSerializer.Serialize(s));

    /// <summary>Salva liga/desliga, horários (HH:mm) e quais apps entram.</summary>
    public Settings Configure(bool enabled, IEnumerable<string> times, IEnumerable<string> enabledApps)
    {
        var parsed = times.Select(t => t.Trim()).Where(t => t.Length > 0).Distinct().Order().ToList();
        foreach (var t in parsed)
            if (!TimeOnly.TryParseExact(t, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
                throw new ArgumentException($"Horário inválido: {t} (use HH:mm, ex.: 08:00).");
        if (parsed.Count > 12) throw new ArgumentException("No máximo 12 horários por dia.");
        var on = enabledApps.ToHashSet();
        var s = Load() with
        {
            Enabled = enabled,
            Times = parsed,
            DisabledApps = Apps.Select(a => a.Id).Where(id => !on.Contains(id)).ToList(),
        };
        Save(s);
        return s;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            try
            {
                var s = Load();
                if (s.Enabled && DueSlot(s) is { } slot)
                {
                    // Grava o horário antes de rodar: uma falha não repete a cada 30 s.
                    Save(s with { LastSlot = slot });
                    await RunAsync($"rotina das {slot[^5..]}", stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                _log.LogError(ex, "Rotina dos apps falhou.");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    /// <summary>
    /// O último horário do dia que já passou e ainda não rodou ("2026-10-15 08:00"). Se o serviço
    /// estava fora no horário, roda quando voltar, mas só o mais recente (não acumula).
    /// </summary>
    internal string? DueSlot(Settings s)
    {
        var now = _clock.Now;
        var today = DateOnly.FromDateTime(now.DateTime);
        string? due = null;
        foreach (var t in s.EffectiveTimes)
        {
            if (!TimeOnly.TryParseExact(t, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var time)) continue;
            if (TimeOnly.FromDateTime(now.DateTime) >= time) due = $"{today:yyyy-MM-dd} {t}";
        }
        return due is not null && string.CompareOrdinal(due, s.LastSlot ?? "") > 0 ? due : null;
    }

    /// <summary>Sincroniza agora todos os apps ligados. Uma execução por vez.</summary>
    public async Task<LastRun> RunAsync(string trigger, CancellationToken ct)
    {
        if (!await _running.WaitAsync(0, ct))
            throw new InvalidOperationException("Uma sincronização já está em andamento.");
        try
        {
            var s = Load();
            var token = _access.AppsToken
                ?? throw new InvalidOperationException("Gere o token dos apps na aba Conectar antes de sincronizar.");
            var since = s.Last?.At;
            var results = new List<AppResult>();
            foreach (var app in Apps.Where(a => s.AppEnabled(a.Id)))
                results.Add(await SyncAppAsync(app, token, since, ct));

            var run = new LastRun(DateTimeOffset.UtcNow, trigger, results);
            Save(Load() with { Last = run });

            var ok = results.Where(r => r.Ok).ToList();
            if (ok.Count > 0)
            {
                var links = string.Join(", ", ok.Select(r => $"[[{Path.GetFileNameWithoutExtension(r.Note)}]]"));
                await DailyNote.AppendAsync(_vault, _clock, $"Apps do hub sincronizados ({trigger}): {links}", _clock.Today, "apps", ct);
            }
            _log.LogInformation("Apps sincronizados ({Trigger}): {Ok}/{Total}", trigger, ok.Count, results.Count);
            return run;
        }
        finally { _running.Release(); }
    }

    private async Task<AppResult> SyncAppAsync(HubApp app, string token, DateTimeOffset? since, CancellationToken ct)
    {
        try
        {
            var content = await CallAsync(app, token, since, ct);
            var rel = $"{VaultLayout.Apps}/{app.Note}.md";
            var now = _clock.Now;
            var fm = new FrontMatter()
                .Set("title", app.Note)
                .Set("source", "app")
                .Set("app", app.Id)
                .Set("atualizado_em", now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture))
                .Set("tags", new List<string> { "app", app.Id });
            var body = new StringBuilder()
                .Append($"# {app.Note}\n\n")
                .Append($"> [!info] Trazido do app {app.Name} pelo MCP em {now:dd/MM/yyyy HH:mm}. Esta nota é regravada a cada sincronização: ")
                .Append("para guardar algo, copie para outra nota.\n\n")
                .Append(content.Trim()).Append('\n')
                .ToString();
            var doc = new NoteDocument(fm, body);
            if (_vault.Exists(rel)) await _vault.ReplaceAsync(rel, doc, $"sincronizado do app {app.Name}", ct);
            else await _vault.CreateAsync(rel, doc, $"sincronizado do app {app.Name}", ct);
            return new AppResult(app.Id, true, null, rel);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            _log.LogWarning(ex, "Sincronização do app {App} falhou.", app.Id);
            return new AppResult(app.Id, false, Short(ex), null);
        }
    }

    /// <summary>Chama a ferramenta de resumo do app pelo MCP (Streamable HTTP, rede interna).</summary>
    internal async Task<string> CallAsync(HubApp app, string token, DateTimeOffset? since, CancellationToken ct)
    {
        var transport = new HttpClientTransport(new HttpClientTransportOptions
        {
            Endpoint = new Uri($"{_options.AppsMcpUrl.TrimEnd('/')}/{app.Id}"),
            Name = $"cerebro-{app.Id}",
            TransportMode = HttpTransportMode.StreamableHttp,
            AdditionalHeaders = new Dictionary<string, string> { ["Authorization"] = $"Bearer {token}" },
        }, _loggers);
        await using var client = await McpClient.CreateAsync(transport, null, _loggers, ct);
        var args = new Dictionary<string, object?>();
        if (since is { } s && app.Id != "financas") args["desde"] = s.UtcDateTime.ToString("O");
        var result = await client.CallToolAsync(app.Tool, args, cancellationToken: ct);
        var text = string.Join("\n", result.Content.OfType<TextContentBlock>().Select(c => c.Text));
        if (result.IsError == true) throw new InvalidOperationException(text.Length > 0 ? text : "O app devolveu erro.");
        return text;
    }

    private static string Short(Exception ex)
    {
        var msg = ex.Message;
        if (ex is HttpRequestException { StatusCode: { } code })
            msg = (int)code switch
            {
                401 => "Token recusado pelo app: gere o token dos apps de novo na aba Conectar.",
                403 => "O e-mail do dono do Cérebro não tem conta no hub.",
                503 => "O MCP dos apps está desligado no hub (arquivo de token ausente).",
                _ => $"HTTP {(int)code}: {msg}",
            };
        return msg.Length > 300 ? msg[..300] + "…" : msg;
    }
}
