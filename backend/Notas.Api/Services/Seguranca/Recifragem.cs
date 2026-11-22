using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;

namespace Notas.Api.Services.Seguranca;

/// <summary>Linha de <c>core_segredos_recifrados</c> (dono: núcleo): segredo já entregue a um plug-in.</summary>
public class SegredoRecifrado
{
    public string Plugin { get; set; } = "";
    public string Tabela { get; set; } = "";
    public string Linha { get; set; } = "";
    public DateTime Em { get; set; } = DateTime.UtcNow;
}

public record PedidoRecifrar(string Tabela, string Linha);

/// <summary>
/// Spec 035: segredos cifrados com a chave do núcleo em tabelas que passam a ser de um plug-in. Na primeira subida, o
/// plug-in pede o texto claro de cada linha para recifrar com o <c>SEGREDO_PLUGIN</c> dele. Só tabelas desta lista,
/// só para o plug-in dono, o núcleo lê o valor do banco (o plug-in não manda texto cifrado para ser aberto) e cada
/// linha sai uma vez só.
/// </summary>
public static class Recifragem
{
    public static readonly Dictionary<(string Plugin, string Tabela), Func<AppDbContext, string, CancellationToken, Task<string?>>> Permitidas = new()
    {
        // A tabela é do plug-in desde a spec 035 (fora do modelo do núcleo): lida direto. O EF grava o Guid em texto
        // maiúsculo no SQLite e o Postgres
        // devolve o uuid em minúsculas; upper() cobre os dois. Colunas entre aspas: o Postgres não diferencia sem elas (spec 038).
        [("financas", "configuracoes_auvp")] = async (db, linha, ct) => Guid.TryParse(linha, out var id)
            ? await db.Database.SqlQuery<string?>(
                    $"SELECT \"ChaveCifrada\" AS \"Value\" FROM configuracoes_auvp WHERE upper(CAST(\"Id\" AS text)) = {id.ToString().ToUpperInvariant()}")
                .FirstOrDefaultAsync(ct)
            : null,
    };

    public enum Resultado { Entregue, NaoPermitida, NaoEncontrada, JaEntregue }

    public static async Task<(Resultado, string?)> Executar(AppDbContext db, IProtetorDeSegredos protetor, string plugin,
        PedidoRecifrar p, CancellationToken ct)
    {
        if (!Permitidas.TryGetValue((plugin, p.Tabela), out var ler)) return (Resultado.NaoPermitida, null);
        if (await db.SegredosRecifrados.AnyAsync(s => s.Plugin == plugin && s.Tabela == p.Tabela && s.Linha == p.Linha, ct))
            return (Resultado.JaEntregue, null);
        var cifrado = await ler(db, p.Linha, ct);
        if (cifrado is not { Length: > 0 } || protetor.Desproteger(cifrado) is not { } claro) return (Resultado.NaoEncontrada, null);
        db.SegredosRecifrados.Add(new SegredoRecifrado { Plugin = plugin, Tabela = p.Tabela, Linha = p.Linha });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { return (Resultado.JaEntregue, null); } // duas chamadas ao mesmo tempo
        return (Resultado.Entregue, claro);
    }
}
