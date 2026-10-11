namespace Notas.Api.Data;

// Preferências de planejamento do usuário: qual método de divisão da renda ele
// segue e os parâmetros das metodologias (reserva, pague-se primeiro). Uma linha
// por usuário; sem ela valem os padrões.
public class PreferenciasFinancas
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = "";

    /// <summary>"50-30-20", "auvp" ou "6-potes".</summary>
    public string Metodo { get; set; } = "50-30-20";

    /// <summary>Quantos meses de gasto essencial a reserva de emergência deve cobrir.</summary>
    public int MesesReserva { get; set; } = 6;

    /// <summary>Meta cujo saldo conta como reserva de emergência (opcional).</summary>
    public Guid? MetaReservaId { get; set; }

    /// <summary>"Pague-se primeiro": quanto da receita separar assim que ela entra.</summary>
    public decimal PercentualPagueSePrimeiro { get; set; } = 10;

    /// <summary>Patrimônio já investido, para a conta de independência financeira.</summary>
    public decimal PatrimonioInvestido { get; set; }

    /// <summary>Saldo em conta usado como ponto de partida do fluxo de caixa sem AUVP.</summary>
    public decimal? SaldoInicialFluxo { get; set; }

    public DateTime AtualizadoEm { get; set; } = DateTime.UtcNow;
}

// Dívida a quitar, para os planos bola de neve e avalanche.
public class Divida
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = "";
    public string Nome { get; set; } = "";
    public decimal Saldo { get; set; }
    /// <summary>Juros ao mês, em % (ex.: 12,5 para rotativo do cartão).</summary>
    public decimal JurosMensal { get; set; }
    public decimal ParcelaMinima { get; set; }
    public DateTime CriadoEm { get; set; } = DateTime.UtcNow;
}

// Gasto anual previsível (IPVA, IPTU, seguro, presentes): dividido por 12 e
// reservado todo mês, para não pesar no mês em que vence.
public class ProvisaoAnual
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = "";
    public string Nome { get; set; } = "";
    public decimal Valor { get; set; }
    /// <summary>Mês do vencimento (1–12).</summary>
    public int MesVencimento { get; set; }
    public decimal ValorReservado { get; set; }
    public DateTime CriadoEm { get; set; } = DateTime.UtcNow;
}

// Fechamento do mês no método Kakeibo: as respostas do usuário às quatro perguntas.
// Os números (quanto entrou, quanto saiu) são calculados na hora, não guardados.
public class FechamentoMes
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = "";
    public int Ano { get; set; }
    public int Mes { get; set; }
    public decimal? MetaPoupanca { get; set; }
    public string? Reflexao { get; set; }
    public string? Compromisso { get; set; }
    public DateTime AtualizadoEm { get; set; } = DateTime.UtcNow;
}
