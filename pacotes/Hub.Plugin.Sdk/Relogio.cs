namespace Hub.Plugin;

/// <summary>
/// Relógio do hub (spec 035): "hoje" e os limites do mês no fuso do usuário, não em UTC. Antes era o
/// <c>FinancasClock</c> do núcleo, que Dieta e Tarefas usavam só para isso. Fuso em <c>HUB_FUSO</c>
/// (padrão America/Sao_Paulo); sem tzdata no container, cai para UTC-3 fixo. Em teste, passe <c>agoraUtc</c>.
/// </summary>
public sealed class RelogioDoHub
{
    public const string FusoPadrao = "America/Sao_Paulo";
    private readonly TimeZoneInfo _fuso;
    private readonly Func<DateTime> _agoraUtc;

    public RelogioDoHub(string? fuso = null, Func<DateTime>? agoraUtc = null)
    {
        _fuso = Resolver(string.IsNullOrWhiteSpace(fuso) ? FusoPadrao : fuso);
        _agoraUtc = agoraUtc ?? (() => DateTime.UtcNow);
    }

    public static RelogioDoHub DoAmbiente() => new(Environment.GetEnvironmentVariable("HUB_FUSO"));

    public string FusoId => _fuso.Id;
    public DateTime Agora() => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(_agoraUtc(), DateTimeKind.Utc), _fuso);
    public DateOnly Hoje() => DateOnly.FromDateTime(Agora());

    /// <summary>Ano/mês opcionais; o que faltar vira o mês corrente do usuário.</summary>
    public (int Ano, int Mes) ResolverMes(int? ano, int? mes)
    {
        var hoje = Hoje();
        return (ano ?? hoje.Year, mes ?? hoje.Month);
    }

    public static (DateOnly Inicio, DateOnly Fim) LimitesDoMes(int ano, int mes)
    {
        var inicio = new DateOnly(ano, mes, 1);
        return (inicio, inicio.AddMonths(1).AddDays(-1));
    }

    public static (int Ano, int Mes) MesAnterior(int ano, int mes) => mes == 1 ? (ano - 1, 12) : (ano, mes - 1);

    private static TimeZoneInfo Resolver(string id)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
        catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return TimeZoneInfo.CreateCustomTimeZone("UTC-03", TimeSpan.FromHours(-3), "Horário de Brasília (offset fixo)", "-03");
        }
    }
}
