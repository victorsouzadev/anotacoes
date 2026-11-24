using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Notas.Api.Services.Sites;

namespace Notas.Api.Services.Agente;

/// <summary>Leituras que o núcleo repassa ao deployer para o plug-in agente (spec 039). Só GET; nulo = 404 no deployer.</summary>
public interface IDeployerDoAgente
{
    Task<string?> LogsAsync(string id, int linhas, CancellationToken ct);
    Task<JsonElement?> HealthAsync(string id, CancellationToken ct);
}

public class DeployerDoAgenteHttp(HttpClient http, IOptions<SitesOptions> options) : IDeployerDoAgente
{
    private readonly SitesOptions _opt = options.Value;

    private async Task<HttpResponseMessage?> Get(string caminho, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(_opt.DeployerToken)) throw new DeployerException("Deployer não configurado (defina DEPLOYER_TOKEN).");
        var req = new HttpRequestMessage(HttpMethod.Get, _opt.DeployerUrl.TrimEnd('/') + caminho);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _opt.DeployerToken);
        HttpResponseMessage res;
        try { res = await http.SendAsync(req, ct); }
        catch (HttpRequestException e) { throw new DeployerException($"Deployer inacessível: {e.Message}"); }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { throw new DeployerException("Deployer não respondeu a tempo."); }
        if (res.StatusCode == HttpStatusCode.NotFound) { res.Dispose(); return null; }
        if (!res.IsSuccessStatusCode) { res.Dispose(); throw new DeployerException($"Deployer respondeu {(int)res.StatusCode}"); }
        return res;
    }

    public async Task<string?> LogsAsync(string id, int linhas, CancellationToken ct)
    {
        using var res = await Get($"/plugins/{Uri.EscapeDataString(id)}/logs?linhas={linhas}", ct);
        return res is null ? null : await res.Content.ReadAsStringAsync(ct);
    }

    public async Task<JsonElement?> HealthAsync(string id, CancellationToken ct)
    {
        using var res = await Get($"/plugins/{Uri.EscapeDataString(id)}/health", ct);
        return res is null ? null : await res.Content.ReadFromJsonAsync<JsonElement>(ct);
    }
}
