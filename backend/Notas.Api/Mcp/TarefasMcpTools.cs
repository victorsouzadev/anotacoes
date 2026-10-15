using System.ComponentModel;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;
using Notas.Api.Data;
using Notas.Api.Services.Financas;

namespace Notas.Api.Mcp;

/// <summary>MCP da ferramenta Tarefas (/api/mcp/tarefas). Só leitura.</summary>
[McpServerToolType]
public sealed class TarefasMcpTools(AppDbContext db, McpUser user, FinancasClock clock)
{
    private static readonly CultureInfo Br = CultureInfo.GetCultureInfo("pt-BR");

    [McpServerTool(Name = "tarefas_resumo", ReadOnly = true, OpenWorld = false)]
    [Description("Resumo das tarefas em Markdown: atrasadas, para hoje, próximos 7 dias, sem prazo (as mais importantes), " +
                 "concluídas desde uma data e andamento por projeto. É o que o Segundo Cérebro guarda na rotina de sincronização.")]
    public async Task<string> Resumo(
        [Description("Opcional: considerar concluídas desde esta data/hora (ISO 8601). Padrão: últimas 24 h.")] string? desde = null,
        CancellationToken ct = default)
    {
        var uid = user.Id;
        var agora = DateTime.UtcNow;
        var inicio = DateTime.TryParse(desde, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var d) ? d : agora.AddDays(-1);
        // "Hoje" no fuso do hub (o mesmo das Finanças), não em UTC: às 21h em Brasília já é amanhã em UTC.
        var hoje = clock.Hoje().ToDateTime(TimeOnly.MinValue);

        var tarefas = await db.TaskItems.AsNoTracking().Where(t => t.UserId == uid && t.DeletedAt == null).ToListAsync(ct);
        var categorias = await db.TaskCategories.AsNoTracking().Where(c => c.UserId == uid).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        var projetos = await db.TaskProjects.AsNoTracking().Where(p => p.UserId == uid).ToDictionaryAsync(p => p.Id, p => p.Name, ct);
        var vinculos = await db.TaskProjectMemberships.AsNoTracking().Where(m => m.UserId == uid).ToListAsync(ct);

        var pendentes = tarefas.Where(t => !t.IsCompleted).ToList();
        var atrasadas = pendentes.Where(t => t.DueDate is { } p && p.Date < hoje).OrderBy(t => t.DueDate).ToList();
        var paraHoje = pendentes.Where(t => t.DueDate is { } p && p.Date == hoje).ToList();
        var semana = pendentes.Where(t => t.DueDate is { } p && p.Date > hoje && p.Date <= hoje.AddDays(7)).OrderBy(t => t.DueDate).ToList();
        var semPrazo = pendentes.Where(t => t.DueDate is null).OrderByDescending(t => t.Priority).ThenBy(t => t.Position).Take(10).ToList();
        var concluidas = tarefas.Where(t => t.IsCompleted && t.CompletedAt >= inicio).OrderByDescending(t => t.CompletedAt).ToList();

        string Linha(TaskItem t)
        {
            var extras = new List<string>();
            if (t.DueDate is { } p) extras.Add(p.ToString("dd/MM", Br));
            if (t.Priority == TaskPriority.High) extras.Add("alta prioridade");
            var cats = Categorias(t, categorias);
            if (cats.Count > 0) extras.Add(string.Join(", ", cats));
            var projs = vinculos.Where(v => v.TaskId == t.Id && projetos.ContainsKey(v.ProjectId)).Select(v => projetos[v.ProjectId]).ToList();
            if (projs.Count > 0) extras.Add("projeto " + string.Join(", ", projs));
            return $"- {(t.IsCompleted ? "[x]" : "[ ]")} {t.Title}{(extras.Count > 0 ? $" ({string.Join(" · ", extras)})" : "")}";
        }

        var sb = new StringBuilder();
        sb.Append($"Pendentes: {pendentes.Count} · atrasadas: {atrasadas.Count} · hoje: {paraHoje.Count} · próximos 7 dias: {semana.Count} · ")
          .Append($"concluídas desde {Local(inicio):dd/MM HH:mm}: {concluidas.Count}\n");
        void Secao(string titulo, List<TaskItem> itens)
        {
            if (itens.Count == 0) return;
            sb.Append($"\n## {titulo}\n");
            foreach (var t in itens.Take(30)) sb.Append(Linha(t)).Append('\n');
            if (itens.Count > 30) sb.Append($"- … e mais {itens.Count - 30}\n");
        }
        Secao("Atrasadas", atrasadas);
        Secao("Para hoje", paraHoje);
        Secao("Próximos 7 dias", semana);
        Secao("Sem prazo (mais importantes)", semPrazo);
        Secao("Concluídas no período", concluidas);

        if (projetos.Count > 0)
        {
            sb.Append("\n## Projetos\n");
            foreach (var (pid, nome) in projetos)
            {
                var ids = vinculos.Where(v => v.ProjectId == pid).Select(v => v.TaskId).ToHashSet();
                var doProjeto = tarefas.Where(t => ids.Contains(t.Id)).ToList();
                if (doProjeto.Count == 0) continue;
                sb.Append($"- {nome}: {doProjeto.Count(t => t.IsCompleted)}/{doProjeto.Count} concluídas\n");
            }
        }
        return sb.ToString().TrimEnd();
    }

    [McpServerTool(Name = "tarefas_listar", ReadOnly = true, OpenWorld = false)]
    [Description("Lista tarefas com filtro: pendentes, atrasadas, hoje, semana (próximos 7 dias) ou concluidas. Opcional: texto no título.")]
    public async Task<string> Listar(
        [Description("pendentes (padrão), atrasadas, hoje, semana ou concluidas.")] string filtro = "pendentes",
        [Description("Opcional: trecho do título.")] string? texto = null,
        [Description("Máximo de itens (1 a 200). Padrão 50.")] int limite = 50,
        CancellationToken ct = default)
    {
        var uid = user.Id;
        var hoje = clock.Hoje().ToDateTime(TimeOnly.MinValue);
        var q = db.TaskItems.AsNoTracking().Where(t => t.UserId == uid && t.DeletedAt == null);
        q = filtro switch
        {
            "atrasadas" => q.Where(t => !t.IsCompleted && t.DueDate != null && t.DueDate < hoje),
            "hoje" => q.Where(t => !t.IsCompleted && t.DueDate != null && t.DueDate >= hoje && t.DueDate < hoje.AddDays(1)),
            "semana" => q.Where(t => !t.IsCompleted && t.DueDate != null && t.DueDate >= hoje && t.DueDate < hoje.AddDays(8)),
            "concluidas" => q.Where(t => t.IsCompleted),
            _ => q.Where(t => !t.IsCompleted),
        };
        var lista = await q.ToListAsync(ct);
        if (!string.IsNullOrWhiteSpace(texto))
            lista = lista.Where(t => t.Title.Contains(texto.Trim(), StringComparison.OrdinalIgnoreCase)).ToList();
        lista = (filtro == "concluidas" ? lista.OrderByDescending(t => t.CompletedAt) : lista.OrderBy(t => t.DueDate ?? DateTime.MaxValue))
            .Take(Math.Clamp(limite, 1, 200)).ToList();
        if (lista.Count == 0) return "Nenhuma tarefa.";
        return string.Join('\n', lista.Select(t =>
            $"- {(t.IsCompleted ? "[x]" : "[ ]")} {t.Title}" +
            (t.DueDate is { } p ? $" · prazo {p.ToString("dd/MM/yyyy", Br)}" : "") +
            (t.CompletedAt is { } c ? $" · concluída {Local(c).ToString("dd/MM HH:mm", Br)}" : "") +
            $" · prioridade {t.Priority}"));
    }

    private DateTime Local(DateTime utc) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), TimeZoneInfo.FindSystemTimeZoneById(clock.FusoId));

    private static List<string> Categorias(TaskItem t, Dictionary<string, string> nomes)
    {
        try
        {
            return (JsonSerializer.Deserialize<List<string>>(t.CategoryIds) ?? [])
                .Where(nomes.ContainsKey).Select(id => nomes[id]).ToList();
        }
        catch (JsonException) { return []; }
    }
}
