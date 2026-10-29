namespace Notas.Api.Dtos;

public record SalvarOperacaoRequest(
    string Ticker, string Tipo, decimal Quantidade, decimal PrecoUnitario, decimal? Taxas, DateOnly Data, string? Observacoes);

public record OperacaoResponse(
    Guid Id, string Ticker, string Tipo, decimal Quantidade, decimal PrecoUnitario, decimal Taxas, DateOnly Data,
    string? Observacoes, decimal Total);

public record PosicaoResponse(
    string Ticker,
    string? Nome,
    decimal Quantidade,
    decimal PrecoMedio,
    decimal Custo,
    // Cotação atual; nula quando a brapi não respondeu para o ativo.
    decimal? Cotacao,
    decimal? VariacaoDia,
    decimal? ValorAtual,
    decimal? Resultado,
    decimal? ResultadoPercentual,
    // Lucro ou prejuízo já realizado nas vendas (pelo preço médio da época).
    decimal ResultadoRealizado,
    DateTime? CotacaoEm);

public record CarteiraResponse(
    List<PosicaoResponse> Posicoes,
    decimal Custo,
    decimal? ValorAtual,
    decimal? Resultado,
    decimal? ResultadoPercentual,
    decimal ResultadoRealizado,
    // Falso quando não há token da brapi configurado e algum ativo ficou sem cotação.
    bool CotacoesCompletas);
