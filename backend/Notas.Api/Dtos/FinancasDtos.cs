using Notas.Api.Data;

namespace Notas.Api.Dtos;

// Corpo de entrada do POST /api/financas/transacoes: texto livre digitado pelo usuário.
public record CriarTransacaoRequest(string Texto);

// Representação de uma transação já persistida, devolvida pela API.
public record TransacaoResponse(
    Guid Id, string Descricao, decimal Valor, string Tipo, string Categoria,
    DateOnly Data, string? FormaPagamento, string TextoOriginal, float ConfiancaIa,
    string Status, string? Observacoes, DateTime CriadoEm)
{
    public static TransacaoResponse FromEntity(Transacao t) => new(
        t.Id, t.Descricao, t.Valor, t.Tipo.ToString().ToLowerInvariant(), t.Categoria.ToString(),
        t.Data, t.FormaPagamento?.ToString(), t.TextoOriginal, t.ConfiancaIa,
        t.Status == StatusTransacao.PendenteRevisao ? "pendente_revisao" : "confirmado",
        t.Observacoes, t.CriadoEm);
}

// Corpo de entrada do PATCH /api/financas/transacoes/{id}: qualquer campo pode ser corrigido pelo usuário.
public record AtualizarTransacaoRequest(
    string? Descricao, decimal? Valor, TipoTransacao? Tipo, Categoria? Categoria,
    DateOnly? Data, FormaPagamento? FormaPagamento, string? Observacoes, StatusTransacao? Status);

// GET /api/financas/dashboard/resumo
public record ResumoResponse(
    decimal TotalReceitas, decimal TotalDespesas, decimal Saldo, string? MaiorCategoriaGasto,
    decimal SaldoMesAnterior, decimal VariacaoPercentualSaldo);

// Item usado em GET /api/financas/dashboard/categorias
public record CategoriaResumo(string Categoria, decimal Total, decimal Percentual);

// Item usado em GET /api/financas/dashboard/tendencias
public record TendenciaPeriodo(string Periodo, decimal Receitas, decimal Despesas, decimal Saldo);
