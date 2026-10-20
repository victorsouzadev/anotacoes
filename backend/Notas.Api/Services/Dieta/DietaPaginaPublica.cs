using System.Globalization;
using System.Net;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;

namespace Notas.Api.Services.Dieta;

/// <summary>
/// Página pública de progresso (/api/dieta/publico/{token}/). HTML pronto do servidor, sem JS, e cada
/// seção só aparece se o escopo dela foi liberado no link. Nada fora dos escopos sai da API.
/// </summary>
public static class DietaPaginaPublica
{
    private static readonly CultureInfo Br = CultureInfo.GetCultureInfo("pt-BR");
    private static readonly Dictionary<string, string> NomeRefeicao = new()
    {
        ["cafe"] = "Café da manhã", ["almoco"] = "Almoço", ["lanche"] = "Lanche", ["jantar"] = "Jantar", ["ceia"] = "Ceia",
    };

    public static async Task<string> Montar(DietaCompartilhamento c, AppDbContext db, DietaProgresso prog, CancellationToken ct)
    {
        var escopos = c.Escopos.Split(',').ToHashSet();
        var uid = c.UserId;
        var hoje = prog.Hoje();
        var (_, _, metas) = await prog.Metas(uid, ct);
        var sb = new StringBuilder();
        sb.Append("<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\">")
          .Append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"robots\" content=\"noindex\">")
          .Append($"<title>{E(c.Titulo)}</title><style>").Append(Css).Append("</style></head><body><main>")
          .Append($"<h1>{E(c.Titulo)}</h1><p class=\"sub\">Atualizado em {hoje.ToString("dd/MM/yyyy", Br)}</p>");

        if (escopos.Contains(DietaEscopos.Conquistas))
        {
            var p = await prog.Calcular(uid, ct);
            var pct = p.XpParaProximo == 0 ? 0 : 100 * p.XpNoNivel / p.XpParaProximo;
            sb.Append($"""
                <section class="card"><h2>Progresso</h2><div class="kpis">
                <div class="kpi"><b>Nível {p.Nivel}</b><span>{p.XpTotal} XP</span><div class="bar"><i style="width:{pct}%"></i></div></div>
                <div class="kpi"><b>{p.SequenciaRegistro} dias</b><span>sequência registrando</span></div>
                <div class="kpi"><b>{p.SequenciaMeta} dias</b><span>seguidos na meta</span></div>
                <div class="kpi"><b>{p.DiasRegistrados}</b><span>dias registrados</span></div>
                </div>
                <p style="margin:14px 0 6px"><b>Desafio da semana:</b> {E(p.Desafio.Descricao)} — {p.Desafio.Feito}/{p.Desafio.Alvo}</p>
                <div class="badges">
                """);
            foreach (var cq in p.Conquistas)
                sb.Append($"<span class=\"badge{(cq.Em is null ? " off" : "")}\" title=\"{E(cq.Descricao)}\">{(cq.Em is null ? "🔒" : "🏅")} {E(cq.Nome)}</span>");
            sb.Append("</div><h2 style=\"margin-top:16px\">Últimos 6 meses</h2><div class=\"heat\">");
            var inicioHeat = hoje.AddDays(-181 - (int)hoje.AddDays(-181).DayOfWeek);
            var porDia = p.Dias.ToDictionary(d => d.Data);
            for (var d = inicioHeat; d <= hoje; d = d.AddDays(1))
            {
                var nivel = porDia.TryGetValue(d, out var dd) ? dd.Nivel : 0;
                sb.Append($"<i class=\"l{nivel}\" title=\"{d:dd/MM}\"></i>");
            }
            sb.Append("</div></section>");
        }

        if (escopos.Contains(DietaEscopos.Peso))
        {
            var pesos = await db.DietaPesos.AsNoTracking().Where(x => x.UserId == uid && x.DeletedAt == null && x.Data > hoje.AddDays(-180))
                .OrderBy(x => x.Data).Select(x => new { x.Data, x.Kg }).ToListAsync(ct);
            sb.Append("<section class=\"card\"><h2>Peso</h2>");
            if (pesos.Count == 0) sb.Append("<p class=\"sub\">Sem pesagens ainda.</p>");
            else
            {
                var dif = pesos[^1].Kg - pesos[0].Kg;
                sb.Append($"""<div class="kpis"><div class="kpi"><b>{pesos[^1].Kg.ToString("0.0", Br)} kg</b><span>atual</span></div>""" +
                          $"""<div class="kpi"><b>{(dif > 0 ? "+" : "")}{dif.ToString("0.0", Br)} kg</b><span>desde {pesos[0].Data.ToString("dd/MM", Br)}</span></div></div>""");
                sb.Append(GraficoPeso(pesos.Select(x => (x.Data, x.Kg)).ToList()));
            }
            sb.Append("</section>");
        }

        if (escopos.Contains(DietaEscopos.Macros))
        {
            var dias = (await prog.Dias(uid, hoje.AddDays(-13), hoje, metas, ct)).Where(d => d.Registros > 0).Reverse().ToList();
            sb.Append($"""
                <section class="card"><h2>Calorias e macros — últimos 14 dias</h2>
                <p class="sub">Meta: {metas.Kcal} kcal · {metas.ProteinaG} g proteína · {metas.CarboG} g carbo · {metas.GorduraG} g gordura · {metas.AguaMl} ml água</p>
                <div class="tbl"><table><tr><th>Dia</th><th>kcal</th><th>Prot.</th><th>Carbo</th><th>Gord.</th><th>Água</th></tr>
                """);
            foreach (var d in dias)
                sb.Append($"<tr><td>{d.Data.ToString("ddd dd/MM", Br)}</td><td class=\"{(d.KcalNaMeta ? "ok" : "")}\">{d.Kcal:0}</td>" +
                          $"<td class=\"{(d.ProteinaNaMeta ? "ok" : "")}\">{d.Proteina:0}</td><td>{d.Carbo:0}</td><td>{d.Gordura:0}</td>" +
                          $"<td class=\"{(d.AguaNaMeta ? "ok" : "")}\">{d.AguaMl}</td></tr>");
            if (dias.Count > 0)
                sb.Append($"<tr><th>Média</th><th>{dias.Average(d => d.Kcal):0}</th><th>{dias.Average(d => d.Proteina):0}</th>" +
                          $"<th>{dias.Average(d => d.Carbo):0}</th><th>{dias.Average(d => d.Gordura):0}</th><th>{dias.Average(d => d.AguaMl):0}</th></tr>");
            sb.Append("</table></div></section>");
        }

        if (escopos.Contains(DietaEscopos.Diario))
        {
            var regs = await db.DietaRegistros.AsNoTracking()
                .Where(r => r.UserId == uid && r.DeletedAt == null && r.Data > hoje.AddDays(-14))
                .OrderByDescending(r => r.Data).ThenBy(r => r.CreatedAt).ToListAsync(ct);
            sb.Append("<section class=\"card\"><h2>Diário — últimos 14 dias</h2>");
            foreach (var dia in regs.GroupBy(r => r.Data))
            {
                sb.Append($"<div class=\"dia\"><h3>{dia.Key.ToString("dddd, dd/MM", Br)} — {dia.Sum(r => r.Kcal):0} kcal</h3><ul>");
                foreach (var refeicao in dia.GroupBy(r => r.Refeicao).OrderBy(x => Array.IndexOf(Endpoints.DietaEndpoints.Refeicoes, x.Key)))
                    sb.Append($"<li><b>{E(NomeRefeicao.GetValueOrDefault(refeicao.Key, refeicao.Key))}:</b> " +
                              string.Join(", ", refeicao.Select(r => $"{E(r.Nome)} ({r.QuantidadeG:0} g)")) + "</li>");
                sb.Append("</ul></div>");
            }
            if (regs.Count == 0) sb.Append("<p class=\"sub\">Nada registrado no período.</p>");
            sb.Append("</section>");
        }

        foreach (var (escopo, tipo, titulo) in new[] { (DietaEscopos.FotosRefeicao, "refeicao", "Refeições"), (DietaEscopos.FotosCorpo, "corpo", "Fotos de progresso") })
        {
            if (!escopos.Contains(escopo)) continue;
            var fotos = await db.DietaFotos.AsNoTracking().Where(f => f.UserId == uid && f.DeletedAt == null && f.Tipo == tipo)
                .OrderByDescending(f => f.Data).Take(24).Select(f => new { f.Id, f.Data, f.Rotulo }).ToListAsync(ct);
            sb.Append($"<section class=\"card\"><h2>{titulo}</h2>");
            if (fotos.Count == 0) sb.Append("<p class=\"sub\">Sem fotos ainda.</p>");
            else
            {
                sb.Append("<div class=\"fotos\">");
                foreach (var f in fotos)
                    sb.Append($"<figure><img loading=\"lazy\" src=\"fotos/{E(f.Id)}\" alt=\"\"><figcaption>{f.Data.ToString("dd/MM/yy", Br)}" +
                              $"{(f.Rotulo is null ? "" : " · " + E(NomeRefeicao.GetValueOrDefault(f.Rotulo, f.Rotulo)))}</figcaption></figure>");
                sb.Append("</div>");
            }
            sb.Append("</section>");
        }

        if (escopos.Contains(DietaEscopos.Exportar))
            sb.Append("<section class=\"card\"><h2>Dados</h2><p><a href=\"export.csv\">Baixar diário dos últimos 90 dias (CSV)</a></p></section>");

        sb.Append("</main></body></html>");
        return sb.ToString();
    }

    private static string GraficoPeso(List<(DateOnly Data, double Kg)> pontos)
    {
        const int w = 800, h = 260, pad = 40;
        var min = pontos.Min(p => p.Kg) - 0.5;
        var max = pontos.Max(p => p.Kg) + 0.5;
        var d0 = pontos[0].Data.DayNumber;
        var span = Math.Max(1, pontos[^1].Data.DayNumber - d0);
        string X(DateOnly d) => (80 + (w - 80 - pad) * (d.DayNumber - d0) / (double)span).ToString("0.0", CultureInfo.InvariantCulture);
        string Y(double kg) => (h - pad - (h - 2 * pad) * (kg - min) / (max - min)).ToString("0.0", CultureInfo.InvariantCulture);
        var linha = string.Join(' ', pontos.Select(p => $"{X(p.Data)},{Y(p.Kg)}"));
        var media = string.Join(' ', pontos.Select(p => $"{X(p.Data)},{Y(pontos.Where(q => q.Data <= p.Data && q.Data > p.Data.AddDays(-7)).Average(q => q.Kg))}"));
        return $"""
            <svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="Gráfico de peso">
            <text x="4" y="{Y(max - 0.5)}" dy="8">{(max - 0.5).ToString("0.0", Br)}</text><text x="4" y="{Y(min + 0.5)}">{(min + 0.5).ToString("0.0", Br)}</text>
            <polyline fill="none" stroke="var(--line)" stroke-width="2" points="{linha}"/>
            <polyline fill="none" stroke="var(--acc)" stroke-width="3" points="{media}"/>
            </svg><p class="sub" style="margin:4px 0 0">Linha verde: média móvel de 7 dias.</p>
            """;
    }

    private const string Css = """

            :root{--bg:#f7f7f5;--card:#fff;--fg:#1d1d1b;--mute:#6b6b66;--line:#e4e4df;--acc:#2f9e44;--acc2:#1971c2;
              --h0:#ebedf0;--h1:#c6e9c9;--h2:#8fd19a;--h3:#4fae5f;--h4:#2b7a3a}
            @media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1e1e1c;--fg:#ececea;--mute:#9a9a94;--line:#33332f;
              --acc:#51cf66;--acc2:#4dabf7;--h0:#2a2a27;--h1:#1f4b2a;--h2:#2b6e3b;--h3:#3d9a52;--h4:#5fd075}}
            *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
            main{max-width:860px;margin:0 auto;padding:24px 16px 48px}
            h1{font-size:26px;margin:0 0 4px}h2{font-size:17px;margin:0 0 12px}
            .sub{color:var(--mute);margin:0 0 20px}
            .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 16px}
            .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}
            .kpi b{display:block;font-size:22px}.kpi span{color:var(--mute);font-size:13px}
            .bar{height:8px;background:var(--line);border-radius:4px;overflow:hidden;margin-top:6px}
            .bar i{display:block;height:100%;background:var(--acc)}
            table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:right;padding:6px 4px;border-bottom:1px solid var(--line)}
            th:first-child,td:first-child{text-align:left}.ok{color:var(--acc)}
            .tbl{overflow-x:auto}
            .badges{display:flex;flex-wrap:wrap;gap:8px}.badge{border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:13px}
            .badge.off{opacity:.4}
            .heat{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,auto);grid-auto-columns:1fr;gap:2px}
            .heat i{aspect-ratio:1;border-radius:2px;background:var(--h0)}
            .l1{background:var(--h1)!important}.l2{background:var(--h2)!important}.l3{background:var(--h3)!important}.l4{background:var(--h4)!important}
            .fotos{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
            .fotos figure{margin:0}.fotos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;display:block}
            .fotos figcaption{font-size:12px;color:var(--mute)}
            .dia{margin:0 0 12px}.dia h3{font-size:14px;margin:0 0 4px}.dia ul{margin:0;padding-left:18px;font-size:14px}
            svg text{fill:var(--mute);font-size:24px}
            a{color:var(--acc2)}
            """;

    private static string E(string s) => WebUtility.HtmlEncode(s);
}
