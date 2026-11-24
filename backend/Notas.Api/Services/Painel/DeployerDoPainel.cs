using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Notas.Api.Services.Sites;

namespace Notas.Api.Services.Painel;

/// <summary>Leituras do deployer para o painel (spec 040, contracts/deployer.md). Só GET; falha vira <see cref="DeployerException"/>.</summary>
public interface IDeployerDoPainel
{
    Task<PreparoDoPlugin> PreparoAsync(string id, CancellationToken ct);
    Task<bool> ImagemAsync(string id, string versao, CancellationToken ct);
    Task<RecursosDoDeployer> RecursosAsync(CancellationToken ct);
}

public class DeployerDoPainelHttp(HttpClient http, IOptions<SitesOptions> options) : IDeployerDoPainel
{
    private record Imagem(bool Publicada);

    private readonly SitesOptions _opt = options.Value;

    public Task<PreparoDoPlugin> PreparoAsync(string id, CancellationToken ct) => Ler<PreparoDoPlugin>($"/plugins/{Uri.EscapeDataString(id)}/preparo", ct);

    public async Task<bool> ImagemAsync(string id, string versao, CancellationToken ct) =>
        (await Ler<Imagem>($"/imagens/{Uri.EscapeDataString(id)}/{Uri.EscapeDataString(versao)}", ct)).Publicada;

    public Task<RecursosDoDeployer> RecursosAsync(CancellationToken ct) => Ler<RecursosDoDeployer>("/recursos", ct);

    private async Task<T> Ler<T>(string caminho, CancellationToken ct) where T : class
    {
        if (string.IsNullOrEmpty(_opt.DeployerToken)) throw new DeployerException("Deployer não configurado (defina DEPLOYER_TOKEN).");
        var req = new HttpRequestMessage(HttpMethod.Get, _opt.DeployerUrl.TrimEnd('/') + caminho);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _opt.DeployerToken);
        try
        {
            using var res = await http.SendAsync(req, ct);
            if (!res.IsSuccessStatusCode) throw new DeployerException($"Deployer respondeu {(int)res.StatusCode}");
            return await res.Content.ReadFromJsonAsync<T>(ct) ?? throw new DeployerException("Deployer respondeu vazio");
        }
        catch (HttpRequestException) { throw new DeployerException("Deployer inacessível"); }
        catch (JsonException) { throw new DeployerException("Deployer respondeu algo ilegível"); }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { throw new DeployerException("Deployer não respondeu a tempo"); }
    }
}
