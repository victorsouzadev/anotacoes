using Notas.Api.Data;

namespace Notas.Api.Dtos;

// Uma fatia da distribuição, como o cliente a envia. Só o percentual é enviado:
// o valor em reais é sempre derivado de ValorTotal.
public record OrcamentoItemRequest(Categoria Categoria, decimal Percentual);

// PUT /api/financas/orcamentos — cria ou substitui o orçamento do mês.
public record SalvarOrcamentoRequest(
    int Ano, int Mes, decimal ValorTotal, List<OrcamentoItemRequest> Itens, string? Observacoes);

public record OrcamentoItemResponse(
    string Categoria, string CategoriaRotulo, string Grupo, decimal Percentual, decimal ValorPlanejado);

public record OrcamentoResponse(
    Guid Id, int Ano, int Mes, decimal ValorTotal, string? Observacoes,
    List<OrcamentoItemResponse> Itens, DateTime CriadoEm, DateTime AtualizadoEm);

// Item do acompanhamento: quanto foi planejado x quanto já saiu de fato.
public record AcompanhamentoItemResponse(
    string Categoria,
    string CategoriaRotulo,
    string Grupo,
    decimal Percentual,
    decimal ValorPlanejado,
    decimal ValorRealizado,
    decimal ValorRestante,
    decimal PercentualUtilizado,
    // "ok" | "atencao" | "estourado" | "sem_orcamento"
    string Situacao);

public record AcompanhamentoGrupoResponse(
    string Grupo, string GrupoRotulo, decimal Percentual,
    decimal ValorPlanejado, decimal ValorRealizado);

// GET /api/financas/orcamentos/acompanhamento
public record AcompanhamentoResponse(
    int Ano,
    int Mes,
    bool TemOrcamento,
    decimal ValorTotal,
    decimal TotalPlanejado,
    decimal TotalRealizado,
    decimal SaldoDisponivel,
    decimal PercentualUtilizado,
    // Quanto do mês já passou — para comparar ritmo de gasto com ritmo do calendário.
    decimal PercentualDoMesDecorrido,
    decimal ProjecaoFimDoMes,
    List<AcompanhamentoItemResponse> Itens,
    List<AcompanhamentoGrupoResponse> Grupos);

// Modelo de distribuição pronto (ex.: 50/30/20), oferecido na tela de cadastro.
public record ModeloOrcamentoResponse(
    string Id, string Nome, string Descricao, List<OrcamentoItemResponse> Itens);

// POST /api/financas/orcamentos/copiar — replica a distribuição de outro mês.
public record CopiarOrcamentoRequest(int AnoOrigem, int MesOrigem, int AnoDestino, int MesDestino, decimal? ValorTotal);
