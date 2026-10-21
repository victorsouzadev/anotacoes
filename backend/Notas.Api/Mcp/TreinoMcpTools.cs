using System.ComponentModel;
using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;
using Notas.Api.Data;
using Notas.Api.Services.Financas;

namespace Notas.Api.Mcp;

/// <summary>MCP da ferramenta Treino (/api/mcp/treino), alimentada pelo app Treino Corrida. Só leitura.</summary>
[McpServerToolType]
public sealed class TreinoMcpTools(AppDbContext db, McpUser user, FinancasClock clock)
{
    private static readonly CultureInfo Br = Notas.Api.Services.CulturaBr.Cultura;
    // Números e dias da semana fixos: o mesmo texto com ou sem ICU (modo globalization-invariant).
    private static readonly NumberFormatInfo Num = new() { NumberDecimalSeparator = ",", NumberGroupSeparator = "." };
    private static readonly string[] DiasSemana = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

    [McpServerTool(Name = "treino_resumo", ReadOnly = true, OpenWorld = false)]
    [Description("Resumo dos treinos de corrida em Markdown: andamento do programa, atividades desde uma data, " +
                 "totais dos últimos 7 e 30 dias e recordes. É o que o Segundo Cérebro guarda na rotina de sincronização.")]
    public async Task<string> Resumo(
        [Description("Opcional: listar as atividades desde esta data/hora (ISO 8601). Padrão: últimos 7 dias.")] string? desde = null,
        CancellationToken ct = default)
    {
        var uid = user.Id;
        var agora = DateTime.UtcNow;
        var inicio = DateTime.TryParse(desde, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var d) ? d : agora.AddDays(-7);
        var todas = await db.TreinoAtividades.AsNoTracking().Where(a => a.UserId == uid && a.DeletedAt == null).OrderBy(a => a.Inicio).ToListAsync(ct);
        var plano = await db.TreinoPlanos.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == uid, ct);

        var sb = new StringBuilder();
        if (plano is not null)
            sb.Append($"Programa: {plano.Programa} · semana {plano.Semana}/{plano.SemanasTotal} · {plano.SessoesFeitas}/{plano.SessoesTotal} sessões feitas")
              .Append(plano.ProximaSessao is { } prox ? $" · próxima: {prox}" : "").Append('\n');
        if (todas.Count == 0) return sb.Append("Nenhum treino registrado.").ToString();

        var ultima = todas[^1];
        sb.Append($"Último treino: {Local(ultima.Inicio).ToString("dd/MM", Br)} ({DiasAtras(ultima.Inicio)})\n");

        var recentes = todas.Where(a => a.Inicio >= inicio).OrderByDescending(a => a.Inicio).ToList();
        sb.Append($"\n## Desde {Local(inicio).ToString("dd/MM HH:mm", Br)}\n");
        sb.Append(recentes.Count == 0 ? "- Nenhum treino.\n" : string.Join('\n', recentes.Select(Linha)) + "\n");

        foreach (var dias in new[] { 7, 30 })
        {
            var p = todas.Where(a => a.Inicio >= agora.AddDays(-dias)).ToList();
            sb.Append(dias == 7 ? "\n## Totais\n" : "");
            sb.Append($"- {dias} dias: {p.Count} treinos · {Km(p.Sum(a => a.DistanciaM))} · {Duracao(p.Sum(a => a.DuracaoSeg))}");
            var esf = p.Where(a => a.Esforco is not null).ToList();
            if (esf.Count > 0) sb.Append($" · esforço médio {esf.Average(a => a.Esforco!.Value).ToString("0.#", Num)}/10");
            if (p.Any(a => a.Dor)) sb.Append($" · dor relatada em {p.Count(a => a.Dor)}");
            sb.Append('\n');
        }

        var recordes = new List<string>();
        if (todas.MaxBy(a => a.DistanciaM) is { DistanciaM: > 0 } longa) recordes.Add($"maior distância {Km(longa.DistanciaM)} ({Local(longa.Inicio).ToString("dd/MM", Br)})");
        if (todas.MaxBy(a => a.DuracaoSeg) is { DuracaoSeg: > 0 } dur) recordes.Add($"mais tempo {Duracao(dur.DuracaoSeg)}");
        if (todas.Where(a => a.DistanciaM >= 1000).MinBy(a => a.DuracaoSeg / a.DistanciaM) is { } rapida) recordes.Add($"melhor ritmo {Ritmo(rapida)} em {Km(rapida.DistanciaM)}");
        if (todas.Max(a => a.MaiorCorridaSeg) is > 0 and var corrida) recordes.Add($"maior corrida contínua {Duracao(corrida)}");
        if (recordes.Count > 0) sb.Append("\n## Recordes\n- " + string.Join("\n- ", recordes) + "\n");
        return sb.ToString().TrimEnd();
    }

    [McpServerTool(Name = "treino_atividades", ReadOnly = true, OpenWorld = false)]
    [Description("Lista os treinos num período (até 366 dias): data, tipo, distância, tempo, ritmo, esforço e frequência cardíaca.")]
    public async Task<string> Atividades(
        [Description("Início yyyy-MM-dd. Padrão: 30 dias atrás.")] string? inicio = null,
        [Description("Fim yyyy-MM-dd. Padrão: hoje.")] string? fim = null,
        CancellationToken ct = default)
    {
        var hoje = clock.Hoje();
        var a = Data(inicio) ?? hoje.AddDays(-30);
        var b = Data(fim) ?? hoje;
        if (b < a) (a, b) = (b, a);
        if (b.DayNumber - a.DayNumber > 366) a = b.AddDays(-366);
        var de = ParaUtc(a);
        var ate = ParaUtc(b.AddDays(1));
        var lista = await db.TreinoAtividades.AsNoTracking()
            .Where(x => x.UserId == user.Id && x.DeletedAt == null && x.Inicio >= de && x.Inicio < ate)
            .OrderBy(x => x.Inicio).ToListAsync(ct);
        return lista.Count == 0 ? "Nenhum treino no período." : string.Join('\n', lista.Select(Linha));
    }

    private string Linha(TreinoAtividade a)
    {
        var partes = new List<string> { $"{a.Titulo} ({(a.Tipo == "sessao" ? "plano" : "livre")})", Duracao(a.DuracaoSeg) };
        if (a.DistanciaM > 0) partes.Add(Km(a.DistanciaM));
        if (a.DistanciaM >= 100) partes.Add(Ritmo(a));
        if (a.MaiorCorridaSeg is > 0 and var mc) partes.Add($"maior corrida {Duracao(mc)}");
        if (a.Esforco is { } e) partes.Add($"esforço {e}/10");
        if (a.FcMedia is { } fc) partes.Add($"FC média {fc}" + (a.FcMax is { } mx ? $" (máx. {mx})" : "") + " bpm");
        if (a.Meta is { } m) partes.Add($"meta: {m}");
        if (a.Dor) partes.Add("relatou dor");
        var local = Local(a.Inicio);
        var linha = $"- {DiasSemana[(int)local.DayOfWeek]} {local.ToString("dd/MM HH:mm", Br)}: " + string.Join(" · ", partes);
        return a.Nota is { Length: > 0 } n ? $"{linha} — {n}" : linha;
    }

    private static string Km(double m) => (m / 1000).ToString("0.00", Num) + " km";

    private static string Duracao(int s) => s >= 3600 ? $"{s / 3600}h{s % 3600 / 60:00}" : $"{s / 60}:{s % 60:00}";

    private static string Ritmo(TreinoAtividade a)
    {
        var s = (int)Math.Round(a.DuracaoSeg / (a.DistanciaM / 1000));
        return $"{s / 60}:{s % 60:00}/km";
    }

    private string DiasAtras(DateTime utc)
    {
        var dias = clock.Hoje().DayNumber - DateOnly.FromDateTime(Local(utc)).DayNumber;
        return dias switch { 0 => "hoje", 1 => "ontem", _ => $"há {dias} dias" };
    }

    private static DateOnly? Data(string? s) =>
        DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    private TimeZoneInfo Fuso => TimeZoneInfo.FindSystemTimeZoneById(clock.FusoId);

    private DateTime ParaUtc(DateOnly d) => TimeZoneInfo.ConvertTimeToUtc(d.ToDateTime(TimeOnly.MinValue), Fuso);

    private DateTime Local(DateTime utc) => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), Fuso);
}
