using Notas.Api.Data;
using Notas.Api.Services.Financas;

namespace Notas.Api.Dtos;

// Corpo de entrada do POST /api/financas/transacoes: texto livre digitado pelo usuário.
public record CriarTransacaoRequest(string Texto);

// Representação de uma transação já persistida, devolvida pela API.
public record TransacaoResponse(
    Guid Id, string Descricao, decimal Valor, string Tipo, string Categoria, string CategoriaRotulo,
    DateOnly Data, string? FormaPagamento, string TextoOriginal, float ConfiancaIa,
    string Status, string? Observacoes, DateTime CriadoEm)
{
    public static TransacaoResponse FromEntity(Transacao t) => new(
        t.Id, t.Descricao, t.Valor, t.Tipo.ToString().ToLowerInvariant(), t.Categoria.ToString(),
        CategoriaInfo.Rotulo(t.Categoria),
        t.Data, t.FormaPagamento?.ToString(), t.TextoOriginal, t.ConfiancaIa,
        t.Status == StatusTransacao.PendenteRevisao ? "pendente_revisao" : "confirmado",
        t.Observacoes, t.CriadoEm);
}

// Corpo de entrada do PATCH /api/financas/transacoes/{id}: qualquer campo pode ser corrigido pelo usuário.
// Campo ausente (null) significa "não alterar"; para apagar a forma de pagamento
// existe a flag explícita, já que null não conseguiria expressar isso.
public record AtualizarTransacaoRequest(
    string? Descricao, decimal? Valor, TipoTransacao? Tipo, Categoria? Categoria,
    DateOnly? Data, FormaPagamento? FormaPagamento, string? Observacoes, StatusTransacao? Status,
    bool? LimparFormaPagamento);

// GET /api/financas/dashboard/resumo
public record ResumoResponse(
    int Ano, int Mes,
    decimal TotalReceitas, decimal TotalDespesas, decimal Saldo,
    string? MaiorCategoriaGasto, string? MaiorCategoriaGastoRotulo, decimal MaiorCategoriaGastoValor,
    decimal SaldoMesAnterior,
    // Nulo quando não há mês anterior com que comparar.
    decimal? VariacaoPercentualSaldo,
    int QuantidadeLancamentos, int QuantidadePendentes);

// Item usado em GET /api/financas/dashboard/categorias
public record CategoriaResumo(string Categoria, string CategoriaRotulo, decimal Total, decimal Percentual, int Quantidade);

// Item usado em GET /api/financas/dashboard/tendencias
public record TendenciaPeriodo(string Periodo, string PeriodoRotulo, decimal Receitas, decimal Despesas, decimal Saldo);
