using Notas.Api.Data;
using Notas.Api.Services.Financas;

namespace Notas.Api.Dtos;

// Corpo de entrada do POST /api/financas/transacoes: texto livre digitado pelo usuário.
public record CriarTransacaoRequest(string Texto);

// Representação de uma transação já persistida, devolvida pela API.
public record TransacaoResponse(
    Guid Id, string Descricao, decimal Valor, string Tipo, string Categoria, string CategoriaRotulo,
    DateOnly Data, string? FormaPagamento, string TextoOriginal, float ConfiancaIa,
    string Status, string? Observacoes, DateTime CriadoEm, bool ForaDosTotais, string? Origem,
    DateOnly Competencia, int? Parcela, int? TotalParcelas, string? Conta, IReadOnlyList<string> Tags,
    string? OrcamentoAuvp,
    // Só no PATCH: por que a AUVP não recebeu a mudança, e quantos lançamentos
    // parecidos ainda estão em outra categoria (para oferecer "aplicar a todos").
    string? AvisoAuvp = null, int? Semelhantes = null)
{
    public static TransacaoResponse FromEntity(Transacao t) => new(
        t.Id, t.Descricao, t.Valor, t.Tipo.ToString().ToLowerInvariant(), t.Categoria.ToString(),
        CategoriaInfo.Rotulo(t.Categoria),
        t.Data, t.FormaPagamento?.ToString(), t.TextoOriginal, t.ConfiancaIa,
        t.Status == StatusTransacao.PendenteRevisao ? "pendente_revisao" : "confirmado",
        t.Observacoes, t.CriadoEm, t.ForaDosTotais, t.OrigemExterna,
        t.Competencia, t.Parcela, t.TotalParcelas, t.Conta, t.ListaDeTags(), t.OrcamentoAuvp);
}

// Corpo de entrada do PATCH /api/financas/transacoes/{id}: qualquer campo pode ser corrigido pelo usuário.
// Campo ausente (null) significa "não alterar"; para apagar a forma de pagamento
// existe a flag explícita, já que null não conseguiria expressar isso.
public record AtualizarTransacaoRequest(
    string? Descricao, decimal? Valor, TipoTransacao? Tipo, Categoria? Categoria,
    DateOnly? Data, FormaPagamento? FormaPagamento, string? Observacoes, StatusTransacao? Status,
    bool? LimparFormaPagamento, bool? ForaDosTotais = null,
    // Tags: lista completa desejada (null = não mexer). Orçamento AUVP: chave
    // (CUSTOS_FIXOS…); LimparOrcamento tira o que houver.
    List<string>? Tags = null, string? OrcamentoAuvp = null, bool? LimparOrcamento = null);

// PATCH /api/financas/transacoes/lote — mesma mudança em vários lançamentos.
public record AtualizarLoteRequest(
    List<Guid> Ids, Categoria? Categoria = null, bool? ForaDosTotais = null,
    List<string>? AdicionarTags = null, List<string>? RemoverTags = null,
    string? OrcamentoAuvp = null, bool? LimparOrcamento = null);

public record AtualizarLoteResponse(int Atualizados, int FalhasAuvp, string? PrimeiraFalhaAuvp);

// Resposta do POST /api/financas/transacoes/importar: os lançamentos criados a
// partir de um ou mais arquivos, e o que não pôde ser aproveitado.
public record ImportacaoResponse(
    int QuantidadeCriada,
    List<TransacaoResponse> Transacoes,
    List<string> Descartes,
    // Quando o documento rende mais lançamentos que o teto configurado, os
    // excedentes não são gravados e a interface precisa avisar.
    bool AtingiuLimite);

// GET /api/financas/capacidades — o que a instalação atual consegue fazer, para a
// interface não oferecer importação de arquivo num servidor sem chave de LLM.
public record CapacidadesResponse(
    string Provedor,
    bool SuportaAnexos,
    int MaxArquivos,
    int MaxTamanhoArquivoMb,
    string[] ExtensoesAceitas);

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
