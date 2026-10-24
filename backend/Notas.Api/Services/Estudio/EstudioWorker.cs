using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Notas.Api.Data;

namespace Notas.Api.Services.Estudio;

/// <summary>
/// Anda com a fila do Estúdio em segundo plano: envia o que entrou, consulta o que está no
/// provedor e roda as montagens locais — estas uma por vez e fora do laço principal, para um
/// vídeo longo no ffmpeg não atrasar a consulta das outras gerações (nem lotar a memória da VPS).
/// </summary>
public sealed class EstudioWorker(IServiceScopeFactory scopes, IOptions<EstudioOptions> options, ILogger<EstudioWorker> log) : BackgroundService
{
    private readonly SemaphoreSlim _local = new(1, 1);
    private readonly ConcurrentDictionary<string, byte> _emAndamento = new();

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (options.Value.WorkerDesligado) return;
        await Retomar(ct);
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Rodada(ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                log.LogError(e, "Estúdio: erro na rodada da fila");
            }
            try { await Task.Delay(TimeSpan.FromSeconds(1.5), ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    /// <summary>Montagem local que estava rodando quando o processo caiu volta para a fila.</summary>
    private async Task Retomar(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var presos = await db.EstudioJobs.Where(j => j.Provedor == "local" && j.Status == "rodando").ToListAsync(ct);
        foreach (var j in presos) { j.Status = "fila"; j.Mensagem = "Retomando"; }
        if (presos.Count > 0) await db.SaveChangesAsync(ct);
    }

    private async Task Rodada(CancellationToken ct)
    {
        List<string> ids;
        using (var scope = scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var agora = DateTime.UtcNow;
            ids = await db.EstudioJobs.AsNoTracking()
                .Where(j => (j.Status == "fila" || j.Status == "rodando") && (j.ProximaConsulta == null || j.ProximaConsulta <= agora))
                .OrderBy(j => j.CriadoEm)
                .Select(j => j.Id)
                .Take(20)
                .ToListAsync(ct);
        }

        foreach (var id in ids)
        {
            if (_emAndamento.ContainsKey(id)) continue;
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var job = await db.EstudioJobs.FirstOrDefaultAsync(j => j.Id == id, ct);
            if (job is null || job.Status is not ("fila" or "rodando")) continue;

            if (job.Provedor == "local")
            {
                if (job.Status == "fila") IniciarLocal(id, ct);
                continue;
            }

            var proc = scope.ServiceProvider.GetRequiredService<EstudioProcessador>();
            if (job.RequestId is null) await proc.Submeter(job, ct);
            else await proc.Consultar(job, ct);
        }
    }

    private void IniciarLocal(string id, CancellationToken ct)
    {
        if (!_emAndamento.TryAdd(id, 0)) return;
        _ = Task.Run(async () =>
        {
            await _local.WaitAsync(ct);
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var job = await db.EstudioJobs.FirstOrDefaultAsync(j => j.Id == id, ct);
                if (job is { Status: "fila" })
                    await scope.ServiceProvider.GetRequiredService<EstudioProcessador>().ExecutarLocal(job, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                log.LogError(e, "Estúdio: montagem local {Id} falhou", id);
            }
            finally
            {
                _local.Release();
                _emAndamento.TryRemove(id, out _);
            }
        }, ct);
    }
}
