using Notas.Api.Services.Dieta;

namespace Notas.Api.Dtos;

// Preferencias nulo = não mexe (o app antigo não manda; quem grava é a entrevista do chat).
public record DietaPerfilDto(
    double AlturaCm, DateOnly? Nascimento, string Sexo, double Atividade, string Objetivo,
    int MetaKcal, int MetaProteinaG, int MetaCarboG, int MetaGorduraG, int MetaAguaMl, DateTime UpdatedAt,
    string? Preferencias = null);

public record DietaPerfilResposta(DietaPerfilDto? Perfil, double? PesoAtual, MetasDieta Metas, MetasDieta Sugestao);

public record DietaAlimentoDto(
    string Id, string Nome, double Kcal, double Proteina, double Carbo, double Gordura, double Fibra, double Sodio,
    double PorcaoG, string? PorcaoNome, string? CodigoBarras, string Fonte, string? Itens, bool Favorito,
    bool Proprio, DateTime UpdatedAt, DateTime? DeletedAt);

public record DietaAlimentoUpsert(
    string Nome, double Kcal, double Proteina, double Carbo, double Gordura, double Fibra, double Sodio,
    double PorcaoG, string? PorcaoNome, string? CodigoBarras, string? Fonte, string? Itens, bool Favorito,
    DateTime UpdatedAt, DateTime? DeletedAt);

public record ReceitaItem(string? AlimentoId, string Nome, double Gramas);

public record DietaRegistroDto(
    string Id, DateOnly Data, string Refeicao, string? AlimentoId, string Nome, double QuantidadeG,
    double Kcal, double Proteina, double Carbo, double Gordura, double Fibra, string? FotoId,
    DateTime CreatedAt, DateTime UpdatedAt, DateTime? DeletedAt);

/// <summary>Valores zerados com AlimentoId preenchido = o servidor calcula a partir do alimento.</summary>
public record DietaRegistroUpsert(
    DateOnly Data, string Refeicao, string? AlimentoId, string? Nome, double QuantidadeG,
    double Kcal, double Proteina, double Carbo, double Gordura, double Fibra, string? FotoId,
    DateTime CreatedAt, DateTime UpdatedAt, DateTime? DeletedAt);

public record DietaPesoDto(string Id, DateOnly Data, double Kg, DateTime UpdatedAt, DateTime? DeletedAt);
public record DietaPesoUpsert(DateOnly Data, double Kg, DateTime UpdatedAt, DateTime? DeletedAt);

public record DietaAguaDto(string Id, DateOnly Data, int Ml, DateTime UpdatedAt, DateTime? DeletedAt);
public record DietaAguaUpsert(DateOnly Data, int Ml, DateTime UpdatedAt, DateTime? DeletedAt);

public record DietaPlanoDto(string Id, int DiaSemana, string Refeicao, string? AlimentoId, string Nome, double QuantidadeG, DateTime UpdatedAt, DateTime? DeletedAt,
    int Opcao, string? Observacao);
// Opcao e Observacao opcionais: versões antigas do app não mandam (valem 1 e nulo).
public record DietaPlanoUpsert(int DiaSemana, string Refeicao, string? AlimentoId, string Nome, double QuantidadeG, DateTime UpdatedAt, DateTime? DeletedAt,
    int Opcao = 1, string? Observacao = null);

public record DietaFotoDto(string Id, DateOnly Data, string Tipo, string? Rotulo, string ContentType, int SizeBytes, DateTime CreatedAt, DateTime? DeletedAt);

public record DietaDiaResposta(
    DiaDieta Totais, MetasDieta Metas, int? AdesaoPlano, List<DietaRegistroDto> Registros, List<DietaAguaDto> Agua, double? Peso);

public record DietaCompartilhamentoDto(string Id, string Titulo, List<string> Escopos, string Url, DateTime? ExpiraEm, DateTime? RevogadoEm, DateTime CreatedAt);
public record DietaCompartilhamentoCriar(string? Titulo, List<string> Escopos, int? DiasValidade);
