using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Notas.Api.Data;
using Notas.Api.Services.Seguranca;

namespace Notas.Api.Services.Financas.Auvp;

// Sincroniza sozinha, de tempos em tempos, quem tem chave da AUVP cadastrada —
// para o dashboard estar em dia sem ninguém lembrar de apertar o botão.
public class AuvpSincronizacaoAutomatica(
    IServiceScopeFactory scopes, IOptions<AuvpOptions> opcoes, ILogger<AuvpSincronizacaoAutomatica> logger)
    : BackgroundService
{
    // Acorda a cada meia hora para ver quem venceu; o intervalo de cada usuário
    // é contado a partir da última sincronização dele, manual ou automática.
    private static readonly TimeSpan Verificacao = TimeSpan.FromMinutes(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var o = opcoes.Value;
        if (string.IsNullOrWhiteSpace(o.BaseUrl) || o.IntervaloSincronizacaoHoras <= 0) return;

        // Deixa a aplicação terminar de subir (migrações, primeiro acesso) antes.
        try { await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RodadaAsync(TimeSpan.FromHours(o.IntervaloSincronizacaoHoras), stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Falha na rodada de sincronização automática da AUVP.");
            }

            try { await Task.Delay(Verificacao, stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task RodadaAsync(TimeSpan intervalo, CancellationToken ct)
    {
        List<Guid> vencidas;
        using (var scope = scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var limite = DateTime.UtcNow - intervalo;
            vencidas = await db.ConfiguracoesAuvp.AsNoTracking()
                .Where(c => c.ChaveCifrada != null && (c.UltimaSincronizacaoEm == null || c.UltimaSincronizacaoEm < limite))
                .Select(c => c.Id)
                .ToListAsync(ct);
        }

        // Um escopo (e um DbContext) por usuário: a falha de um não leva os outros.
        foreach (var id in vencidas)
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var config = await db.ConfiguracoesAuvp.FirstOrDefaultAsync(c => c.Id == id, ct);
            if (config?.ChaveCifrada is not { Length: > 0 }) continue;

            var chave = scope.ServiceProvider.GetRequiredService<IProtetorDeSegredos>().Desproteger(config.ChaveCifrada);
            if (chave is null) continue;

            try
            {
                var r = await scope.ServiceProvider.GetRequiredService<AuvpSincronizador>()
                    .SincronizarAsync(config.UserId, chave, config.UltimaSincronizacaoEm, null, null, ct);
                config.UltimaSincronizacaoEm = r.SincronizadoEm;
                await db.SaveChangesAsync(ct);
                logger.LogInformation("AUVP: {Importadas} novas, {Atualizadas} atualizadas para o usuário {UserId}.",
                    r.Importadas, r.Atualizadas, config.UserId);
            }
            catch (AuvpIndisponivelException ex)
            {
                // Chave recusada ou API fora: tenta de novo na próxima rodada, sem
                // marcar como sincronizado.
                logger.LogWarning("AUVP: sincronização automática falhou para {UserId}: {Motivo}", config.UserId, ex.Message);
            }
        }
    }
}
