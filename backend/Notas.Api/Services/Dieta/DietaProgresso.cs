using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Services.Financas;

namespace Notas.Api.Services.Dieta;

public sealed record DiaDieta(
    DateOnly Data, double Kcal, double Proteina, double Carbo, double Gordura, double Fibra, int AguaMl,
    int Registros, int FotosRefeicao, bool Peso, bool KcalNaMeta, bool ProteinaNaMeta, bool AguaNaMeta, int Xp)
{
    /// <summary>0 = nada, 1 = registrou, 2–4 = registrou e bateu 1, 2 ou 3 metas (kcal, proteína, água).</summary>
    public int Nivel => Registros == 0 ? 0 : 1 + (KcalNaMeta ? 1 : 0) + (ProteinaNaMeta ? 1 : 0) + (AguaNaMeta ? 1 : 0);
}

public sealed record Conquista(string Codigo, string Nome, string Descricao, DateOnly? Em);
public sealed record Desafio(string Codigo, string Descricao, int Alvo, int Feito, DateOnly Inicio, DateOnly Fim);
public sealed record PontoPeso(DateOnly Data, double Kg, double Media7);

public sealed record ProgressoDieta(
    int XpTotal, int Nivel, int XpNoNivel, int XpParaProximo,
    int SequenciaRegistro, int SequenciaMeta, int MelhorSequencia, int DiasRegistrados,
    List<Conquista> Conquistas, Desafio Desafio, List<DiaDieta> Dias, List<PontoPeso> Peso);

/// <summary>
/// Consolida os dias e calcula a gamificação. Tudo é derivado dos registros (nada de tabela de XP):
/// apagar um registro errado recalcula XP, sequências e conquistas sem deixar resto.
/// </summary>
public sealed class DietaProgresso(AppDbContext db, FinancasClock clock)
{
    // XP por dia.
    public const int XpPorRegistro = 10, MaxRegistrosComXp = 6, XpProteina = 20, XpAgua = 10, XpKcal = 30,
        XpPorFoto = 5, MaxFotosComXp = 3, XpPeso = 5;

    private static readonly (string Codigo, string Nome, string Descricao)[] Catalogo =
    [
        ("primeiro_registro", "Primeira garfada", "Registrou a primeira refeição."),
        ("sequencia_7", "Uma semana firme", "7 dias seguidos registrando."),
        ("sequencia_30", "Hábito formado", "30 dias seguidos registrando."),
        ("dias_30", "Primeiro mês", "30 dias com registro."),
        ("dias_100", "Centenário", "100 dias com registro."),
        ("meta_7", "Na mosca", "7 dias seguidos dentro da meta de calorias."),
        ("proteina_30", "Construtor", "30 dias batendo a meta de proteína."),
        ("agua_30", "Hidratado", "30 dias batendo a meta de água."),
        ("fotos_100", "Fotógrafo", "100 fotos de refeição."),
        ("menos_5kg", "-5 kg", "5 kg a menos que o primeiro peso registrado."),
        ("menos_10kg", "-10 kg", "10 kg a menos que o primeiro peso registrado."),
        ("nivel_10", "Nível 10", "Chegou ao nível 10."),
    ];

    public DateOnly Hoje() => clock.Hoje();

    public async Task<(DietaPerfil? Perfil, double? PesoAtual, MetasDieta Metas)> Metas(string userId, CancellationToken ct = default)
    {
        var perfil = await db.DietaPerfis.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == userId, ct);
        var peso = await db.DietaPesos.AsNoTracking().Where(p => p.UserId == userId && p.DeletedAt == null)
            .OrderByDescending(p => p.Data).Select(p => (double?)p.Kg).FirstOrDefaultAsync(ct);
        return (perfil, peso, DietaMetas.Vigentes(perfil, peso, clock.Hoje()));
    }

    /// <summary>Dias consolidados no intervalo (inclusive), um por data, mesmo sem registro.</summary>
    public async Task<List<DiaDieta>> Dias(string userId, DateOnly inicio, DateOnly fim, MetasDieta metas, CancellationToken ct = default)
    {
        var regs = await db.DietaRegistros.AsNoTracking()
            .Where(r => r.UserId == userId && r.DeletedAt == null && r.Data >= inicio && r.Data <= fim)
            .Select(r => new { r.Data, r.Kcal, r.Proteina, r.Carbo, r.Gordura, r.Fibra }).ToListAsync(ct);
        var agua = await db.DietaAguas.AsNoTracking()
            .Where(a => a.UserId == userId && a.DeletedAt == null && a.Data >= inicio && a.Data <= fim)
            .Select(a => new { a.Data, a.Ml }).ToListAsync(ct);
        var fotos = await db.DietaFotos.AsNoTracking()
            .Where(f => f.UserId == userId && f.DeletedAt == null && f.Tipo == "refeicao" && f.Data >= inicio && f.Data <= fim)
            .Select(f => f.Data).ToListAsync(ct);
        var pesos = (await db.DietaPesos.AsNoTracking()
            .Where(p => p.UserId == userId && p.DeletedAt == null && p.Data >= inicio && p.Data <= fim)
            .Select(p => p.Data).ToListAsync(ct)).ToHashSet();

        var porDia = regs.GroupBy(r => r.Data).ToDictionary(g => g.Key, g => g.ToList());
        var aguaDia = agua.GroupBy(a => a.Data).ToDictionary(g => g.Key, g => g.Sum(a => a.Ml));
        var fotosDia = fotos.GroupBy(f => f).ToDictionary(g => g.Key, g => g.Count());

        var dias = new List<DiaDieta>();
        for (var d = inicio; d <= fim; d = d.AddDays(1))
        {
            var rs = porDia.GetValueOrDefault(d) ?? [];
            var kcal = rs.Sum(r => r.Kcal);
            var prot = rs.Sum(r => r.Proteina);
            var ml = aguaDia.GetValueOrDefault(d);
            var nFotos = fotosDia.GetValueOrDefault(d);
            var temPeso = pesos.Contains(d);
            var kcalOk = rs.Count > 0 && Math.Abs(kcal - metas.Kcal) <= metas.Kcal * 0.1;
            var protOk = rs.Count > 0 && prot >= metas.ProteinaG;
            var aguaOk = ml >= metas.AguaMl;
            var xp = Math.Min(rs.Count, MaxRegistrosComXp) * XpPorRegistro
                + (protOk ? XpProteina : 0) + (aguaOk ? XpAgua : 0) + (kcalOk ? XpKcal : 0)
                + Math.Min(nFotos, MaxFotosComXp) * XpPorFoto + (temPeso ? XpPeso : 0);
            dias.Add(new DiaDieta(d, Math.Round(kcal), Math.Round(prot, 1), Math.Round(rs.Sum(r => r.Carbo), 1),
                Math.Round(rs.Sum(r => r.Gordura), 1), Math.Round(rs.Sum(r => r.Fibra), 1), ml, rs.Count, nFotos,
                temPeso, kcalOk, protOk, aguaOk, xp));
        }
        return dias;
    }

    public async Task<ProgressoDieta> Calcular(string userId, CancellationToken ct = default)
    {
        var (_, _, metas) = await Metas(userId, ct);
        var hoje = clock.Hoje();
        var primeiro = await db.DietaRegistros.AsNoTracking().Where(r => r.UserId == userId && r.DeletedAt == null)
            .OrderBy(r => r.Data).Select(r => (DateOnly?)r.Data).FirstOrDefaultAsync(ct);
        var inicio = primeiro is { } p && p < hoje ? p : hoje;
        // O heatmap mostra até um ano; a história inteira entra no XP e nas conquistas.
        var dias = await Dias(userId, inicio, hoje, metas, ct);

        var pesos = await db.DietaPesos.AsNoTracking().Where(x => x.UserId == userId && x.DeletedAt == null)
            .OrderBy(x => x.Data).Select(x => new { x.Data, x.Kg }).ToListAsync(ct);
        var pesoDia = pesos.GroupBy(x => x.Data).Select(g => (Data: g.Key, Kg: g.Last().Kg)).ToList();
        var seriePeso = pesoDia.Select(x => new PontoPeso(x.Data, x.Kg,
            Math.Round(pesoDia.Where(y => y.Data <= x.Data && y.Data > x.Data.AddDays(-7)).Average(y => y.Kg), 2))).ToList();

        // Caminha em ordem cronológica para saber o dia em que cada conquista foi desbloqueada.
        var desbloqueio = new Dictionary<string, DateOnly>();
        void Marcar(string codigo, bool cond, DateOnly d) { if (cond) desbloqueio.TryAdd(codigo, d); }
        int xpAcum = 0, seq = 0, seqMeta = 0, melhor = 0, registrados = 0, proteinas = 0, aguas = 0, fotos = 0;
        var congeladoNaSemana = new HashSet<int>();
        var primeiroPeso = pesoDia.Count > 0 ? pesoDia[0].Kg : (double?)null;
        foreach (var d in dias)
        {
            xpAcum += d.Xp;
            if (d.Registros > 0) { seq++; registrados++; }
            else if (d.Data != hoje) seq = CongelarOuZerar(seq, d.Data, congeladoNaSemana);
            seqMeta = d.KcalNaMeta ? seqMeta + 1 : d.Data == hoje ? seqMeta : 0;
            melhor = Math.Max(melhor, seq);
            if (d.ProteinaNaMeta) proteinas++;
            if (d.AguaNaMeta) aguas++;
            fotos += d.FotosRefeicao;
            Marcar("primeiro_registro", registrados >= 1, d.Data);
            Marcar("sequencia_7", seq >= 7, d.Data);
            Marcar("sequencia_30", seq >= 30, d.Data);
            Marcar("dias_30", registrados >= 30, d.Data);
            Marcar("dias_100", registrados >= 100, d.Data);
            Marcar("meta_7", seqMeta >= 7, d.Data);
            Marcar("proteina_30", proteinas >= 30, d.Data);
            Marcar("agua_30", aguas >= 30, d.Data);
            Marcar("fotos_100", fotos >= 100, d.Data);
            Marcar("nivel_10", Nivel(xpAcum).Nivel >= 10, d.Data);
        }
        foreach (var pp in pesoDia)
        {
            Marcar("menos_5kg", primeiroPeso - pp.Kg >= 5, pp.Data);
            Marcar("menos_10kg", primeiroPeso - pp.Kg >= 10, pp.Data);
        }

        var (nivel, noNivel, paraProximo) = Nivel(xpAcum);
        var conquistas = Catalogo.Select(c => new Conquista(c.Codigo, c.Nome, c.Descricao,
            desbloqueio.TryGetValue(c.Codigo, out var em) ? em : null)).ToList();

        return new ProgressoDieta(xpAcum, nivel, noNivel, paraProximo, seq, seqMeta, melhor, registrados,
            conquistas, DesafioDaSemana(dias, hoje), dias.Where(d => d.Data > hoje.AddDays(-365)).ToList(), seriePeso);
    }

    /// <summary>Um dia em branco por semana não quebra a sequência (o "congelamento").</summary>
    private static int CongelarOuZerar(int seq, DateOnly dia, HashSet<int> congeladoNaSemana)
    {
        if (seq == 0) return 0;
        var semana = System.Globalization.ISOWeek.GetYear(dia.ToDateTime(TimeOnly.MinValue)) * 100
            + System.Globalization.ISOWeek.GetWeekOfYear(dia.ToDateTime(TimeOnly.MinValue));
        return congeladoNaSemana.Add(semana) ? seq : 0;
    }

    /// <summary>Nível n exige 50·n·(n+1) de XP acumulado: 100, 300, 600, 1000…</summary>
    public static (int Nivel, int XpNoNivel, int XpParaProximo) Nivel(int xp)
    {
        var n = 0;
        while (50 * (n + 1) * (n + 2) <= xp) n++;
        var base_ = 50 * n * (n + 1);
        return (n + 1, xp - base_, 50 * (n + 1) * (n + 2) - base_);
    }

    /// <summary>
    /// O desafio da semana (segunda a domingo) mira o ponto mais fraco da semana anterior:
    /// 5 dias batendo a meta de proteína, de água, de calorias ou com 25 g de fibra.
    /// </summary>
    public static Desafio DesafioDaSemana(List<DiaDieta> dias, DateOnly hoje)
    {
        var inicio = hoje.AddDays(-(((int)hoje.DayOfWeek + 6) % 7));
        var fim = inicio.AddDays(6);
        var anterior = dias.Where(d => d.Data >= inicio.AddDays(-7) && d.Data < inicio).ToList();
        var opcoes = new (string Codigo, string Descricao, Func<DiaDieta, bool> Ok)[]
        {
            ("proteina", "Bater a meta de proteína em 5 dias", d => d.ProteinaNaMeta),
            ("agua", "Bater a meta de água em 5 dias", d => d.AguaNaMeta),
            ("kcal", "Ficar dentro da meta de calorias em 5 dias", d => d.KcalNaMeta),
            ("fibra", "Comer 25 g de fibra em 5 dias", d => d.Fibra >= 25),
        };
        // Desempate fixo pela ordem acima; semana anterior vazia cai em "registrar".
        var escolhido = anterior.Any(d => d.Registros > 0)
            ? opcoes.OrderBy(o => anterior.Count(o.Ok)).First()
            : ("registro", "Registrar refeições em 5 dias", d => d.Registros > 0);
        var feito = dias.Count(d => d.Data >= inicio && d.Data <= fim && escolhido.Item3(d));
        return new Desafio(escolhido.Item1, escolhido.Item2, 5, Math.Min(feito, 5), inicio, fim);
    }

    /// <summary>% das refeições do plano em que houve registro no dia. Null = sem plano para o dia.</summary>
    public async Task<int?> AdesaoAoPlano(string userId, DateOnly dia, CancellationToken ct = default)
    {
        var ds = (int)dia.DayOfWeek;
        var planejadas = await db.DietaPlano.AsNoTracking()
            .Where(p => p.UserId == userId && p.DeletedAt == null && (p.DiaSemana == -1 || p.DiaSemana == ds))
            .Select(p => p.Refeicao).Distinct().ToListAsync(ct);
        if (planejadas.Count == 0) return null;
        var feitas = await db.DietaRegistros.AsNoTracking()
            .Where(r => r.UserId == userId && r.DeletedAt == null && r.Data == dia && planejadas.Contains(r.Refeicao))
            .Select(r => r.Refeicao).Distinct().CountAsync(ct);
        return (int)Math.Round(100.0 * feitas / planejadas.Count);
    }
}
