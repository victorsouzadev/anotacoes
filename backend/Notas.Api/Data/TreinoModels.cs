namespace Notas.Api.Data;

// Ferramenta "Treino" (app Android Treino Corrida). O app é offline-first: os dados nascem no celular e
// sobem por PUT idempotente com "quem editou por último vence" (UpdatedAt). Ids gerados no cliente.

/// <summary>Uma corrida ou sessão do plano, já resumida pelo app (o percurso GPS não sobe).</summary>
public class TreinoAtividade
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public DateTime Inicio { get; set; }
    /// <summary>"sessao" (do plano) ou "livre".</summary>
    public string Tipo { get; set; } = "livre";
    public string Titulo { get; set; } = "";
    public int DuracaoSeg { get; set; }
    public double DistanciaM { get; set; }
    /// <summary>Tempo da maior corrida contínua, em segundos (sessões de corrida/caminhada).</summary>
    public int? MaiorCorridaSeg { get; set; }
    /// <summary>Esforço percebido, 1 a 10.</summary>
    public int? Esforco { get; set; }
    public bool Dor { get; set; }
    public string? Meta { get; set; }
    public int? FcMedia { get; set; }
    public int? FcMax { get; set; }
    public string? Nota { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}

/// <summary>Andamento do programa. Uma linha por usuário.</summary>
public class TreinoPlano
{
    public string UserId { get; set; } = "";
    public string Programa { get; set; } = "";
    public int Semana { get; set; }
    public int SemanasTotal { get; set; }
    public int SessoesFeitas { get; set; }
    public int SessoesTotal { get; set; }
    public string? ProximaSessao { get; set; }
    public DateTime UpdatedAt { get; set; }
}
