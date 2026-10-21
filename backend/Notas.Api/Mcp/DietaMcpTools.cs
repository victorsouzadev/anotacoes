using System.ComponentModel;
using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;
using Notas.Api.Data;
using Notas.Api.Endpoints;
using Notas.Api.Services.Dieta;

namespace Notas.Api.Mcp;

/// <summary>
/// MCP da ferramenta Dieta (/api/mcp/dieta). Consultas e, diferente dos outros apps, três registros
/// rápidos (refeição, peso e água) para lançar pelo Claude ("almocei 150 g de frango").
/// </summary>
[McpServerToolType]
public sealed class DietaMcpTools(AppDbContext db, McpUser user, DietaProgresso prog)
{
    private static readonly CultureInfo Br = Notas.Api.Services.CulturaBr.Cultura;

    [McpServerTool(Name = "dieta_resumo", ReadOnly = true, OpenWorld = false)]
    [Description("Resumo da dieta em Markdown: hoje e ontem (calorias, macros e água contra a meta), média dos últimos 7 dias, " +
                 "peso, nível/XP, sequências, desafio da semana e conquistas recentes. É o que o Segundo Cérebro guarda na rotina de sincronização.")]
    public async Task<string> Resumo(CancellationToken ct = default)
    {
        var uid = user.Id;
        var (_, peso, metas) = await prog.Metas(uid, ct);
        var hoje = prog.Hoje();
        var p = await prog.Calcular(uid, ct);
        var semana = (await prog.Dias(uid, hoje.AddDays(-6), hoje, metas, ct)).Where(d => d.Registros > 0).ToList();

        var sb = new StringBuilder();
        sb.Append($"Meta: {metas.Kcal} kcal · proteína {metas.ProteinaG} g · carbo {metas.CarboG} g · gordura {metas.GorduraG} g · água {metas.AguaMl} ml\n");
        foreach (var (rotulo, dia) in new[] { ("Hoje", hoje), ("Ontem", hoje.AddDays(-1)) })
        {
            var d = p.Dias.FirstOrDefault(x => x.Data == dia);
            sb.Append($"\n## {rotulo} ({dia.ToString("dd/MM", Br)})\n");
            sb.Append(d is null || d.Registros == 0 ? "- Nada registrado.\n" : Linha(d, metas) + "\n");
        }
        if (semana.Count > 0)
            sb.Append($"\n## Últimos 7 dias\n- {semana.Count} dias registrados · média {semana.Average(d => d.Kcal):0} kcal, " +
                      $"{semana.Average(d => d.Proteina):0} g proteína · {semana.Count(d => d.KcalNaMeta)} dias na meta de calorias\n");
        if (peso is { } kg)
        {
            var ultimo = p.Peso.LastOrDefault();
            sb.Append($"\n## Peso\n- Atual {kg.ToString("0.0", Br)} kg" + (ultimo is null ? "" : $" · média 7 dias {ultimo.Media7.ToString("0.0", Br)} kg") +
                      (p.Peso.Count > 1 ? $" · variação desde {p.Peso[0].Data.ToString("dd/MM", Br)}: {(kg - p.Peso[0].Kg).ToString("+0.0;-0.0", Br)} kg" : "") + "\n");
        }
        sb.Append($"\n## Gamificação\n- Nível {p.Nivel} ({p.XpTotal} XP, faltam {p.XpParaProximo - p.XpNoNivel} para o próximo)\n" +
                  $"- Sequência: {p.SequenciaRegistro} dias registrando, {p.SequenciaMeta} na meta (melhor: {p.MelhorSequencia})\n" +
                  $"- Desafio da semana: {p.Desafio.Descricao} — {p.Desafio.Feito}/{p.Desafio.Alvo}\n");
        var recentes = p.Conquistas.Where(c => c.Em >= hoje.AddDays(-7)).ToList();
        if (recentes.Count > 0) sb.Append("- Conquistas da semana: " + string.Join(", ", recentes.Select(c => c.Nome)) + "\n");
        return sb.ToString().TrimEnd();
    }

    [McpServerTool(Name = "dieta_dia", ReadOnly = true, OpenWorld = false)]
    [Description("O que foi comido num dia, por refeição, com totais contra a meta.")]
    public async Task<string> Dia([Description("Data yyyy-MM-dd. Padrão: hoje.")] string? data = null, CancellationToken ct = default)
    {
        var uid = user.Id;
        var dia = DataOuHoje(data);
        var (_, _, metas) = await prog.Metas(uid, ct);
        var tot = (await prog.Dias(uid, dia, dia, metas, ct))[0];
        var regs = await db.DietaRegistros.AsNoTracking().Where(r => r.UserId == uid && r.Data == dia && r.DeletedAt == null)
            .OrderBy(r => r.CreatedAt).ToListAsync(ct);
        if (regs.Count == 0) return $"Nada registrado em {dia.ToString("dd/MM/yyyy", Br)}.";
        var sb = new StringBuilder($"{dia.ToString("dddd, dd/MM/yyyy", Br)}\n{Linha(tot, metas)}\n");
        foreach (var g in regs.GroupBy(r => r.Refeicao).OrderBy(g => Array.IndexOf(DietaEndpoints.Refeicoes, g.Key)))
        {
            sb.Append($"\n## {g.Key}\n");
            foreach (var r in g) sb.Append($"- {r.Nome} — {r.QuantidadeG:0} g · {r.Kcal:0} kcal · P {r.Proteina:0.#} · C {r.Carbo:0.#} · G {r.Gordura:0.#}\n");
        }
        return sb.ToString().TrimEnd();
    }

    [McpServerTool(Name = "dieta_periodo", ReadOnly = true, OpenWorld = false)]
    [Description("Totais por dia num período (até 92 dias): calorias, macros, água e se bateu as metas.")]
    public async Task<string> Periodo(
        [Description("Início yyyy-MM-dd.")] string inicio,
        [Description("Fim yyyy-MM-dd. Padrão: hoje.")] string? fim = null,
        CancellationToken ct = default)
    {
        var a = DataOuHoje(inicio);
        var b = DataOuHoje(fim);
        if (b < a) (a, b) = (b, a);
        if (b.DayNumber - a.DayNumber > 92) a = b.AddDays(-92);
        var (_, _, metas) = await prog.Metas(user.Id, ct);
        var dias = (await prog.Dias(user.Id, a, b, metas, ct)).Where(d => d.Registros > 0).ToList();
        if (dias.Count == 0) return "Nada registrado no período.";
        return string.Join('\n', dias.Select(d => $"- {d.Data.ToString("dd/MM", Br)}: " + Linha(d, metas)[2..])) +
               $"\n\nMédia: {dias.Average(d => d.Kcal):0} kcal · {dias.Average(d => d.Proteina):0} g proteína · {dias.Count(d => d.KcalNaMeta)}/{dias.Count} dias na meta";
    }

    [McpServerTool(Name = "dieta_buscar_alimento", ReadOnly = true, OpenWorld = false)]
    [Description("Procura alimentos na TACO e nos cadastrados pelo usuário. Devolve id e valores por 100 g, para usar em dieta_registrar_refeicao.")]
    public async Task<string> BuscarAlimento([Description("Texto, ex.: \"frango grelhado\".")] string texto, CancellationToken ct = default)
    {
        var termos = DietaEndpoints.SemAcento(texto).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var todos = await db.DietaAlimentos.AsNoTracking().Where(a => (a.UserId == null || a.UserId == user.Id) && a.DeletedAt == null).ToListAsync(ct);
        var achados = todos.Where(a => termos.All(t => DietaEndpoints.SemAcento(a.Nome).Contains(t))).OrderBy(a => a.Nome.Length).Take(15).ToList();
        if (achados.Count == 0) return "Nenhum alimento encontrado.";
        return string.Join('\n', achados.Select(a => $"- {a.Nome} (id {a.Id}) — por 100 g: {a.Kcal:0} kcal · P {a.Proteina:0.#} · C {a.Carbo:0.#} · G {a.Gordura:0.#}" +
                                                       (a.PorcaoNome is null ? "" : $" · {a.PorcaoNome} = {a.PorcaoG:0} g")));
    }

    [McpServerTool(Name = "dieta_registrar_refeicao", ReadOnly = false, Destructive = false, OpenWorld = false)]
    [Description("Registra um alimento comido. Use o id de dieta_buscar_alimento; os valores são calculados pela quantidade.")]
    public async Task<string> RegistrarRefeicao(
        [Description("Id do alimento (de dieta_buscar_alimento).")] string alimentoId,
        [Description("Quantidade em gramas.")] double gramas,
        [Description("cafe, almoco, lanche, jantar ou ceia.")] string refeicao,
        [Description("Data yyyy-MM-dd. Padrão: hoje.")] string? data = null,
        CancellationToken ct = default)
    {
        if (!DietaEndpoints.Refeicoes.Contains(refeicao)) return "Refeição inválida: use cafe, almoco, lanche, jantar ou ceia.";
        if (gramas is <= 0 or > 5000) return "Quantidade inválida.";
        var a = await db.DietaAlimentos.AsNoTracking().FirstOrDefaultAsync(x => x.Id == alimentoId && (x.UserId == null || x.UserId == user.Id) && x.DeletedAt == null, ct);
        if (a is null) return "Alimento não encontrado.";
        var agora = DateTime.UtcNow;
        var r = new DietaRegistro { Id = Guid.NewGuid().ToString(), UserId = user.Id, Data = DataOuHoje(data), Refeicao = refeicao, AlimentoId = a.Id, QuantidadeG = gramas, CreatedAt = agora, UpdatedAt = agora };
        DietaEndpoints.Aplicar(r, a, gramas);
        db.DietaRegistros.Add(r);
        await db.SaveChangesAsync(ct);
        return $"Registrado: {r.Nome}, {gramas:0} g ({r.Kcal:0} kcal) no {refeicao} de {r.Data.ToString("dd/MM", Br)}.";
    }

    [McpServerTool(Name = "dieta_registrar_peso", ReadOnly = false, Destructive = false, OpenWorld = false)]
    [Description("Registra o peso do dia, em kg.")]
    public async Task<string> RegistrarPeso([Description("Peso em kg.")] double kg, [Description("Data yyyy-MM-dd. Padrão: hoje.")] string? data = null, CancellationToken ct = default)
    {
        if (kg is < 20 or > 400) return "Peso inválido.";
        db.DietaPesos.Add(new DietaPeso { Id = Guid.NewGuid().ToString(), UserId = user.Id, Data = DataOuHoje(data), Kg = Math.Round(kg, 2), UpdatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync(ct);
        return $"Peso registrado: {kg.ToString("0.0", Br)} kg.";
    }

    [McpServerTool(Name = "dieta_registrar_agua", ReadOnly = false, Destructive = false, OpenWorld = false)]
    [Description("Registra água bebida, em ml.")]
    public async Task<string> RegistrarAgua([Description("Quantidade em ml.")] int ml, [Description("Data yyyy-MM-dd. Padrão: hoje.")] string? data = null, CancellationToken ct = default)
    {
        if (ml is <= 0 or > 5000) return "Quantidade inválida.";
        var dia = DataOuHoje(data);
        db.DietaAguas.Add(new DietaAgua { Id = Guid.NewGuid().ToString(), UserId = user.Id, Data = dia, Ml = ml, UpdatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync(ct);
        var total = await db.DietaAguas.Where(x => x.UserId == user.Id && x.Data == dia && x.DeletedAt == null).SumAsync(x => x.Ml, ct);
        return $"Água registrada: {ml} ml (total do dia: {total} ml).";
    }

    private DateOnly DataOuHoje(string? s) =>
        DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : prog.Hoje();

    private static string Linha(DiaDieta d, MetasDieta m) =>
        $"- {d.Kcal:0}/{m.Kcal} kcal{(d.KcalNaMeta ? " ✓" : "")} · proteína {d.Proteina:0}/{m.ProteinaG} g{(d.ProteinaNaMeta ? " ✓" : "")} · " +
        $"carbo {d.Carbo:0} g · gordura {d.Gordura:0} g · fibra {d.Fibra:0} g · água {d.AguaMl}/{m.AguaMl} ml{(d.AguaNaMeta ? " ✓" : "")}";
}
