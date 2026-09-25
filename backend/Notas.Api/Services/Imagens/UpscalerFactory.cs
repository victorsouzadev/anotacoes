using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Notas.Api.Data;
using Notas.Api.Services.Seguranca;

namespace Notas.Api.Services.Imagens;

/// <summary>
/// De quem é a chave que vai ampliar, e se existe alguma.
/// </summary>
public record UpscaleEfetivo(bool Disponivel, bool ChavePropria, bool Luz = true);

public interface IUpscalerFactory
{
    Task<UpscaleEfetivo> ResolverAsync(string userId, CancellationToken ct = default);

    /// <summary>Ampliador já com a chave de quem está logado — ou a do servidor, se ele não tiver a sua.</summary>
    Task<IImageUpscaler> CriarAsync(string userId, CancellationToken ct = default);

    /// <summary>Reiluminador, com a MESMA chave: é a mesma conta no mesmo
    /// serviço, e pedir dois tokens pela mesma origem seria ruído.</summary>
    Task<IImageRelighter> CriarRelighterAsync(string userId, CancellationToken ct = default);

    /// <summary>Removedor de fundo, também com a mesma chave.</summary>
    Task<IBackgroundRemover> CriarRemovedorDeFundoAsync(string userId, CancellationToken ct = default);
}

/// <summary>
/// Mesma ideia da fábrica de extratores de LLM: a chave é resolvida por
/// requisição, com a do usuário na frente e a do servidor (variável de ambiente)
/// valendo como padrão para quem não cadastrou a sua.
/// </summary>
public class UpscalerFactory : IUpscalerFactory
{
    private readonly AppDbContext _db;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IProtetorDeSegredos _protetor;
    private readonly UpscaleOptions _padrao;
    private readonly RelightOptions _relight;
    private readonly RemoveBgOptions _removeBg;
    private readonly ILoggerFactory _loggerFactory;

    public UpscalerFactory(
        AppDbContext db,
        IHttpClientFactory httpClientFactory,
        IProtetorDeSegredos protetor,
        IOptions<UpscaleOptions> padrao,
        IOptions<RelightOptions> relight,
        IOptions<RemoveBgOptions> removeBg,
        ILoggerFactory loggerFactory)
    {
        _db = db;
        _httpClientFactory = httpClientFactory;
        _protetor = protetor;
        _padrao = padrao.Value;
        _relight = relight.Value;
        _removeBg = removeBg.Value;
        _loggerFactory = loggerFactory;
    }

    public async Task<UpscaleEfetivo> ResolverAsync(string userId, CancellationToken ct = default)
    {
        var propria = await ChaveDoUsuarioAsync(userId, ct);
        if (propria is { Length: > 0 }) return new UpscaleEfetivo(true, true);
        return new UpscaleEfetivo(!string.IsNullOrWhiteSpace(_padrao.ApiKey), false);
    }

    public async Task<IImageUpscaler> CriarAsync(string userId, CancellationToken ct = default)
    {
        var chave = await ChaveDoUsuarioAsync(userId, ct);
        var options = new UpscaleOptions
        {
            ApiKey = chave is { Length: > 0 } ? chave : _padrao.ApiKey,
            BaseUrl = _padrao.BaseUrl,
            Model = _padrao.Model,
            TimeoutSegundos = _padrao.TimeoutSegundos,
            MaxUploadBytes = _padrao.MaxUploadBytes,
            MaxEscala = _padrao.MaxEscala,
        };

        return new ReplicateUpscaler(
            _httpClientFactory.CreateClient(nameof(ReplicateUpscaler)),
            Options.Create(options),
            _loggerFactory.CreateLogger<ReplicateUpscaler>());
    }

    public async Task<IImageRelighter> CriarRelighterAsync(string userId, CancellationToken ct = default)
    {
        var chave = await ChaveDoUsuarioAsync(userId, ct);
        return new ReplicateRelighter(
            _httpClientFactory.CreateClient(nameof(ReplicateRelighter)),
            _relight,
            chave is { Length: > 0 } ? chave : _padrao.ApiKey,
            _loggerFactory.CreateLogger<ReplicateRelighter>());
    }

    public async Task<IBackgroundRemover> CriarRemovedorDeFundoAsync(string userId, CancellationToken ct = default)
    {
        var chave = await ChaveDoUsuarioAsync(userId, ct);
        return new ReplicateBackgroundRemover(
            _httpClientFactory.CreateClient(nameof(ReplicateBackgroundRemover)),
            _removeBg,
            chave is { Length: > 0 } ? chave : _padrao.ApiKey,
            _loggerFactory.CreateLogger<ReplicateBackgroundRemover>());
    }

    private async Task<string?> ChaveDoUsuarioAsync(string userId, CancellationToken ct)
    {
        var config = await _db.ConfiguracoesIa.AsNoTracking()
            .FirstOrDefaultAsync(c => c.UserId == userId, ct);
        return config?.ChaveUpscaleCifrada is { Length: > 0 } cifrada
            ? _protetor.Desproteger(cifrada)
            : null;
    }
}
