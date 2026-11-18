using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;

namespace Notas.Api.Services.Lixeira;

/// <summary>
/// Esvazia a lixeira de notas (spec 018): o que está lá há mais de <see cref="Dias"/> dias vira
/// tombstone (DeletedAt, conteúdo zerado). UpdatedAt muda junto para a exclusão chegar aos
/// navegadores na próxima sincronização. Roda ao subir e a cada 24 h.
/// </summary>
public class NotesLixeiraWorker(IServiceScopeFactory scopes, ILogger<NotesLixeiraWorker> logger) : BackgroundService
{
    public const int Dias = 30;

    public static async Task<int> LimparAsync(AppDbContext db, DateTime agoraUtc, CancellationToken ct)
    {
        var limite = agoraUtc.AddDays(-Dias);
        var vencidas = await db.Notes
            .Where(n => n.DeletedAt == null && n.TrashedAt != null && n.TrashedAt < limite)
            .ToListAsync(ct);
        foreach (var n in vencidas)
        {
            n.DeletedAt = agoraUtc;
            n.UpdatedAt = agoraUtc;
            n.TrashedAt = null;
            n.Elements = "[]";
        }
        if (vencidas.Count > 0) await db.SaveChangesAsync(ct);
        return vencidas.Count;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var n = await LimparAsync(db, DateTime.UtcNow, stoppingToken);
                if (n > 0) logger.LogInformation("Lixeira de notas: {Quantidade} nota(s) excluída(s) de vez.", n);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception e)
            {
                logger.LogWarning(e, "Falha ao esvaziar a lixeira de notas.");
            }
            try { await Task.Delay(TimeSpan.FromHours(24), stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }
}
