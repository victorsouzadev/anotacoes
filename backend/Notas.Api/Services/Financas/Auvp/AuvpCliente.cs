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

    /// <summary>De quantas em quantas horas sincronizar sozinho. 0 desliga.</summary>
    public int IntervaloSincronizacaoHoras { get; set; } = 6;
}

/// <summary>Falha ao falar com a AUVP: chave recusada, API fora do ar, resposta inesperada.</summary>
public class AuvpIndisponivelException(string mensagem, bool chaveRecusada = false) : Exception(mensagem)
{
    public bool ChaveRecusada { get; } = chaveRecusada;
}

public class AuvpNaoEncontradoException() : AuvpIndisponivelException("Não encontrado na AUVP.");

// Só os campos usados; o resto da resposta é ignorado.
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
    [property: JsonPropertyName("user_account")] AuvpConta? UserAccount,
    [property: JsonPropertyName("transaction_tags")] List<AuvpTransacaoTag>? TransactionTags = null,
    [property: JsonPropertyName("reference_month")] DateTimeOffset? ReferenceMonth = null,
    [property: JsonPropertyName("budget")] AuvpOrcamentoRef? Budget = null,
    [property: JsonPropertyName("is_recurrent")] bool IsRecurrent = false);

public record AuvpConta(
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("subtype")] string? Subtype);

public record AuvpTransacaoTag([property: JsonPropertyName("tag")] AuvpTag? Tag);

public record AuvpTag(
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("id")] long Id = 0,
    [property: JsonPropertyName("color")] string? Color = null,
    [property: JsonPropertyName("status")] string? Status = null);

public record AuvpOrcamentoRef(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("key")] string? Key);

public record AuvpPagina(
    [property: JsonPropertyName("transactions")] List<AuvpTransacao> Transactions,
    [property: JsonPropertyName("pagination")] AuvpPaginacao? Pagination);

public record AuvpPaginacao(
    [property: JsonPropertyName("page")] int Page,
    [property: JsonPropertyName("totalPages")] int TotalPages);

// ---------------------------------------------------------------- contas e faturas

public record AuvpContasResposta([property: JsonPropertyName("accounts")] List<AuvpContaDetalhe> Accounts);

public record AuvpContaDetalhe(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("external_id")] string? ExternalId,
    [property: JsonPropertyName("type")] string? Type,
    [property: JsonPropertyName("subtype")] string? Subtype,
    [property: JsonPropertyName("balance")] decimal Balance,
    [property: JsonPropertyName("number")] string? Number,
    [property: JsonPropertyName("last_synced_at")] DateTimeOffset? LastSyncedAt,
    [property: JsonPropertyName("credit_account_data")] AuvpDadosCartao? CreditAccountData);

public record AuvpDadosCartao(
    [property: JsonPropertyName("brand")] string? Brand,
    [property: JsonPropertyName("balance_due_date")] DateTimeOffset? BalanceDueDate,
    [property: JsonPropertyName("available_limit")] string? AvailableLimit,
    [property: JsonPropertyName("total_limit")] string? TotalLimit);

public record AuvpFaturaEstimada(
    [property: JsonPropertyName("referenceMonth")] DateTimeOffset? ReferenceMonth,
    [property: JsonPropertyName("projectedTotal")] decimal ProjectedTotal);

public record AuvpFatura(
    [property: JsonPropertyName("due_date")] DateTimeOffset? DueDate,
    [property: JsonPropertyName("total_amount")] string? TotalAmount);

// ---------------------------------------------------------------- orçamentos

public record AuvpOrcamentoMensal(
    [property: JsonPropertyName("totals")] AuvpOrcamentoTotais? Totals,
    [property: JsonPropertyName("resume")] List<AuvpOrcamentoResumo> Resume);

public record AuvpOrcamentoTotais(
    [property: JsonPropertyName("totalSpent")] decimal TotalSpent,
    [property: JsonPropertyName("totalToSpend")] decimal TotalToSpend,
    [property: JsonPropertyName("utilized")] decimal Utilized,
    [property: JsonPropertyName("uncategorized")] decimal Uncategorized);

public record AuvpOrcamentoResumo(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("goal")] decimal Goal,
    [property: JsonPropertyName("amountToSpent")] decimal AmountToSpend,
    [property: JsonPropertyName("amountSpent")] decimal AmountSpent,
    [property: JsonPropertyName("remaining")] decimal Remaining,
    [property: JsonPropertyName("utilized")] decimal Utilized);

public record AuvpOrcamento(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("key")] string? Key);

/// <summary>
/// Alterações de uma transação a mandar para a AUVP. Campo null = não mexer;
/// para limpar o orçamento existe a flag, já que null não diria isso.
/// </summary>
public record AuvpAlteracao(
    bool? Ignorar = null,
    string? DescricaoExibida = null,
    string? Observacoes = null,
    int? OrcamentoId = null,
    bool LimparOrcamento = false)
{
    public bool Vazia => Ignorar is null && DescricaoExibida is null && Observacoes is null
                         && OrcamentoId is null && !LimparOrcamento;
}

public interface IAuvpCliente
{
    bool Habilitado { get; }

    Task<AuvpPagina> ListarTransacoesAsync(string chave, DateOnly? de, DateOnly? ate, int pagina, int limite,
        CancellationToken ct);

    Task<List<AuvpTag>> ListarTagsAsync(string chave, CancellationToken ct);
    Task<List<AuvpOrcamento>> ListarOrcamentosAsync(string chave, CancellationToken ct);
    Task<AuvpOrcamentoMensal> OrcamentoMensalAsync(string chave, DateOnly mes, CancellationToken ct);
    Task<List<AuvpContaDetalhe>> ListarContasAsync(string chave, CancellationToken ct);
    Task<AuvpFaturaEstimada?> FaturaEstimadaAsync(string chave, string contaIdExterno, CancellationToken ct);

    Task AtualizarTransacaoAsync(string chave, long id, AuvpAlteracao alteracao, CancellationToken ct);
    Task AdicionarTagsAsync(string chave, long id, IReadOnlyCollection<long> tagIds, CancellationToken ct);
    Task RemoverTagsAsync(string chave, long id, IReadOnlyCollection<long> tagIds, CancellationToken ct);
}

public class AuvpCliente(IHttpClientFactory httpFactory, IOptions<AuvpOptions> opcoes) : IAuvpCliente
{
    public bool Habilitado => !string.IsNullOrWhiteSpace(opcoes.Value.BaseUrl);

    public Task<AuvpPagina> ListarTransacoesAsync(string chave, DateOnly? de, DateOnly? ate, int pagina,
        int limite, CancellationToken ct)
    {
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
            query.Add($"from={Iso(de ?? new DateOnly(2000, 1, 1))}");
            query.Add($"to={Iso(ate ?? new DateOnly(2100, 12, 31))}");
        }

        return LerAsync<AuvpPagina>(chave, HttpMethod.Get, $"/transactions?{string.Join('&', query)}", null, ct);
    }

    public async Task<List<AuvpTag>> ListarTagsAsync(string chave, CancellationToken ct)
    {
        // Esta rota embrulha a lista em { status, message, data }.
        var r = await LerAsync<JsonElement>(chave, HttpMethod.Get, "/tags", null, ct);
        var lista = r.ValueKind == JsonValueKind.Object && r.TryGetProperty("data", out var d) ? d : r;
        return lista.Deserialize<List<AuvpTag>>() ?? [];
    }

    public Task<List<AuvpOrcamento>> ListarOrcamentosAsync(string chave, CancellationToken ct) =>
        LerAsync<List<AuvpOrcamento>>(chave, HttpMethod.Get, "/budgets", null, ct);

    public Task<AuvpOrcamentoMensal> OrcamentoMensalAsync(string chave, DateOnly mes, CancellationToken ct) =>
        LerAsync<AuvpOrcamentoMensal>(chave, HttpMethod.Get, $"/budgets/monthly?date={Iso(mes)}", null, ct);

    public async Task<List<AuvpContaDetalhe>> ListarContasAsync(string chave, CancellationToken ct) =>
        (await LerAsync<AuvpContasResposta>(chave, HttpMethod.Get, "/accounts", null, ct)).Accounts;

    // A rota de fatura usa o id da conta na instituição (external_id), não o numérico.
    public async Task<AuvpFaturaEstimada?> FaturaEstimadaAsync(string chave, string contaIdExterno,
        CancellationToken ct)
    {
        try
        {
            return await LerAsync<AuvpFaturaEstimada>(chave, HttpMethod.Get,
                $"/bills/account/{Uri.EscapeDataString(contaIdExterno)}/estimated", null, ct);
        }
        catch (AuvpNaoEncontradoException)
        {
            return null; // cartão sem fatura (conta manual ou sem dados do banco)
        }
    }

    // Nomes dos campos de escrita no padrão do corpo das listagens (budgetId,
    // categoryId). Se a AUVP recusar algum, a mensagem dela chega ao usuário
    // inteira (ver ChamarAsync), para o ajuste ser só aqui.
    public Task AtualizarTransacaoAsync(string chave, long id, AuvpAlteracao a, CancellationToken ct)
    {
        var corpo = new Dictionary<string, object?>();
        if (a.Ignorar is { } ignorar) corpo["ignore"] = ignorar;
        if (a.DescricaoExibida is not null)
            corpo["displayDescription"] = a.DescricaoExibida.Length == 0 ? null : a.DescricaoExibida;
        if (a.Observacoes is not null) corpo["observations"] = a.Observacoes;
        if (a.OrcamentoId is { } orcamento) corpo["budgetId"] = orcamento;
        else if (a.LimparOrcamento) corpo["budgetId"] = null;
        return EnviarAsync(chave, HttpMethod.Patch, $"/transactions/{id}", corpo, ct);
    }

    public Task AdicionarTagsAsync(string chave, long id, IReadOnlyCollection<long> tagIds, CancellationToken ct) =>
        tagIds.Count == 0
            ? Task.CompletedTask
            : EnviarAsync(chave, HttpMethod.Post, $"/transactions/{id}/tags", new { tagIds }, ct);

    public Task RemoverTagsAsync(string chave, long id, IReadOnlyCollection<long> tagIds, CancellationToken ct) =>
        tagIds.Count == 0
            ? Task.CompletedTask
            : EnviarAsync(chave, HttpMethod.Delete, $"/transactions/{id}/tags", new { tagIds }, ct);

    // ---------------------------------------------------------------- transporte

    private static string Iso(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private async Task<T> LerAsync<T>(string chave, HttpMethod metodo, string caminho, object? corpo,
        CancellationToken ct)
    {
        using var res = await ChamarAsync(chave, metodo, caminho, corpo, ct);
        try
        {
            var valor = await res.Content.ReadFromJsonAsync<T>(cancellationToken: ct);
            return valor ?? throw new AuvpIndisponivelException("A AUVP devolveu uma resposta vazia.");
        }
        catch (JsonException ex)
        {
            throw new AuvpIndisponivelException($"Resposta da AUVP em formato inesperado: {ex.Message}");
        }
    }

    private async Task EnviarAsync(string chave, HttpMethod metodo, string caminho, object? corpo,
        CancellationToken ct)
    {
        using var _ = await ChamarAsync(chave, metodo, caminho, corpo, ct);
    }

    private async Task<HttpResponseMessage> ChamarAsync(string chave, HttpMethod metodo, string caminho,
        object? corpo, CancellationToken ct)
    {
        var o = opcoes.Value;
        using var req = new HttpRequestMessage(metodo, $"{o.BaseUrl.TrimEnd('/')}{caminho}");
        if (o.HeaderChave.Equals("Authorization", StringComparison.OrdinalIgnoreCase))
            req.Headers.Authorization = AuthenticationHeaderValue.Parse(o.PrefixoChave + chave);
        else
            req.Headers.TryAddWithoutValidation(o.HeaderChave, o.PrefixoChave + chave);
        if (corpo is not null) req.Content = JsonContent.Create(corpo);

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

        if (res.IsSuccessStatusCode) return res;

        using (res)
        {
            if (res.StatusCode == HttpStatusCode.NotFound && metodo == HttpMethod.Get)
                throw new AuvpNaoEncontradoException();

            // A mensagem da AUVP diz o que ela não aceitou ("property x should not
            // exist", "API key inválida"); sem ela não haveria como saber o que ajustar.
            var detalhe = await LerMensagemAsync(res, ct);
            var sufixo = detalhe is null ? "" : $" (AUVP: {detalhe})";

            // Ler e alterar têm permissões diferentes: uma chave somente leitura
            // sincroniza normalmente e só leva 401/403 ao tentar gravar. Dizer
            // "chave recusada" nesse caso manda o usuário trocar uma chave que funciona.
            if (res.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                throw metodo == HttpMethod.Get
                    ? new AuvpIndisponivelException($"A AUVP recusou a chave de API{sufixo}.", chaveRecusada: true)
                    : new AuvpIndisponivelException(
                        $"A chave da AUVP não tem permissão para alterar transações — ela pode ser somente leitura{sufixo}.");

            throw new AuvpIndisponivelException(
                $"A AUVP respondeu {(int)res.StatusCode}{(detalhe is null ? "" : $": {detalhe}")}.");
        }
    }

    private static async Task<string?> LerMensagemAsync(HttpResponseMessage res, CancellationToken ct)
    {
        try
        {
            var texto = await res.Content.ReadAsStringAsync(ct);
            if (string.IsNullOrWhiteSpace(texto)) return null;
            using var doc = JsonDocument.Parse(texto);
            if (doc.RootElement.ValueKind == JsonValueKind.Object
                && doc.RootElement.TryGetProperty("message", out var m))
                return m.ValueKind == JsonValueKind.Array
                    ? string.Join("; ", m.EnumerateArray().Select(x => x.ToString()))
                    : m.ToString();
            return texto.Length > 300 ? texto[..300] : texto;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
