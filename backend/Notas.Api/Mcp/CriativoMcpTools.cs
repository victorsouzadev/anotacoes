using System.ComponentModel;
using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Server;
using Notas.Api.Data;
using Notas.Api.Services.Sites;

namespace Notas.Api.Mcp;

/// <summary>
/// MCP das ferramentas criativas (/api/mcp/criativo): Publicar (sites e versões) e Editor de Imagens
/// (projetos e biblioteca). Só leitura. Os Moldes são gerados na hora e não ficam guardados.
/// </summary>
[McpServerToolType]
public sealed class CriativoMcpTools(AppDbContext db, IOptions<SitesOptions> sites, McpUser user)
{
    private static readonly CultureInfo Br = CultureInfo.GetCultureInfo("pt-BR");

    [McpServerTool(Name = "criativo_resumo", ReadOnly = true, OpenWorld = false)]
    [Description("Resumo em Markdown para o Segundo Cérebro: sites publicados (endereço, versão no ar, último deploy) e " +
                 "projetos do Editor de Imagens alterados desde uma data.")]
    public async Task<string> Resumo(
        [Description("Opcional: considerar mudanças desde esta data/hora (ISO 8601). Padrão: últimos 7 dias.")] string? desde = null,
        CancellationToken ct = default)
    {
        var inicio = DateTime.TryParse(desde, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var d)
            ? d : DateTime.UtcNow.AddDays(-7);
        var sb = new StringBuilder();

        sb.Append("## Sites publicados\n").Append(await SitesMarkdown(ct)).Append('\n');

        var uid = user.Id;
        var projetos = await db.ImageProjects.AsNoTracking()
            .Where(p => p.UserId == uid && p.DeletedAt == null)
            .OrderByDescending(p => p.UpdatedAt)
            .Select(p => new { p.Name, p.UpdatedAt, p.CreatedAt })
            .ToListAsync(ct);
        var recentes = projetos.Where(p => p.UpdatedAt >= inicio).ToList();
        sb.Append($"\n## Editor de Imagens\n{projetos.Count} projetos guardados; {recentes.Count} alterados desde {inicio.ToLocalTime():dd/MM HH:mm}.\n");
        foreach (var p in recentes.Take(20))
            sb.Append($"- {p.Name} ({(p.CreatedAt >= inicio ? "novo" : "alterado")} em {p.UpdatedAt.ToLocalTime().ToString("dd/MM HH:mm", Br)})\n");
        var biblioteca = await db.ImageLibrary.CountAsync(i => i.UserId == uid, ct);
        sb.Append($"Biblioteca: {biblioteca} artes guardadas.\n");
        return sb.ToString().TrimEnd();
    }

    [McpServerTool(Name = "criativo_sites", ReadOnly = true, OpenWorld = false)]
    [Description("Sites publicados pela ferramenta Publicar: endereço, se está no ar, versão atual e últimos deploys.")]
    public Task<string> Sites(CancellationToken ct = default) => SitesMarkdown(ct);

    [McpServerTool(Name = "criativo_projetos_imagem", ReadOnly = true, OpenWorld = false)]
    [Description("Projetos do Editor de Imagens, mais recentes primeiro.")]
    public async Task<string> Projetos([Description("Máximo (1 a 100). Padrão 30.")] int limite = 30, CancellationToken ct = default)
    {
        var uid = user.Id;
        var lista = await db.ImageProjects.AsNoTracking()
            .Where(p => p.UserId == uid && p.DeletedAt == null)
            .OrderByDescending(p => p.UpdatedAt).Take(Math.Clamp(limite, 1, 100))
            .Select(p => new { p.Name, p.UpdatedAt }).ToListAsync(ct);
        return lista.Count == 0 ? "Nenhum projeto." :
            string.Join('\n', lista.Select(p => $"- {p.Name} · alterado em {p.UpdatedAt.ToLocalTime().ToString("dd/MM/yyyy HH:mm", Br)}"));
    }

    private async Task<string> SitesMarkdown(CancellationToken ct)
    {
        var uid = user.Id;
        var lista = await db.Sites.AsNoTracking().Where(s => s.OwnerUserId == uid).OrderBy(s => s.Nome).ToListAsync(ct);
        if (lista.Count == 0) return "Nenhum site publicado.";
        var ids = lista.Select(s => s.Id).ToList();
        var deploys = await db.Deployments.AsNoTracking().Where(x => ids.Contains(x.SiteId)).ToListAsync(ct);
        var sb = new StringBuilder();
        foreach (var s in lista)
        {
            var doSite = deploys.Where(x => x.SiteId == s.Id).OrderByDescending(x => x.CriadoEm).ToList();
            var atual = doSite.FirstOrDefault(x => x.Id == s.CurrentDeploymentId);
            var ultimo = doSite.FirstOrDefault();
            sb.Append($"- **{s.Nome}** ({sites.Value.Url(s.Slug)})")
              .Append(s.Parado ? " · parado" : atual is null ? " · sem versão no ar" : $" · no ar a versão {atual.Versao} ({atual.Tipo})");
            if (ultimo is not null && ultimo != atual)
                sb.Append($" · último deploy: versão {ultimo.Versao} {ultimo.Status} em {ultimo.CriadoEm.ToLocalTime().ToString("dd/MM HH:mm", Br)}");
            sb.Append('\n');
        }
        return sb.ToString().TrimEnd();
    }
}
