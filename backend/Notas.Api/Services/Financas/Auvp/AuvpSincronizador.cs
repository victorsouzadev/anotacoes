using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Notas.Api.Data;

namespace Notas.Api.Services.Financas.Auvp;

public record ResultadoSincronizacaoAuvp(int Importadas, int JaExistentes, int ParaRevisao, DateTime SincronizadoEm);

// Traz as transações da AUVP para os lançamentos do usuário.
//
// Uma transação já importada nunca é sobrescrita: o usuário pode ter corrigido a
// categoria ou o valor aqui, e a próxima sincronização apagaria a correção.
public class AuvpSincronizador(AppDbContext db, IAuvpCliente cliente, IOptions<AuvpOptions> opcoes)
{
    public const string Origem = "auvp";
    private const int TamanhoPagina = 100;

    // Faturas de cartão e lançamentos pendentes mudam por alguns dias depois da
    // compra; reler uma janela para trás pega o que chegou atrasado.
    private static readonly TimeSpan Sobreposicao = TimeSpan.FromDays(45);

    public async Task<ResultadoSincronizacaoAuvp> SincronizarAsync(string userId, string chave,
        DateTime? ultimaSincronizacao, DateOnly? de, DateOnly? ate, CancellationToken ct)
    {
        de ??= ultimaSincronizacao is { } u ? DateOnly.FromDateTime(u - Sobreposicao) : null;

        var existentes = (await db.Transacoes.AsNoTracking()
                .Where(t => t.UserId == userId && t.OrigemExterna == Origem && t.IdExterno != null)
                .Select(t => t.IdExterno!)
                .ToListAsync(ct))
            .ToHashSet();

        int importadas = 0, jaExistentes = 0, paraRevisao = 0;
        var maxPaginas = Math.Max(1, opcoes.Value.MaxPaginas);

        for (var pagina = 1; pagina <= maxPaginas; pagina++)
        {
            var resposta = await cliente.ListarTransacoesAsync(chave, de, ate, pagina, TamanhoPagina, ct);

            foreach (var item in resposta.Transactions)
            {
                var idExterno = item.Id.ToString(System.Globalization.CultureInfo.InvariantCulture);
                if (!existentes.Add(idExterno))
                {
                    jaExistentes++;
                    continue;
                }

                var transacao = Converter(item, userId);
                if (transacao.Status == StatusTransacao.PendenteRevisao) paraRevisao++;
                db.Transacoes.Add(transacao);
                importadas++;
            }

            var total = resposta.Pagination?.TotalPages ?? 1;
            if (resposta.Transactions.Count == 0 || pagina >= total) break;
        }

        var agora = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return new ResultadoSincronizacaoAuvp(importadas, jaExistentes, paraRevisao, agora);
    }

    public static Transacao Converter(AuvpTransacao item, string userId)
    {
        var tipo = item.Type?.Equals("CREDIT", StringComparison.OrdinalIgnoreCase) == true
            || (item.Type is null && item.Amount > 0)
            ? TipoTransacao.Receita
            : TipoTransacao.Despesa;

        var conta = item.UserAccount?.Name;
        var descricao = string.IsNullOrWhiteSpace(item.Description) ? "Transação AUVP" : item.Description.Trim();
        if (descricao.Length > 500) descricao = descricao[..500];

        // Ignoradas e transferências entre contas próprias entram (o usuário pediu
        // tudo), mas pendentes: contadas como gasto, inflariam o mês em dobro.
        var avisos = new List<string>();
        if (item.Ignore) avisos.Add("marcada como ignorada na AUVP");
        if (item.IsInternalTransfer) avisos.Add("transferência entre contas próprias");

        var observacoes = string.Join(" · ", new[]
        {
            avisos.Count > 0 ? $"Importada da AUVP ({string.Join(", ", avisos)})." : null,
            string.IsNullOrWhiteSpace(item.Observations) ? null : item.Observations.Trim(),
        }.Where(x => x is not null));

        return new Transacao
        {
            UserId = userId,
            Descricao = descricao,
            Valor = Math.Abs(item.Amount),
            Tipo = tipo,
            Categoria = AuvpCategorias.Mapear(item.CategoryId, tipo),
            // A AUVP grava a data em UTC à meia-noite de Brasília (03:00Z).
            Data = DateOnly.FromDateTime(item.Date.ToOffset(TimeSpan.FromHours(-3)).DateTime),
            FormaPagamento = item.UserAccount?.Subtype?.Equals("CREDIT_CARD", StringComparison.OrdinalIgnoreCase) == true
                ? FormaPagamento.Cartao
                : null,
            TextoOriginal = conta is null ? "AUVP" : $"AUVP · {conta}",
            ConfiancaIa = 1f,
            Status = avisos.Count > 0 ? StatusTransacao.PendenteRevisao : StatusTransacao.Confirmado,
            Observacoes = observacoes.Length == 0 ? null : observacoes,
            OrigemExterna = Origem,
            IdExterno = item.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
        };
    }
}

// O catálogo de categorias da AUVP é o do open banking (Pluggy): global, fixo, com
// ~130 entradas agrupadas em faixas de id. Cada faixa cai numa categoria daqui.
public static class AuvpCategorias
{
    public static Categoria Mapear(int? id, TipoTransacao tipo) => id switch
    {
        null => Categoria.Outros,
        >= 1 and <= 6 => tipo == TipoTransacao.Receita ? Categoria.Salario : Categoria.Outros,
        >= 7 and <= 14 => Categoria.ContasServicos,      // empréstimos, juros, financiamentos
        >= 15 and <= 21 => Categoria.Investimentos,
        >= 22 and <= 41 => Categoria.Outros,             // pensão e transferências
        42 => Categoria.ContasServicos,                  // pagamento de fatura
        >= 43 and <= 45 => Categoria.Outros,
        >= 46 and <= 50 => Categoria.ContasServicos,     // serviços, telecom
        >= 51 and <= 55 => Categoria.Educacao,
        56 or 59 => Categoria.Saude,
        57 or 58 => Categoria.Lazer,                     // academia, esportes
        >= 60 and <= 63 => Categoria.Lazer,
        70 => Categoria.Educacao,                        // livraria
        >= 64 and <= 72 => Categoria.Compras,
        73 => Categoria.Outros,                          // cashback
        74 => Categoria.ContasServicos,                  // serviços digitais
        >= 75 and <= 77 => Categoria.Lazer,              // jogos, streaming
        >= 78 and <= 81 => Categoria.Alimentacao,
        86 => Categoria.Transporte,                      // passagem de ônibus
        >= 82 and <= 85 => Categoria.Lazer,              // viagens, hospedagem
        87 => Categoria.Outros,                          // doações
        >= 88 and <= 90 => Categoria.Lazer,              // apostas
        >= 91 and <= 98 => Categoria.ContasServicos,     // impostos, taxas
        >= 99 and <= 106 => Categoria.Moradia,
        >= 107 and <= 111 => Categoria.Saude,
        >= 112 and <= 123 => Categoria.Transporte,
        127 => Categoria.Saude,                          // seguro saúde
        >= 124 and <= 128 => Categoria.ContasServicos,   // seguros
        129 => Categoria.Lazer,
        _ => Categoria.Outros,
    };
}
