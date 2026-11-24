using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using Hub.Plugin;
using Microsoft.Extensions.Options;

namespace Notas.Api.Services.Painel;

/// <summary>O GitHub não respondeu como esperado. A mensagem nunca leva o token nem a resposta.</summary>
public class GithubException(string mensagem) : Exception(mensagem);

public record CommitDoPlugin(string Versao, string Mensagem, DateTime? Data);

/// <param name="Estado"><c>feita</c>, <c>pendente</c> ou <c>falhou</c>.</param>
public record CiDoCommit(string Estado);

/// <summary>Leituras do GitHub para o painel (spec 040, contracts/workflow.md).</summary>
public interface IGithubDoPainel
{
    bool Ligado { get; }
    /// <summary>Ids dos repositórios <c>hub-&lt;id&gt;</c> do dono, fora o modelo e o exemplo.</summary>
    Task<List<string>> IdsAsync(CancellationToken ct);
    Task<List<CommitDoPlugin>> CommitsAsync(string id, CancellationToken ct);
    /// <summary>CI por commit curto. Commit sem execução não aparece.</summary>
    Task<Dictionary<string, CiDoCommit>> CiAsync(string id, CancellationToken ct);
    /// <summary><c>plugin.json</c> do commit; nulo quando não existe.</summary>
    Task<string?> ManifestoAsync(string id, string versao, CancellationToken ct);
}

public partial class GithubDoPainel(HttpClient http, IOptions<PainelOptions> opcoes) : IGithubDoPainel
{
    public static readonly string[] ForaDaLista = ["modelo", "exemplo"];
    private const string Base = "https://api.github.com";
    private readonly PainelOptions _o = opcoes.Value;

    [GeneratedRegex(@"\A[0-9a-f]{7,40}\z")] private static partial Regex Commit();

    public bool Ligado => !string.IsNullOrWhiteSpace(_o.GithubLeitura);

    /// <summary>As únicas leituras permitidas. Qualquer outra URL é recusada antes de sair da VPS.</summary>
    public static bool UrlPermitida(Uri u, string dono)
    {
        if (u.Scheme != "https" || u.Host != "api.github.com" || !u.IsDefaultPort || u.UserInfo.Length > 0) return false;
        if (Regex.IsMatch(u.PathAndQuery, @"\A/user/repos\?affiliation=owner&per_page=100&page=[1-5]\z")) return true;
        var m = Regex.Match(u.PathAndQuery,
            @"\A/repos/(?<d>[^/]+)/hub-(?<id>[a-z0-9-]+)/(?:commits\?sha=main&per_page=10|actions/runs\?branch=main&per_page=50|contents/plugin\.json\?ref=[0-9a-f]{7,40})\z");
        return m.Success && m.Groups["d"].Value == dono && RegrasDoManifesto.IdPermitido(m.Groups["id"].Value);
    }

    public async Task<List<string>> IdsAsync(CancellationToken ct)
    {
        var ids = new List<string>();
        for (var pagina = 1; pagina <= 5; pagina++)
        {
            var j = await Json($"/user/repos?affiliation=owner&per_page=100&page={pagina}", ct);
            foreach (var r in j.EnumerateArray())
            {
                var nome = r.GetProperty("name").GetString() ?? "";
                var dono = r.GetProperty("owner").GetProperty("login").GetString();
                if (dono != _o.Dono || !nome.StartsWith("hub-", StringComparison.Ordinal)) continue;
                if (r.TryGetProperty("archived", out var a) && a.ValueKind == JsonValueKind.True) continue;
                var id = nome["hub-".Length..];
                if (RegrasDoManifesto.IdPermitido(id) && !ForaDaLista.Contains(id)) ids.Add(id);
            }
            if (j.GetArrayLength() < 100) break;
        }
        return ids.Distinct().Order(StringComparer.Ordinal).ToList();
    }

    public async Task<List<CommitDoPlugin>> CommitsAsync(string id, CancellationToken ct)
    {
        var j = await Json($"/repos/{_o.Dono}/hub-{id}/commits?sha=main&per_page=10", ct);
        return j.EnumerateArray().Select(c =>
        {
            var commit = c.GetProperty("commit");
            var mensagem = (commit.GetProperty("message").GetString() ?? "").Split('\n', 2)[0].Trim();
            DateTime? data = commit.TryGetProperty("committer", out var k) && k.TryGetProperty("date", out var d) && d.TryGetDateTime(out var v) ? v : null;
            return new CommitDoPlugin(c.GetProperty("sha").GetString()![..7], mensagem.Length > 120 ? mensagem[..120] : mensagem, data);
        }).ToList();
    }

    public async Task<Dictionary<string, CiDoCommit>> CiAsync(string id, CancellationToken ct)
    {
        var j = await Json($"/repos/{_o.Dono}/hub-{id}/actions/runs?branch=main&per_page=50", ct);
        return j.GetProperty("workflow_runs").EnumerateArray()
            .Where(r => Texto(r, "head_sha").Length >= 7 && Texto(r, "event") == "push")
            .GroupBy(r => Texto(r, "head_sha")[..7])
            .ToDictionary(g => g.Key, g => new CiDoCommit(EstadoDaCi(g.Select(r => (Texto(r, "status"), Texto(r, "conclusion"))))));
    }

    /// <summary>Uma falha basta; sem falha, uma execução aberta deixa pendente; só com sucesso fica feita.</summary>
    public static string EstadoDaCi(IEnumerable<(string Status, string Conclusao)> execucoes)
    {
        var l = execucoes.ToList();
        if (l.Any(x => x.Status == "completed" && x.Conclusao is not ("success" or "skipped" or "neutral"))) return Etapas.Falhou;
        if (l.Any(x => x.Status != "completed")) return Etapas.Pendente;
        return l.Any(x => x.Conclusao == "success") ? Etapas.Feita : Etapas.Pendente;
    }

    public async Task<string?> ManifestoAsync(string id, string versao, CancellationToken ct)
    {
        if (!Commit().IsMatch(versao)) throw new GithubException("versão inválida");
        using var r = await Pedir($"/repos/{_o.Dono}/hub-{id}/contents/plugin.json?ref={versao}", "application/vnd.github.raw+json", ct);
        if (r.StatusCode == HttpStatusCode.NotFound) return null;
        Conferir(r);
        return await Corpo(r, ct);
    }

    private static string Texto(JsonElement e, string campo) =>
        e.TryGetProperty(campo, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    private async Task<JsonElement> Json(string caminho, CancellationToken ct)
    {
        using var r = await Pedir(caminho, "application/vnd.github+json", ct);
        Conferir(r);
        try { return JsonDocument.Parse(await Corpo(r, ct)).RootElement; }
        catch (JsonException) { throw new GithubException("O GitHub respondeu algo ilegível."); }
    }

    private static void Conferir(HttpResponseMessage r)
    {
        if (r.StatusCode == HttpStatusCode.Unauthorized) throw new GithubException("O GitHub recusou o token de leitura.");
        if (!r.IsSuccessStatusCode) throw new GithubException($"O GitHub respondeu {(int)r.StatusCode}.");
    }

    private static async Task<string> Corpo(HttpResponseMessage r, CancellationToken ct)
    {
        try { return await r.Content.ReadAsStringAsync(ct); }
        catch (Exception e) when (e is HttpRequestException or IOException) { throw new GithubException("O GitHub não respondeu."); }
    }

    private async Task<HttpResponseMessage> Pedir(string caminho, string aceita, CancellationToken ct)
    {
        if (!Ligado) throw new GithubException("Falta o token de leitura.");
        if (!Uri.TryCreate(Base + caminho, UriKind.Absolute, out var url) || !UrlPermitida(url, _o.Dono))
            throw new GithubException("Destino recusado.");
        var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _o.GithubLeitura.Trim());
        req.Headers.UserAgent.ParseAdd("hub-painel");
        req.Headers.Accept.ParseAdd(aceita);
        // A mensagem da exceção original não sai daqui: pode repetir o pedido.
        try { return await http.SendAsync(req, ct); }
        catch (HttpRequestException) { throw new GithubException("O GitHub não respondeu."); }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { throw new GithubException("O GitHub não respondeu a tempo."); }
    }
}
