using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;

namespace Notas.Api.Services.Sites;

/// <summary>
/// Sites do Publicar em Markdown, para o MCP "criativo". Desde a spec 034 o MCP mora no plug-in criativo, mas os sites
/// e o backup continuam no núcleo: o plug-in lê este texto em <c>/api/core/criativo/resumo</c> com o segredo de serviço.
/// </summary>
public static class ResumoDeSites
{
    private static readonly CultureInfo Br = CulturaBr.Cultura;

    public static async Task<string> Markdown(AppDbContext db, SitesOptions sites, string usuario, CancellationToken ct)
    {
        var lista = await db.Sites.AsNoTracking().Where(s => s.OwnerUserId == usuario).OrderBy(s => s.Nome).ToListAsync(ct);
        if (lista.Count == 0) return "Nenhum site publicado.";
        var ids = lista.Select(s => s.Id).ToList();
        var deploys = await db.Deployments.AsNoTracking().Where(x => ids.Contains(x.SiteId)).ToListAsync(ct);
        var sb = new StringBuilder();
        foreach (var s in lista)
        {
            var doSite = deploys.Where(x => x.SiteId == s.Id).OrderByDescending(x => x.CriadoEm).ToList();
            var atual = doSite.FirstOrDefault(x => x.Id == s.CurrentDeploymentId);
            var ultimo = doSite.FirstOrDefault();
            sb.Append($"- **{s.Nome}** ({sites.Url(s.Slug)})")
              .Append(s.Parado ? " · parado" : atual is null ? " · sem versão no ar" : $" · no ar a versão {atual.Versao} ({atual.Tipo})");
            if (ultimo is not null && ultimo != atual)
                sb.Append($" · último deploy: versão {ultimo.Versao} {ultimo.Status} em {ultimo.CriadoEm.ToLocalTime().ToString("dd/MM HH:mm", Br)}");
            sb.Append('\n');
        }
        return sb.ToString().TrimEnd();
    }
}
