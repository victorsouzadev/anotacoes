using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Notas.Api.Data;

namespace Notas.Api.Services.Financas.Auvp;

public record ResultadoSincronizacaoAuvp(int Importadas, int JaExistentes, int Atualizadas, int ForaDosTotais,
    DateTime SincronizadoEm);

// Traz as transações da AUVP para os lançamentos do usuário.
//
// Uma transação já importada não tem descrição, valor nem categoria sobrescritos:
// o usuário pode ter corrigido aqui (e a correção já foi mandada para a AUVP). O
// que só o banco sabe — mês da fatura, parcelas, tags, orçamento — é atualizado.
public partial class AuvpSincronizador(AppDbContext db, IAuvpCliente cliente, IOptions<AuvpOptions> opcoes)
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

        var existentes = await db.Transacoes
            .Where(t => t.UserId == userId && t.OrigemExterna == Origem && t.IdExterno != null)
            .ToDictionaryAsync(t => t.IdExterno!, ct);

        // Apagado aqui pelo usuário = não volta.
        var excluidas = (await db.TransacoesExcluidas.AsNoTracking()
                .Where(x => x.UserId == userId && x.Origem == Origem)
                .Select(x => x.IdExterno)
                .ToListAsync(ct))
            .ToHashSet();

        var regras = await RegrasCategoria.CarregarAsync(db, userId, ct);
        var vistos = new HashSet<string>();

        int importadas = 0, jaExistentes = 0, atualizadas = 0, foraDosTotais = 0;
        var maxPaginas = Math.Max(1, opcoes.Value.MaxPaginas);

        for (var pagina = 1; pagina <= maxPaginas; pagina++)
        {
            var resposta = await cliente.ListarTransacoesAsync(chave, de, ate, pagina, TamanhoPagina, ct);

            foreach (var item in resposta.Transactions)
            {
                var idExterno = item.Id.ToString(CultureInfo.InvariantCulture);
                if (!vistos.Add(idExterno) || excluidas.Contains(idExterno)) continue;

                var novo = Converter(item, userId, regras);
                if (existentes.TryGetValue(idExterno, out var atual))
                {
                    jaExistentes++;
                    if (AtualizarDoBanco(atual, novo)) atualizadas++;
                    continue;
                }

                if (novo.ForaDosTotais) foraDosTotais++;
                db.Transacoes.Add(novo);
                importadas++;
            }

            var total = resposta.Pagination?.TotalPages ?? 1;
            if (resposta.Transactions.Count == 0 || pagina >= total) break;
        }

        var agora = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return new ResultadoSincronizacaoAuvp(importadas, jaExistentes, atualizadas, foraDosTotais, agora);
    }

    // Só o que é do banco. Fora dos totais só liga: desligar é decisão do usuário,
    // e uma transferência que ele tirou da conta aqui não volta sozinha.
    private static bool AtualizarDoBanco(Transacao atual, Transacao doBanco)
    {
        var mudou = false;
        void Trocar<T>(T antes, T depois, Action<T> gravar)
        {
            if (EqualityComparer<T>.Default.Equals(antes, depois)) return;
            gravar(depois);
            mudou = true;
        }

        Trocar(atual.Competencia, doBanco.Competencia, v => atual.Competencia = v);
        Trocar(atual.Parcela, doBanco.Parcela, v => atual.Parcela = v);
        Trocar(atual.TotalParcelas, doBanco.TotalParcelas, v => atual.TotalParcelas = v);
        Trocar(atual.Conta, doBanco.Conta, v => atual.Conta = v);
        Trocar(atual.Tags, doBanco.Tags, v => atual.Tags = v);
        Trocar(atual.OrcamentoAuvp, doBanco.OrcamentoAuvp, v => atual.OrcamentoAuvp = v);
        if (doBanco.ForaDosTotais && !atual.ForaDosTotais)
        {
            atual.ForaDosTotais = true;
            mudou = true;
        }
        return mudou;
    }

    public static Transacao Converter(AuvpTransacao item, string userId,
        IReadOnlyDictionary<string, Categoria>? regras = null)
    {
        var tipo = item.Type?.Equals("CREDIT", StringComparison.OrdinalIgnoreCase) == true
            || (item.Type is null && item.Amount > 0)
            ? TipoTransacao.Receita
            : TipoTransacao.Despesa;

        var conta = item.UserAccount?.Name;
        var descricao = string.IsNullOrWhiteSpace(item.Description) ? "Transação AUVP" : item.Description.Trim();
        if (descricao.Length > 500) descricao = descricao[..500];

        // Ignoradas e transferências entre contas próprias entram (o usuário pediu
        // tudo), mas fora dos totais — é o mesmo critério do painel da AUVP, e
        // somadas inflariam o mês: em set/2026 eram R$ 19 mil a mais de cada lado.
        // Transferência de mesma titularidade (id 23–26) também: é dinheiro indo
        // para outra conta do usuário que a AUVP não conectou, não gasto.
        var avisos = new List<string>();
        if (item.Ignore) avisos.Add("marcada como ignorada na AUVP");
        if (item.IsInternalTransfer) avisos.Add("transferência entre contas próprias");
        else if (item.CategoryId is >= 23 and <= 26) avisos.Add("transferência para conta de mesma titularidade");

        var observacoes = string.Join(" · ", new[]
        {
            avisos.Count > 0 ? $"Importada da AUVP ({string.Join(", ", avisos)})." : null,
            string.IsNullOrWhiteSpace(item.Observations) ? null : item.Observations.Trim(),
        }.Where(x => x is not null));

        var tags = item.TransactionTags?
            .Select(t => t.Tag?.Name?.Trim())
            .Where(n => !string.IsNullOrEmpty(n))
            .Select(n => n!.Replace("|", "/"))
            .Distinct()
            .ToList() ?? [];

        var (parcela, totalParcelas) = LerParcela(descricao);
        var data = DateOnly.FromDateTime(item.Date.ToOffset(TimeSpan.FromHours(-3)).DateTime);

        return new Transacao
        {
            UserId = userId,
            Descricao = descricao,
            Valor = Math.Abs(item.Amount),
            Tipo = tipo,
            // Ordem de confiança: regra que o próprio usuário ensinou aqui, tag que
            // ele pôs na AUVP, e só então o palpite do banco.
            Categoria = (regras is not null
                         && regras.TryGetValue(RegrasCategoria.ChaveDeDescricao(descricao), out var daRegra)
                    ? daRegra
                    : (Categoria?)null)
                ?? AuvpCategorias.DaTag(tags)
                ?? AuvpCategorias.Mapear(item.CategoryId, tipo),
            // A AUVP grava a data em UTC à meia-noite de Brasília (03:00Z).
            Data = data,
            // O mês de referência vem como dia 1 em UTC; sem ele, o mês da data.
            Competencia = item.ReferenceMonth is { } r
                ? new DateOnly(r.UtcDateTime.Year, r.UtcDateTime.Month, 1)
                : Transacao.CompetenciaDe(data),
            Parcela = parcela,
            TotalParcelas = totalParcelas,
            Conta = conta is null ? null : conta.Length > 120 ? conta[..120] : conta,
            Tags = tags.Count == 0 ? null : Limitar(string.Join('|', tags), 500),
            OrcamentoAuvp = item.Budget?.Key,
            FormaPagamento = item.UserAccount?.Subtype?.Equals("CREDIT_CARD", StringComparison.OrdinalIgnoreCase) == true
                ? FormaPagamento.Cartao
                : null,
            TextoOriginal = conta is null ? "AUVP" : $"AUVP · {conta}",
            ConfiancaIa = 1f,
            Status = StatusTransacao.Confirmado,
            ForaDosTotais = avisos.Count > 0,
            Observacoes = observacoes.Length == 0 ? null : observacoes,
            OrigemExterna = Origem,
            IdExterno = item.Id.ToString(CultureInfo.InvariantCulture),
        };
    }

    /// <summary>"GOLDMEN HOTEL VILA DO 8/10" → (8, 10). Data no fim ("10/09/2026") não conta.</summary>
    public static (int? Parcela, int? Total) LerParcela(string descricao)
    {
        var m = ParcelaNoFim().Match(descricao);
        if (!m.Success) return (null, null);
        var p = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
        var t = int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture);
        return p >= 1 && t >= 2 && p <= t ? (p, t) : (null, null);
    }

    private static string Limitar(string s, int max) => s.Length > max ? s[..max] : s;

    [GeneratedRegex(@"(?<![\d/])(\d{1,2})/(\d{1,2})\s*$")]
    private static partial Regex ParcelaNoFim();
}

// O catálogo de categorias da AUVP é o do open banking (Pluggy): global, fixo, com
// ~130 entradas agrupadas em faixas de id. Cada faixa cai numa categoria daqui.
public static class AuvpCategorias
{
    // Tags que o usuário cria na AUVP, comparadas sem acento e sem caixa. Tags de
    // pessoa ("Pai", "Manu") ou de método ("Conforto") não dizem a categoria.
    private static readonly Dictionary<string, Categoria> PorTag = new()
    {
        ["alimentacao"] = Categoria.Alimentacao, ["mercado"] = Categoria.Alimentacao,
        ["restaurante"] = Categoria.Alimentacao, ["comida"] = Categoria.Alimentacao,
        ["transporte"] = Categoria.Transporte, ["combustivel"] = Categoria.Transporte,
        ["carro"] = Categoria.Transporte, ["uber"] = Categoria.Transporte,
        ["casa"] = Categoria.Moradia, ["moradia"] = Categoria.Moradia, ["aluguel"] = Categoria.Moradia,
        ["saude"] = Categoria.Saude, ["farmacia"] = Categoria.Saude,
        ["educacao"] = Categoria.Educacao, ["cursos"] = Categoria.Educacao,
        ["lazer"] = Categoria.Lazer, ["viagem"] = Categoria.Lazer,
        ["vestuario"] = Categoria.Compras, ["roupas"] = Categoria.Compras, ["beleza"] = Categoria.Compras,
        ["papelaria"] = Categoria.Compras, ["compras"] = Categoria.Compras,
        ["contas"] = Categoria.ContasServicos, ["assinaturas"] = Categoria.ContasServicos,
        ["salario"] = Categoria.Salario, ["investimentos"] = Categoria.Investimentos,
    };

    public static Categoria? DaTag(string? tag) =>
        string.IsNullOrWhiteSpace(tag) ? null : PorTag.TryGetValue(Normalizar(tag), out var c) ? c : null;

    public static Categoria? DaTag(IEnumerable<string?>? tags)
    {
        if (tags is null) return null;
        foreach (var tag in tags)
        {
            if (string.IsNullOrWhiteSpace(tag)) continue;
            if (PorTag.TryGetValue(Normalizar(tag), out var categoria)) return categoria;
        }
        return null;
    }

    public static string Normalizar(string texto)
    {
        // CulturaBr, e não Normalize: sem ICU (globalização invariante) Normalize
        // não tira acento e "Alimentação" deixaria de casar com "alimentacao".
        return CulturaBr.SemAcentos(texto.Trim()).ToLowerInvariant();
    }

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
