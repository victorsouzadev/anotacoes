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
    private static readonly CultureInfo Br = Notas.Api.Services.CulturaBr.Cultura;
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
          .Append("<meta name=\"color-scheme\" content=\"light dark\">").Append($"<link rel=\"icon\" href=\"{Favicon}\">").Append(Fontes)
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
                <p style="margin:16px 0 8px"><b>Desafio da semana:</b> {E(p.Desafio.Descricao)} — <span class="mono">{p.Desafio.Feito}/{p.Desafio.Alvo}</span></p>
                <div class="badges">
                """);
            foreach (var cq in p.Conquistas)
                sb.Append($"<span class=\"badge{(cq.Em is null ? " off" : "")}\" title=\"{E(cq.Descricao)}\">{E(cq.Nome)}{(cq.Em is null ? " (bloqueada)" : "")}</span>");
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
            <polyline fill="none" stroke="var(--linha)" stroke-width="2" points="{linha}"/>
            <polyline fill="none" stroke="var(--grafite)" stroke-width="3" points="{media}"/>
            </svg><p class="sub" style="margin:4px 0 0">Linha escura: média móvel de 7 dias.</p>
            """;
    }

    // Identidade Grafite (skill aplicar-grafite): tokens dia em :root e noite pelo modo do sistema. Nanquim é o
    // acento único (o link); barras e heatmap são dado, em grafite; positivo marca meta batida (estado).
    private const string Css = """
            :root{--papel:#F4F5F2;--folha:#FFFFFF;--grafite:#1E2523;--grafite-suave:#5E6865;--linha:#DFE3DF;
              --nanquim:#2E5E5A;--nanquim-escuro:#224744;--positivo:#2F7D4F}
            @media (prefers-color-scheme:dark){:root{--papel:#121514;--folha:#1A1E1D;--grafite:#E6EAE7;--grafite-suave:#9AA4A0;
              --linha:#2A302E;--nanquim:#7FB5AE;--nanquim-escuro:#A3CDC7;--positivo:#6FCF97}}
            *{box-sizing:border-box}
            body{margin:0;background:var(--papel);color:var(--grafite);font:400 15px/23px Figtree,system-ui,sans-serif}
            main{max-width:860px;margin:0 auto;padding:24px 16px 48px}
            h1{font:500 36px/40px Newsreader,Georgia,serif;margin:0 0 4px}
            h2{font:600 17px/24px Figtree,system-ui,sans-serif;margin:0 0 12px}
            .sub,.kpi span,.fotos figcaption{color:var(--grafite-suave);font:500 13px/18px Figtree,system-ui,sans-serif}
            .sub{margin:0 0 16px}
            .mono,.kpi b,td,th{font-family:"IBM Plex Mono",ui-monospace,monospace;font-weight:500}
            .card{background:var(--folha);border:1px solid var(--linha);border-radius:10px;padding:16px;margin:0 0 16px}
            .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:12px}
            .kpi b{display:block;font-size:24px;line-height:32px}
            .bar{height:8px;background:var(--linha);border-radius:6px;overflow:hidden;margin-top:8px}
            .bar i{display:block;height:100%;background:var(--grafite)}
            table{width:100%;border-collapse:collapse;font-size:15px;line-height:22px}
            th,td{text-align:right;padding:8px 4px;border-bottom:1px solid var(--linha)}
            th:first-child,td:first-child{text-align:left}.ok{color:var(--positivo)}
            .tbl{overflow-x:auto}
            .badges{display:flex;flex-wrap:wrap;gap:8px}
            .badge{border:1px solid var(--linha);border-radius:6px;padding:4px 8px;font:500 13px/18px Figtree,system-ui,sans-serif}
            .badge.off{color:var(--grafite-suave)}
            .heat{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,auto);grid-auto-columns:1fr;gap:2px}
            .heat i{aspect-ratio:1;border-radius:2px;background:var(--linha)}
            .heat i.l1,.heat i.l2,.heat i.l3,.heat i.l4{background:var(--grafite)}
            .l1{opacity:.25}.l2{opacity:.5}.l3{opacity:.75}
            .fotos{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
            .fotos figure{margin:0}.fotos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;display:block}
            .dia{margin:0 0 12px}.dia h3{font:600 15px/23px Figtree,system-ui,sans-serif;margin:0 0 4px}.dia ul{margin:0;padding-left:20px}
            svg text{fill:var(--grafite-suave);font:500 24px "IBM Plex Mono",monospace}
            a{color:var(--nanquim)}a:hover{color:var(--nanquim-escuro)}
            """;

    // Símbolo do Grafite como favicon (32×32, quadrado nanquim, traço papel, ponto #D6AE62).
    private const string Favicon =
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%232E5E5A'/%3E" +
        "%3Cpath d='M9.5 24 21 9.5' stroke='%23F4F5F2' stroke-width='3' stroke-linecap='round'/%3E%3Ccircle cx='23.6' cy='23.2' r='1.9' fill='%23D6AE62'/%3E%3C/svg%3E";

    private const string Fontes =
        "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\"><link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>" +
        "<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600&family=IBM+Plex+Mono:wght@500&family=Newsreader:opsz,wght@6..72,500&display=swap\">";

    private static string E(string s) => WebUtility.HtmlEncode(s);
}
