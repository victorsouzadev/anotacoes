namespace Notas.Api.Dtos;

public record SalvarMetaRequest(string Nome, decimal ValorAlvo, DateOnly? DataAlvo, string? Observacoes);

// Um aporte avulso informa valor e data; um aporte vinculado informa a transação
// de investimento e herda valor e data dela.
public record CriarAporteRequest(decimal? Valor, DateOnly? Data, string? Observacoes, Guid? TransacaoId);

public record AporteResponse(
    Guid Id, decimal Valor, DateOnly Data, string? Observacoes, Guid? TransacaoId, DateTime CriadoEm);

public record MetaResponse(
    Guid Id,
    string Nome,
    decimal ValorAlvo,
    DateOnly? DataAlvo,
    string? Observacoes,
    decimal ValorAcumulado,
    decimal ValorRestante,
    decimal PercentualConcluido,
    bool Concluida,
    bool Arquivada,
    // Quanto precisa ser guardado por mês, daqui até o prazo, para bater a meta.
    decimal? AporteMensalNecessario,
    int? MesesRestantes,
    // Média mensal dos aportes já feitos — o ritmo atual, para comparar com o exigido.
    decimal RitmoMensalAtual,
    // "sem_prazo" | "no_ritmo" | "atrasada" | "concluida" | "vencida"
    string Situacao,
    // Projeção de quando a meta fecharia mantido o ritmo atual; nulo se o ritmo é zero.
    DateOnly? PrevisaoDeConclusao,
    List<AporteResponse> Aportes,
    DateTime CriadoEm);

// Transação de investimento ainda não vinculada a nenhuma meta — candidata a
// virar aporte com um clique.
public record InvestimentoDisponivelResponse(Guid Id, string Descricao, decimal Valor, DateOnly Data);
