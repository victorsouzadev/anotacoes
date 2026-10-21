namespace Notas.Api.Dtos;

public record TreinoAtividadeDto(
    string Id, DateTime Inicio, string Tipo, string Titulo, int DuracaoSeg, double DistanciaM, int? MaiorCorridaSeg,
    int? Esforco, bool Dor, string? Meta, int? FcMedia, int? FcMax, string? Nota, DateTime UpdatedAt, DateTime? DeletedAt);

public record TreinoPlanoDto(
    string Programa, int Semana, int SemanasTotal, int SessoesFeitas, int SessoesTotal, string? ProximaSessao, DateTime UpdatedAt);
