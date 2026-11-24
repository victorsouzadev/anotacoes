using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Notas.Api.Data;
using Notas.Api.Services.Agente;
using Notas.Api.Services.Plugins;
using Notas.Api.Services.Sites;

namespace Notas.Api.Endpoints;

/// <summary>
/// Leituras do plug-in agente (spec 039, contracts/nucleo-agente.md). Só o segredo de serviço do <c>agente</c>, só ids
/// do <c>plugins.lock</c> e só GET: nada aqui muda estado na VPS.
/// </summary>
public static partial class AgenteNucleoEndpoints
{
    public const string Plugin = "agente";
    private const int LimiteCorpo = 2048;

    [GeneratedRegex(@"^(?<id>[a-z][a-z0-9-]*)\s*:\s*(?<img>[a-z0-9./_-]+)@(?<ver>[A-Za-z0-9._-]+)$")] private static partial Regex LinhaLock();

    public static string ArquivoLock(PluginsOptions o) =>
        o.Lock ?? Path.Combine(Path.GetDirectoryName(Path.GetFullPath(o.Estado)) ?? ".", "plugins.lock");

    /// <summary>Ids do lock, ligados ou comentados (a mesma leitura do deployer).</summary>
    public static HashSet<string> IdsDoLock(string texto) =>
        texto.Split('\n').Select(l => l.Trim().TrimStart('#').Trim().Split('#', 2)[0].Trim())
            .Select(l => LinhaLock().Match(l)).Where(m => m.Success).Select(m => m.Groups["id"].Value).ToHashSet();

    public static void MapAgenteNucleoEndpoints(this WebApplication app)
    {
        var g = app.MapGroup("/api/core/agente");

        g.MapGet("/lock", async (HttpRequest r, AppDbContext db, IOptions<PluginsOptions> o, CancellationToken ct) =>
        {
            if (!await DoAgente(r, db)) return Results.Unauthorized();
            var arq = ArquivoLock(o.Value);
            var texto = File.Exists(arq) ? await File.ReadAllTextAsync(arq, ct) : "";
            return Results.Ok(new { linhas = texto.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Length > 0) });
        });

        g.MapGet("/plugins", async (HttpRequest r, AppDbContext db, CancellationToken ct) =>
        {
            if (!await DoAgente(r, db)) return Results.Unauthorized();
            var lista = await db.PluginsEstado.AsNoTracking().OrderBy(p => p.Id).ToListAsync(ct);
            return Results.Ok(lista.Select(p => new
            {
                p.Id, p.Versao, p.VersaoAnterior, p.NoAr, p.UltimaFalha, p.UltimoHealth, Congelado = Congelado(p.Manifesto),
            }));
        });

        g.MapGet("/plugins/{id}/health", async (string id, HttpRequest r, AppDbContext db, IOptions<PluginsOptions> o,
            IDeployerDoAgente deployer, CancellationToken ct) =>
        {
            if (!await DoAgente(r, db)) return Results.Unauthorized();
            if (!await NoLock(id, o.Value, ct)) return Results.NotFound();
            return await Repassar(async () => await deployer.HealthAsync(id, ct) is { } h ? Results.Ok(CortarCorpo(h)) : Results.NotFound());
        });

        g.MapGet("/plugins/{id}/logs", async (string id, int? linhas, HttpRequest r, AppDbContext db, IOptions<PluginsOptions> o,
            IDeployerDoAgente deployer, CancellationToken ct) =>
        {
            if (!await DoAgente(r, db)) return Results.Unauthorized();
            if (!await NoLock(id, o.Value, ct)) return Results.NotFound();
            var n = Math.Clamp(linhas ?? 200, 1, 200);
            return await Repassar(async () => await deployer.LogsAsync(id, n, ct) is { } t
                ? Results.Text(LimpezaDeLog.Limpar(t), "text/plain; charset=utf-8")
                : Results.NotFound());
        });

        g.MapGet("/plugins/{id}/permissoes", async (string id, HttpRequest r, AppDbContext db, IOptions<PluginsOptions> o, CancellationToken ct) =>
        {
            if (!await DoAgente(r, db)) return Results.Unauthorized();
            if (!await NoLock(id, o.Value, ct)) return Results.NotFound();
            if (!db.Database.IsNpgsql()) return Results.Ok(new { banco = "sqlite", observacao = "o núcleo não está no Postgres" });
            return Results.Ok(await Permissoes(db, id, ct));
        });
    }

    private static async Task<bool> DoAgente(HttpRequest r, AppDbContext db) => await OAuthNucleoEndpoints.PluginDoServico(r, db) == Plugin;

    private static async Task<bool> NoLock(string id, PluginsOptions o, CancellationToken ct)
    {
        var arq = ArquivoLock(o);
        return File.Exists(arq) && IdsDoLock(await File.ReadAllTextAsync(arq, ct)).Contains(id);
    }

    private static async Task<IResult> Repassar(Func<Task<IResult>> f)
    {
        try { return await f(); }
        catch (DeployerException e) { return Results.Problem(e.Message, statusCode: 502); }
    }

    private static bool Congelado(string manifesto)
    {
        try
        {
            using var d = JsonDocument.Parse(manifesto);
            return d.RootElement.TryGetProperty("congelado", out var c) && c.ValueKind == JsonValueKind.True;
        }
        catch (JsonException) { return false; }
    }

    /// <summary>O corpo do health vem cortado em 2 KB (contrato).</summary>
    private static Dictionary<string, object?> CortarCorpo(JsonElement h)
    {
        var d = new Dictionary<string, object?>();
        foreach (var p in h.EnumerateObject())
            d[p.Name] = p.Name == "corpo" && p.Value.ValueKind == JsonValueKind.String && p.Value.GetString() is { Length: > LimiteCorpo } s
                ? s[..LimiteCorpo]
                : p.Value;
        return d;
    }

    // Consulta fixa: o id vai como parâmetro, nunca no texto do SQL.
    private const string SqlPermissoes = """
        SELECT
          EXISTS (SELECT 1 FROM pg_roles WHERE rolname = @id) AS papel,
          (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = @id) AS dono,
          (SELECT count(*) FROM information_schema.tables WHERE table_schema = @id) AS tabelas,
          CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = @id)
               THEN has_schema_privilege(@id, 'nucleo', 'USAGE') END AS usa_nucleo,
          CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = @id) AND to_regclass('nucleo.users') IS NOT NULL
               THEN has_column_privilege(@id, 'nucleo.users', 'Id', 'REFERENCES') END AS referencia_users,
          CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = @id) AND to_regclass('nucleo.users') IS NOT NULL
               THEN has_table_privilege(@id, 'nucleo.users', 'SELECT') END AS le_users
        """;

    private static async Task<object> Permissoes(AppDbContext db, string id, CancellationToken ct)
    {
        var c = db.Database.GetDbConnection();
        if (c.State != System.Data.ConnectionState.Open) await c.OpenAsync(ct);
        await using var cmd = c.CreateCommand();
        cmd.CommandText = SqlPermissoes;
        var p = cmd.CreateParameter();
        p.ParameterName = "id";
        p.Value = id;
        cmd.Parameters.Add(p);
        await using var l = await cmd.ExecuteReaderAsync(ct);
        await l.ReadAsync(ct);
        object? V(int i) => l.IsDBNull(i) ? null : l.GetValue(i);
        return new
        {
            banco = "postgres", schema = id, papel = V(0), dono = V(1), tabelas = V(2),
            usaNucleo = V(3), referenciaUsers = V(4), leUsers = V(5),
        };
    }
}
