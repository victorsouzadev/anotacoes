using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Notas.Api.Data;
using Notas.Api.Services.Seguranca;

namespace Notas.Api.Services.Financas.Llm;

// O que efetivamente vai ser usado numa requisição, depois de combinar o que o
// usuário configurou com o padrão do servidor.
public record ConfiguracaoEfetiva(
    string Provedor,
    string Modelo,
    bool TemChave,
    /// <summary>Verdadeiro quando a chave veio da configuração do usuário, e não do servidor.</summary>
    bool ChavePropria,
    bool SuportaAnexos);

public interface ILlmExtractorFactory
{
    Task<ConfiguracaoEfetiva> ResolverAsync(string userId, CancellationToken ct = default);

    Task<ILlmExtractor> CriarAsync(string userId, CancellationToken ct = default);

    /// <summary>Extrator montado a partir de valores avulsos, para o "testar conexão"
    /// funcionar antes de a configuração ser salva.</summary>
    ILlmExtractor CriarAvulso(string provedor, string? chave, string? modelo);
}

// Resolve qual extrator usar em cada requisição.
//
// Antes o provedor era escolhido uma vez, na subida do processo, a partir das
// variáveis de ambiente. Com a chave configurável por usuário isso passa a ser
// decidido por requisição: a chave de quem está logado tem prioridade, e a do
// servidor continua valendo como padrão para quem não configurou a sua.
public class LlmExtractorFactory : ILlmExtractorFactory
{
    private readonly AppDbContext _db;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IProtetorDeSegredos _protetor;
    private readonly OpenRouterOptions _openRouterPadrao;
    private readonly AnthropicOptions _anthropicPadrao;
    private readonly string _provedorPadrao;
    private readonly ILoggerFactory _loggerFactory;

    public LlmExtractorFactory(
        AppDbContext db,
        IHttpClientFactory httpClientFactory,
        IProtetorDeSegredos protetor,
        IOptions<OpenRouterOptions> openRouter,
        IOptions<AnthropicOptions> anthropic,
        IConfiguration configuration,
        ILoggerFactory loggerFactory)
    {
        _db = db;
        _httpClientFactory = httpClientFactory;
        _protetor = protetor;
        _openRouterPadrao = openRouter.Value;
        _anthropicPadrao = anthropic.Value;
        _loggerFactory = loggerFactory;

        var forcado = (configuration["Llm:Provider"] ?? "").Trim().ToLowerInvariant();
        _provedorPadrao = forcado.Length > 0 ? forcado
            : !string.IsNullOrWhiteSpace(_openRouterPadrao.ApiKey) ? "openrouter"
            : !string.IsNullOrWhiteSpace(_anthropicPadrao.ApiKey) ? "anthropic"
            : "heuristico";
    }

    public async Task<ConfiguracaoEfetiva> ResolverAsync(string userId, CancellationToken ct = default)
    {
        var (provedor, chave, modelo, propria) = await ResolverBrutoAsync(userId, ct);

        return new ConfiguracaoEfetiva(
            provedor,
            modelo,
            !string.IsNullOrWhiteSpace(chave),
            propria,
            // Só a OpenRouter recebe imagem e PDF nesta implementação; o heurístico
            // e o caminho direto da Anthropic ficam restritos a texto.
            SuportaAnexos: provedor == "openrouter" && !string.IsNullOrWhiteSpace(chave));
    }

    public async Task<ILlmExtractor> CriarAsync(string userId, CancellationToken ct = default)
    {
        var (provedor, chave, modelo, _) = await ResolverBrutoAsync(userId, ct);
        return Montar(provedor, chave, modelo);
    }

    public ILlmExtractor CriarAvulso(string provedor, string? chave, string? modelo)
    {
        var normalizado = Normalizar(provedor);
        if (normalizado == "heuristico") return new HeuristicLlmExtractor();

        // Sem chave avulsa, testa com a que já estiver configurada no servidor.
        var chaveFinal = string.IsNullOrWhiteSpace(chave)
            ? (normalizado == "anthropic" ? _anthropicPadrao.ApiKey : _openRouterPadrao.ApiKey)
            : chave;

        return Montar(normalizado, chaveFinal, string.IsNullOrWhiteSpace(modelo) ? null : modelo);
    }

    // ----------------------------------------------------------------- interno

    private async Task<(string Provedor, string? Chave, string Modelo, bool Propria)> ResolverBrutoAsync(
        string userId, CancellationToken ct)
    {
        var config = await _db.ConfiguracoesIa.AsNoTracking()
            .FirstOrDefaultAsync(c => c.UserId == userId, ct);

        var provedor = Normalizar(
            string.IsNullOrWhiteSpace(config?.Provedor) ? _provedorPadrao : config!.Provedor);

        string? chaveDoUsuario = null;
        if (config?.ChaveApiCifrada is { Length: > 0 })
        {
            // Null aqui significa que o segredo de cifra mudou desde que a chave foi
            // salva; tratamos como "sem chave" e o usuário recadastra.
            chaveDoUsuario = _protetor.Desproteger(config.ChaveApiCifrada);
        }

        var chaveDoServidor = provedor == "anthropic" ? _anthropicPadrao.ApiKey : _openRouterPadrao.ApiKey;
        var chave = !string.IsNullOrWhiteSpace(chaveDoUsuario) ? chaveDoUsuario : chaveDoServidor;

        var modeloPadrao = provedor == "anthropic" ? _anthropicPadrao.Model : _openRouterPadrao.Model;
        var modelo = string.IsNullOrWhiteSpace(config?.Modelo) ? modeloPadrao : config!.Modelo!;

        // Provedor escolhido mas sem chave nenhuma: cai no heurístico em vez de
        // falhar em toda requisição.
        if (provedor != "heuristico" && string.IsNullOrWhiteSpace(chave))
        {
            return ("heuristico", null, "", false);
        }

        return (provedor, chave, modelo, !string.IsNullOrWhiteSpace(chaveDoUsuario));
    }

    private ILlmExtractor Montar(string provedor, string? chave, string? modelo)
    {
        switch (provedor)
        {
            case "openrouter":
            {
                var opcoes = Clonar(_openRouterPadrao);
                opcoes.ApiKey = chave ?? "";
                if (!string.IsNullOrWhiteSpace(modelo)) opcoes.Model = modelo;

                return new OpenRouterLlmExtractor(
                    _httpClientFactory.CreateClient(nameof(OpenRouterLlmExtractor)),
                    Options.Create(opcoes),
                    _loggerFactory.CreateLogger<OpenRouterLlmExtractor>());
            }

            case "anthropic":
            {
                var opcoes = Clonar(_anthropicPadrao);
                opcoes.ApiKey = chave ?? "";
                if (!string.IsNullOrWhiteSpace(modelo)) opcoes.Model = modelo;

                return new AnthropicLlmExtractor(
                    _httpClientFactory.CreateClient(nameof(AnthropicLlmExtractor)),
                    Options.Create(opcoes),
                    _loggerFactory.CreateLogger<AnthropicLlmExtractor>());
            }

            default:
                return new HeuristicLlmExtractor();
        }
    }

    // As opções vêm de IOptions, que é compartilhado por todo o processo; alterar
    // a instância original vazaria a chave de um usuário para os outros.
    private static OpenRouterOptions Clonar(OpenRouterOptions o) => new()
    {
        ApiKey = o.ApiKey, Model = o.Model, BaseUrl = o.BaseUrl, Referer = o.Referer, Titulo = o.Titulo,
        MaxTokens = o.MaxTokens, TimeoutSegundos = o.TimeoutSegundos,
        TimeoutComAnexosSegundos = o.TimeoutComAnexosSegundos, MaxTentativas = o.MaxTentativas,
    };

    private static AnthropicOptions Clonar(AnthropicOptions o) => new()
    {
        ApiKey = o.ApiKey, Model = o.Model, ApiVersion = o.ApiVersion, BaseUrl = o.BaseUrl,
        MaxTokens = o.MaxTokens, TimeoutSegundos = o.TimeoutSegundos, MaxTentativas = o.MaxTentativas,
    };

    public static string Normalizar(string? provedor) => (provedor ?? "").Trim().ToLowerInvariant() switch
    {
        "openrouter" => "openrouter",
        "anthropic" => "anthropic",
        "heuristico" or "heurístico" => "heuristico",
        _ => "heuristico",
    };

    /// <summary>Provedores que o cliente pode escolher na tela de configurações.</summary>
    public static readonly string[] ProvedoresValidos = { "openrouter", "anthropic", "heuristico" };
}
