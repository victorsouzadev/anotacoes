using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;

namespace Notas.Api.Services.Financas;

// Regras "essa loja é dessa categoria", aprendidas das correções do usuário.
public static partial class RegrasCategoria
{
    /// <summary>
    /// Reduz a descrição ao que identifica o estabelecimento: sem acento, caixa,
    /// números (parcela, data, CPF mascarado) nem pontuação, só as 3 primeiras
    /// palavras. "LIDER MARABA   MARABA BRA" e "Lider Maraba 2/3" viram "LIDER MARABA MARABA".
    /// </summary>
    public static string ChaveDeDescricao(string descricao)
    {
        var semAcento = new string(descricao.ToUpperInvariant().Normalize(NormalizationForm.FormD)
            .Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
            .ToArray());
        var palavras = NaoLetra().Replace(semAcento, " ")
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(p => p.Length > 1)
            .Take(3);
        var chave = string.Join(' ', palavras);
        return chave.Length > 120 ? chave[..120] : chave;
    }

    public static async Task<Dictionary<string, Categoria>> CarregarAsync(AppDbContext db, string userId,
        CancellationToken ct) =>
        await db.RegrasCategoria.AsNoTracking()
            .Where(r => r.UserId == userId)
            .ToDictionaryAsync(r => r.Chave, r => r.Categoria, ct);

    /// <summary>Grava (ou troca) a regra para a descrição. Chave vazia não vira regra.</summary>
    public static async Task AprenderAsync(AppDbContext db, string userId, string descricao, Categoria categoria,
        CancellationToken ct)
    {
        var chave = ChaveDeDescricao(descricao);
        if (chave.Length < 3) return;

        var regra = await db.RegrasCategoria.FirstOrDefaultAsync(r => r.UserId == userId && r.Chave == chave, ct);
        if (regra is null)
        {
            db.RegrasCategoria.Add(new RegraCategoria { UserId = userId, Chave = chave, Categoria = categoria });
        }
        else
        {
            regra.Categoria = categoria;
            regra.AtualizadaEm = DateTime.UtcNow;
        }
    }

    [GeneratedRegex(@"[^A-Z]+")]
    private static partial Regex NaoLetra();
}
