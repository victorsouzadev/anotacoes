using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.Extensions.Options;

namespace Notas.Api.Services.Sites;

public record IniciarApp(
    string DeployId,
    string Entrada,
    string Runtime,
    int MemoriaMb,
    Dictionary<string, string> Variaveis);

/// <summary>
/// Controle dos containers dos apps. A implementação real fala com o serviço "deployer"
/// (o único com o docker.sock montado): a API exposta à internet nunca toca no Docker.
/// </summary>
public interface IDeployer
{
    Task IniciarAsync(string slug, IniciarApp app, CancellationToken ct);
    Task RemoverAsync(string slug, CancellationToken ct);
    Task<string> LogsAsync(string slug, int linhas, CancellationToken ct);
    /// <summary>Slugs com container rodando.</summary>
    Task<IReadOnlyList<string>> RodandoAsync(CancellationToken ct);
}

public class DeployerException(string message) : Exception(message);

public class DeployerHttp(HttpClient http, IOptions<SitesOptions> options) : IDeployer
{
    private readonly SitesOptions _opt = options.Value;

    private HttpRequestMessage Req(HttpMethod metodo, string caminho, object? corpo = null)
    {
        if (string.IsNullOrEmpty(_opt.DeployerToken))
            throw new DeployerException("Deployer não configurado (defina DEPLOYER_TOKEN).");
        var req = new HttpRequestMessage(metodo, _opt.DeployerUrl.TrimEnd('/') + caminho);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _opt.DeployerToken);
        if (corpo is not null) req.Content = JsonContent.Create(corpo);
        return req;
    }

    private async Task<HttpResponseMessage> Enviar(HttpRequestMessage req, CancellationToken ct)
    {
        HttpResponseMessage res;
        try { res = await http.SendAsync(req, ct); }
        catch (HttpRequestException e) { throw new DeployerException($"Deployer inacessível: {e.Message}"); }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { throw new DeployerException("Deployer não respondeu a tempo."); }
        if (!res.IsSuccessStatusCode)
        {
            var corpo = await res.Content.ReadAsStringAsync(ct);
            throw new DeployerException($"Deployer respondeu {(int)res.StatusCode}: {corpo}");
        }
        return res;
    }

    public async Task IniciarAsync(string slug, IniciarApp app, CancellationToken ct) =>
        (await Enviar(Req(HttpMethod.Post, $"/apps/{slug}/iniciar", app), ct)).Dispose();

    // Sem Deployer configurado nenhum container pode ter sido criado: remover é no-op, e
    // sites só estáticos funcionam sem o serviço.
    private bool Configurado => !string.IsNullOrEmpty(_opt.DeployerToken);

    public async Task RemoverAsync(string slug, CancellationToken ct)
    {
        if (!Configurado) return;
        (await Enviar(Req(HttpMethod.Post, $"/apps/{slug}/remover"), ct)).Dispose();
    }

    public async Task<string> LogsAsync(string slug, int linhas, CancellationToken ct)
    {
        using var res = await Enviar(Req(HttpMethod.Get, $"/apps/{slug}/logs?linhas={linhas}"), ct);
        return await res.Content.ReadAsStringAsync(ct);
    }

    public async Task<IReadOnlyList<string>> RodandoAsync(CancellationToken ct)
    {
        if (!Configurado) return [];
        using var res = await Enviar(Req(HttpMethod.Get, "/apps"), ct);
        return await res.Content.ReadFromJsonAsync<List<string>>(ct) ?? [];
    }
}

/// <summary>Pergunta ao app se ele subiu, passando pelo Caddy — o mesmo caminho do visitante.</summary>
public interface IVerificadorSaude
{
    /// <summary>null = saudável; senão, a descrição do que falhou na última tentativa.</summary>
    Task<string?> VerificarAsync(string slug, string caminho, bool exige2xx, CancellationToken ct);
}

public class VerificadorSaudeHttp(HttpClient http, IOptions<SitesOptions> options) : IVerificadorSaude
{
    private readonly SitesOptions _opt = options.Value;

    public async Task<string?> VerificarAsync(string slug, string caminho, bool exige2xx, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, _opt.GatewayUrl.TrimEnd('/') + caminho);
        req.Headers.Host = $"{slug}.{_opt.Dominio}";
        try
        {
            using var res = await http.SendAsync(req, ct);
            var codigo = (int)res.StatusCode;
            // Sem health configurado, basta o app estar escutando: qualquer resposta que não
            // seja o 502/503/504 do Caddy (upstream fora do ar) conta. Com health, exige 2xx.
            var ok = exige2xx
                ? res.IsSuccessStatusCode
                : res.StatusCode is not (HttpStatusCode.BadGateway or HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout);
            return ok ? null : $"GET {caminho} respondeu {codigo}";
        }
        catch (HttpRequestException e) { return $"GET {caminho} falhou: {e.Message}"; }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { return $"GET {caminho} não respondeu a tempo"; }
    }
}
