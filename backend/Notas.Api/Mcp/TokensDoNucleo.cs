using Microsoft.EntityFrameworkCore;
using Notas.Api.Auth;
using Notas.Api.Data;
using Notas.Api.Services.Auth;

namespace Notas.Api.Mcp;

/// <summary>
/// Spec 033 (T011): tokens MCP estáticos de serviços do núcleo, gerados em Configurações → Conexões no lugar da tela
/// do Cérebro. <c>apps</c> vale para /api/mcp/* (lido direto do banco) e <c>ops</c> para o MCP da VPS, que não lê o
/// banco: a api grava os hashes ativos num arquivo (<c>Ops:TokensFile</c>) montado só leitura no ops.
/// </summary>
public static class TokensDoNucleo
{
    public const string Apps = "apps";
    public const string Ops = "ops";
    public static readonly IReadOnlySet<string> Destinos = new HashSet<string> { Apps, Ops };

    /// <summary>Token <c>apps</c> ativo e com selo válido com esse hash: (usuário, e-mail).</summary>
    public static async Task<McpToken?> AppsPeloHash(AppDbContext db, ChavesDeAssinatura chaves, string hash, CancellationToken ct)
    {
        var t = await db.McpTokens.FirstOrDefaultAsync(x => x.Plugin == Apps && x.Hash == hash && x.RevogadoEm == null, ct);
        if (t is null || t.Selo != OAuthDoNucleo.SeloDe(chaves, t)) return null;
        await db.McpTokens.Where(x => x.Id == t.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.UltimoUso, DateTime.UtcNow), ct);
        return t;
    }

    /// <summary>Reescreve o arquivo do ops (um hash por linha) de forma atômica. Sem a pasta, não faz nada.</summary>
    public static async Task GravarOps(AppDbContext db, ChavesDeAssinatura chaves, IConfiguration config, CancellationToken ct = default)
    {
        var caminho = config["Ops:TokensFile"] ?? "/ops-access/ops-tokens.sha256";
        var pasta = Path.GetDirectoryName(caminho);
        if (string.IsNullOrEmpty(pasta) || !Directory.Exists(pasta)) return;
        var hashes = (await db.McpTokens.Where(t => t.Plugin == Ops && t.RevogadoEm == null).ToListAsync(ct))
            .Where(t => t.Selo == OAuthDoNucleo.SeloDe(chaves, t)).Select(t => t.Hash).Order();
        var tmp = caminho + ".tmp";
        await File.WriteAllLinesAsync(tmp, hashes, ct);
        File.Move(tmp, caminho, overwrite: true);
    }
}

/// <summary>Grava o arquivo do ops ao subir, para ele refletir o banco mesmo depois de uma restauração.</summary>
public sealed class ArquivoDoOps(IServiceProvider sp, ILogger<ArquivoDoOps> log) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        try
        {
            using var s = sp.CreateScope();
            await TokensDoNucleo.GravarOps(s.ServiceProvider.GetRequiredService<AppDbContext>(),
                s.ServiceProvider.GetRequiredService<ChavesDeAssinatura>(), s.ServiceProvider.GetRequiredService<IConfiguration>(), ct);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or Microsoft.Data.Sqlite.SqliteException)
        {
            log.LogWarning("Arquivo de tokens do ops: {Erro}", e.Message);
        }
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
