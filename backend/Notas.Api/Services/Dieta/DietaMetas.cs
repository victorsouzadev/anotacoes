using Notas.Api.Data;

namespace Notas.Api.Services.Dieta;

public sealed record MetasDieta(int Kcal, int ProteinaG, int CarboG, int GorduraG, int AguaMl);

/// <summary>Metas sugeridas a partir do perfil e do peso mais recente.</summary>
public static class DietaMetas
{
    public static readonly MetasDieta Padrao = new(2000, 120, 230, 65, 2500);

    /// <summary>
    /// Mifflin-St Jeor × fator de atividade, ajustado pelo objetivo (−20% para perder, +10% para ganhar).
    /// Proteína por kg (2,0 g ao perder, 1,8 g senão), gordura 0,8 g/kg, carboidrato o que sobra, água 35 ml/kg.
    /// Sem peso ou altura, volta ao padrão de 2000 kcal.
    /// </summary>
    public static MetasDieta Sugerir(DietaPerfil? perfil, double? pesoKg, DateOnly hoje)
    {
        if (perfil is null || pesoKg is not > 0 || perfil.AlturaCm <= 0) return Padrao;
        var kg = pesoKg.Value;
        var idade = perfil.Nascimento is { } n ? Idade(n, hoje) : 30;
        var tmb = 10 * kg + 6.25 * perfil.AlturaCm - 5 * idade + (perfil.Sexo == "F" ? -161 : 5);
        var gasto = tmb * Math.Clamp(perfil.Atividade, 1.1, 2.0);
        var kcal = perfil.Objetivo switch
        {
            "perder" => Math.Max(gasto * 0.8, perfil.Sexo == "F" ? 1200 : 1500),
            "ganhar" => gasto * 1.1,
            _ => gasto,
        };
        var proteina = kg * (perfil.Objetivo == "perder" ? 2.0 : 1.8);
        var gordura = kg * 0.8;
        var carbo = Math.Max(0, (kcal - proteina * 4 - gordura * 9) / 4);
        return new MetasDieta(Arred(kcal, 10), R(proteina), R(carbo), R(gordura), Arred(kg * 35, 50));
    }

    /// <summary>Metas em vigor: as que o usuário fixou; cada uma que estiver zerada vem da sugestão.</summary>
    public static MetasDieta Vigentes(DietaPerfil? perfil, double? pesoKg, DateOnly hoje)
    {
        var s = Sugerir(perfil, pesoKg, hoje);
        if (perfil is null) return s;
        return new MetasDieta(
            perfil.MetaKcal > 0 ? perfil.MetaKcal : s.Kcal,
            perfil.MetaProteinaG > 0 ? perfil.MetaProteinaG : s.ProteinaG,
            perfil.MetaCarboG > 0 ? perfil.MetaCarboG : s.CarboG,
            perfil.MetaGorduraG > 0 ? perfil.MetaGorduraG : s.GorduraG,
            perfil.MetaAguaMl > 0 ? perfil.MetaAguaMl : s.AguaMl);
    }

    private static int Idade(DateOnly nascimento, DateOnly hoje)
    {
        var idade = hoje.Year - nascimento.Year;
        if (hoje < nascimento.AddYears(idade)) idade--;
        return Math.Clamp(idade, 10, 100);
    }

    // Meio para cima, como o roundToInt do app Android: as duas contas precisam dar o mesmo número.
    private static int R(double v) => (int)Math.Round(v, MidpointRounding.AwayFromZero);
    private static int Arred(double v, int passo) => R(v / passo) * passo;
}
