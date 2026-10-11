using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace Notas.Api.Services.Financas.Auvp;

public class AuvpOptions
{
    public const string SectionName = "Auvp";

    /// <summary>URL base da API AUVP Financeiro. Vazia = integração desligada no servidor.</summary>
    public string BaseUrl { get; set; } = "";

    /// <summary>
    /// Header onde a chave vai. A API REST só lê "Authorization: Bearer auvp_...";
    /// o "x-api-key" vale apenas no endpoint /mcp.
    /// </summary>
    public string HeaderChave { get; set; } = "Authorization";
    public string PrefixoChave { get; set; } = "Bearer ";

    public int TimeoutSegundos { get; set; } = 30;

    /// <summary>Teto de páginas por sincronização — protege contra laço se a API paginar errado.</summary>
    public int MaxPaginas { get; set; } = 200;
}

/// <summary>Falha ao falar com a AUVP: chave recusada, API fora do ar, resposta inesperada.</summary>
public class AuvpIndisponivelException(string mensagem, bool chaveRecusada = false) : Exception(mensagem)
{
    public bool ChaveRecusada { get; } = chaveRecusada;
}

// Só os campos usados na importação; o resto da resposta é ignorado.
public record AuvpTransacao(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("amount")] decimal Amount,
    [property: JsonPropertyName("type")] string? Type,
    [property: JsonPropertyName("date")] DateTimeOffset Date,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("categoryId")] int? CategoryId,
    [property: JsonPropertyName("observations")] string? Observations,
    [property: JsonPropertyName("ignore")] bool Ignore,
    [property: JsonPropertyName("is_internal_transfer")] bool IsInternalTransfer,
    [property: JsonPropertyName("user_account")] AuvpConta? UserAccount);

public record AuvpConta(
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("subtype")] string? Subtype);

public record AuvpPagina(
    [property: JsonPropertyName("transactions")] List<AuvpTransacao> Transactions,
    [property: JsonPropertyName("pagination")] AuvpPaginacao? Pagination);

public record AuvpPaginacao(
    [property: JsonPropertyName("page")] int Page,
    [property: JsonPropertyName("totalPages")] int TotalPages);

public interface IAuvpCliente
{
    bool Habilitado { get; }

    Task<AuvpPagina> ListarTransacoesAsync(string chave, DateOnly? de, DateOnly? ate, int pagina, int limite,
        CancellationToken ct);
}

public class AuvpCliente(IHttpClientFactory httpFactory, IOptions<AuvpOptions> opcoes) : IAuvpCliente
{
    public bool Habilitado => !string.IsNullOrWhiteSpace(opcoes.Value.BaseUrl);

    public async Task<AuvpPagina> ListarTransacoesAsync(string chave, DateOnly? de, DateOnly? ate, int pagina,
        int limite, CancellationToken ct)
    {
        var o = opcoes.Value;
        var query = new List<string>
        {
            $"page={pagina}",
            $"limit={limite}",
            "sortBy=date",
            "sortOrder=asc",
            // Sem filtro de transferência: a resposta já traz tudo, ignoradas e
            // transferências internas incluídas. "includeInternalTransfers=true"
            // não acrescenta — devolve SÓ as transferências e ignoradas.
        };

        // A API só aplica o período com as duas pontas; uma sozinha é ignorada
        // em silêncio e volta o histórico inteiro.
        if (de is not null || ate is not null)
        {
            var inicio = de ?? new DateOnly(2000, 1, 1);
            var fim = ate ?? new DateOnly(2100, 12, 31);
            query.Add($"from={inicio.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}");
            query.Add($"to={fim.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}");
        }

        var url = $"{o.BaseUrl.TrimEnd('/')}/transactions?{string.Join('&', query)}";
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        if (o.HeaderChave.Equals("Authorization", StringComparison.OrdinalIgnoreCase))
            req.Headers.Authorization = AuthenticationHeaderValue.Parse(o.PrefixoChave + chave);
        else
            req.Headers.TryAddWithoutValidation(o.HeaderChave, o.PrefixoChave + chave);

        var http = httpFactory.CreateClient(nameof(AuvpCliente));
        HttpResponseMessage res;
        try
        {
            res = await http.SendAsync(req, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            throw new AuvpIndisponivelException($"Não foi possível falar com a AUVP: {ex.Message}");
        }

        using (res)
        {
            if (res.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                throw new AuvpIndisponivelException("A AUVP recusou a chave de API.", chaveRecusada: true);

            if (!res.IsSuccessStatusCode)
                throw new AuvpIndisponivelException($"A AUVP respondeu {(int)res.StatusCode}.");

            try
            {
                var corpo = await res.Content.ReadFromJsonAsync<AuvpPagina>(cancellationToken: ct);
                return corpo ?? throw new AuvpIndisponivelException("A AUVP devolveu uma resposta vazia.");
            }
            catch (JsonException ex)
            {
                throw new AuvpIndisponivelException($"Resposta da AUVP em formato inesperado: {ex.Message}");
            }
        }
    }
}
