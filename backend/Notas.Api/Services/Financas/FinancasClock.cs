using Microsoft.Extensions.Options;

namespace Notas.Api.Services.Financas;

public class FinancasOptions
{
    public const string SectionName = "Financas";

    // Fuso usado para decidir que dia é "hoje" e quais são os limites do mês.
    // Sem isso o servidor usaria UTC e, para um usuário em UTC-3, tudo lançado
    // depois das 21h cairia no dia (e às vezes no mês) seguinte.
    public string FusoHorario { get; set; } = "America/Sao_Paulo";

    // Teto do texto livre aceito no POST de lançamento. Protege o custo da chamada
    // ao LLM e o tamanho das colunas.
    public int MaxTamanhoTexto { get; set; } = 500;

    // Limites da importação por arquivo. Cada byte enviado vira token cobrado, e
    // uma imagem de celular passa fácil dos 5 MB.
    public int MaxArquivosPorImportacao { get; set; } = 5;
    public int MaxTamanhoArquivoMb { get; set; } = 10;
    public int MaxTamanhoTotalMb { get; set; } = 25;

    // Teto de lançamentos criados de uma vez por um único documento, para um PDF
    // gigante (ou um modelo alucinando) não despejar centenas de linhas na conta.
    public int MaxLancamentosPorImportacao { get; set; } = 200;
}

// Relógio da ferramenta: resolve "hoje" e os limites de um mês no fuso do usuário,
// em vez de em UTC.
public class FinancasClock
{
    private readonly TimeZoneInfo _fuso;
    private readonly ILogger<FinancasClock>? _logger;

    public FinancasClock(IOptions<FinancasOptions> options, ILogger<FinancasClock>? logger = null)
    {
        _logger = logger;
        _fuso = ResolverFuso(options.Value.FusoHorario);
    }

    public string FusoId => _fuso.Id;

    public DateOnly Hoje() => DateOnly.FromDateTime(Agora());

    public DateTime Agora() => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, _fuso);

    // Normaliza um par ano/mês opcional para o mês corrente do usuário.
    public (int Ano, int Mes) ResolverMes(int? ano, int? mes)
    {
        var hoje = Hoje();
        var anoRef = ano ?? hoje.Year;
        var mesRef = mes ?? hoje.Month;
        return (anoRef, mesRef);
    }

    public static (DateOnly Inicio, DateOnly Fim) LimitesDoMes(int ano, int mes)
    {
        var inicio = new DateOnly(ano, mes, 1);
        return (inicio, inicio.AddMonths(1).AddDays(-1));
    }

    public static (int Ano, int Mes) MesAnterior(int ano, int mes) =>
        mes == 1 ? (ano - 1, 12) : (ano, mes - 1);

    // A imagem Alpine do runtime pode não ter tzdata instalado. Em vez de derrubar
    // a aplicação, cai para um offset fixo de -3h (horário de Brasília, que não tem
    // mais horário de verão desde 2019).
    private TimeZoneInfo ResolverFuso(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) return FusoPadraoBrasilia();

        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(id);
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            _logger?.LogWarning(ex,
                "Fuso '{Fuso}' não encontrado no sistema (tzdata ausente?). Usando offset fixo UTC-03:00.", id);
            return FusoPadraoBrasilia();
        }
    }

    private static TimeZoneInfo FusoPadraoBrasilia() => TimeZoneInfo.CreateCustomTimeZone(
        "UTC-03", TimeSpan.FromHours(-3), "Horário de Brasília (offset fixo)", "-03");
}
