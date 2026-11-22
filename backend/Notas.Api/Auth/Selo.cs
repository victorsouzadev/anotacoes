using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Notas.Api.Data;

namespace Notas.Api.Auth;

/// <summary>
/// Selo HMAC das linhas de login (spec 030). Com o banco compartilhado (031), um plug-in consegue gravar em
/// qualquer tabela; sem a chave do selo, que só o núcleo tem, a linha que ele inserir não serve para logar.
/// </summary>
public static class Selo
{
    public static string De(ChavesDeAssinatura c, User u) => c.Selar("users", u.Id, u.Email, u.PasswordHash);

    public static string De(ChavesDeAssinatura c, RefreshToken t) =>
        c.Selar("refresh_tokens", t.TokenHash, t.UserId, t.ExpiresAt.Ticks.ToString());

    public static bool Confere(ChavesDeAssinatura c, User u) => c.SeloConfere(u.Selo, "users", u.Id, u.Email, u.PasswordHash);

    /// <remarks>
    /// O Postgres guarda a data em microssegundos (10 ticks) e o selo foi feito com os ticks completos: o valor lido
    /// pode ter perdido até 9 ticks, então confere as 10 possibilidades (spec 038). No SQLite a primeira já bate.
    /// </remarks>
    public static bool Confere(ChavesDeAssinatura c, RefreshToken t)
    {
        for (var d = 0; d < 10; d++)
            if (c.SeloConfere(t.Selo, "refresh_tokens", t.TokenHash, t.UserId, (t.ExpiresAt.Ticks + d).ToString()))
                return true;
        return false;
    }

    /// <summary>
    /// Sela as linhas que já existiam, uma única vez (marca <c>selado-em</c> na pasta das chaves). Depois disso
    /// uma linha sem selo é recusada, nunca selada: senão bastaria a um plug-in inserir e esperar o próximo boot.
    /// </summary>
    public static void SelarExistentes(AppDbContext db, ChavesDeAssinatura c, string pastaChaves)
    {
        var marca = Path.Combine(pastaChaves, "selado-em");
        if (File.Exists(marca)) return;
        foreach (var u in db.Users.Where(u => u.Selo == null)) u.Selo = De(c, u);
        foreach (var t in db.RefreshTokens.Where(t => t.Selo == null && t.RevokedAt == null)) t.Selo = De(c, t);
        db.SaveChanges();
        File.WriteAllText(marca, DateTime.UtcNow.ToString("O"));
    }
}

/// <summary>Toda gravação do núcleo em <c>users</c> e <c>refresh_tokens</c> sai selada.</summary>
public sealed class SeloInterceptor(ChavesDeAssinatura chaves) : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(DbContextEventData e, InterceptionResult<int> r)
    {
        Selar(e.Context);
        return r;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData e, InterceptionResult<int> r,
        CancellationToken ct = default)
    {
        Selar(e.Context);
        return ValueTask.FromResult(r);
    }

    private void Selar(DbContext? ctx)
    {
        if (ctx is null) return;
        foreach (var en in ctx.ChangeTracker.Entries())
        {
            if (en.State is not (EntityState.Added or EntityState.Modified)) continue;
            switch (en.Entity)
            {
                case User u: u.Selo = Selo.De(chaves, u); break;
                case RefreshToken t: t.Selo = Selo.De(chaves, t); break;
                case Notas.Api.Services.Auth.OAuthToken o: o.Selo = Notas.Api.Services.Auth.OAuthDoNucleo.SeloDe(chaves, o); break;
                case Notas.Api.Services.Auth.McpToken m: m.Selo = Notas.Api.Services.Auth.OAuthDoNucleo.SeloDe(chaves, m); break;
            }
        }
    }
}
