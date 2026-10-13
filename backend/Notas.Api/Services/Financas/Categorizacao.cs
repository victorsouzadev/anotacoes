using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Services.Financas.Llm;

namespace Notas.Api.Services.Financas;

public record GrupoPendente(string Chave, string Descricao, string Tipo, int Quantidade, decimal Total,
    DateOnly UltimaData, string? Conta, List<Guid> Ids, string? Sugestao, string? SugestaoRotulo, string? Motivo,
    // Pagamento de fatura: não é categoria, é tirar dos totais.
    bool SugerirForaDosTotais = false);

public record CategorizacaoResponse(int Total, int Pendentes, decimal Percentual, int TotalHistorico,
    int PendentesHistorico, List<GrupoPendente> Grupos);

// Fila de categorização: lançamentos ainda em "Outros" ou recém-sincronizados, sem
// confirmação, agrupados por loja, cada grupo com uma sugestão de categoria.
public static class Categorizacao
{
    /// <summary>Ainda sem categoria confirmada: em Outros, ou recém-sincronizado
    /// (com a categoria que veio de fora), sem o usuário ter confirmado.</summary>
    public static bool Pendente(Transacao t) =>
        !t.ForaDosTotais && !t.CategoriaConfirmada && (t.Categoria == Categoria.Outros || t.RevisarCategoria);

    // Pedaços de nome de estabelecimento como aparecem no extrato (sem acento, em
    // maiúsculas, muitas vezes cortados): "CARRO CHEFE SUPERMERCA", "DROGASIL 123".
    private static readonly (string[] Trechos, Categoria Categoria)[] PorEstabelecimento =
    [
        // Antes de tudo: nomes que contêm palavras de outra categoria ("MERCADOLIVRE" tem "MERCADO").
        (["MERCADOLIVRE", "MERCADO LIVRE", "MERCADOLIBRE"], Categoria.Compras),
        (["SUPERMERC", "MERCADO", "ATACAD", "ASSAI", "CARREFOUR", "PADARIA", "PANIFIC", "ACOUGUE", "HORTIFRUT",
          "RESTAURA", "LANCHON", "PIZZ", "HAMBURG", "BURGER", "IFOOD", "CAFE", "SORVET", "DOCERIA", "BAR E",
          "MC DONALD", "MCDONALD", "SUBWAY", "EMPORIO"], Categoria.Alimentacao),
        (["POSTO", "COMBUST", "SHELL", "IPIRANGA", "PETROBRAS", "UBER", "99APP", "99 APP", "ESTACIONA", "PEDAGIO",
          "AUTO PECAS", "AUTOPECAS", " PECAS", "PNEU", "OFICINA", "MECANICA", "SEM PARAR", "VELOE", "CONECTCAR"], Categoria.Transporte),
        (["DROGA", "FARMA", "DROGASIL", "PAGUE MENOS", "RAIA", "CLINICA", "HOSPITAL", "LABORAT", "ODONTO",
          "OTICA", "UNIMED", "HAPVIDA", "MEDIC"], Categoria.Saude),
        (["NETFLIX", "SPOTIFY", "AMAZON PRIME", "DISNEY", "HBO", "GLOBOPLAY", "YOUTUBE", "CLARO", "VIVO", "TIM ",
          "OI ", "ENERGIA", "EQUATORIAL", "ENEL", "CEMIG", "SANEAM", "AGUA", "COSANPA", "SABESP", "INTERNET",
          "TELECOM", "TARIFA", "TAR ", "ANUIDADE", "SEGURO", "IOF"], Categoria.ContasServicos),
        (["ALUGUEL", "CONDOMIN", "IMOBILI", "MATERIAIS", "MATERIAL DE CONST", "CONSTRU", "LEROY", "MADEIR",
          "FERRAGEN", "PARAFUSO", "ELETRICA", "HIDRAULIC"], Categoria.Moradia),
        (["ESCOLA", "COLEGIO", "FACULD", "UNIVERS", "CURSO", "LIVRARIA", "UDEMY", "ALURA", "PAPELARIA"], Categoria.Educacao),
        (["CINEMA", "INGRESSO", "SYMPLA", "HOTEL", "POUSADA", "AIRBNB", "BOOKING", "VIAGEM", "TURISMO",
          "STEAM", "PLAYSTATION", "XBOX", "BAR ", "CHOPP", "CERVEJ", "ACADEMIA", "SMART FIT"], Categoria.Lazer),
        (["MERCADOLIVRE", "MERCADO LIVRE", "SHOPEE", "AMAZON", "MAGAZINE", "MAGALU", "AMERICANAS", "SHEIN",
          "ALIEXPRESS", "RENNER", "RIACHUELO", "C&A", "CENTAURO", "NETSHOES", "LOJA", "HAVAN", "CALCADOS",
          "MODA", "BOUTIQUE", "PERFUM", "BOTICARIO", "NATURA"], Categoria.Compras),
        (["CDB", "TESOURO", "RDB", "CORRETORA", "INVEST", "APLICACAO", "FUNDO", "FIDC", "XP ", "RICO "], Categoria.Investimentos),
    ];

    public static Categoria? PorNomeDoEstabelecimento(string descricao)
    {
        var texto = " " + CulturaBr.SemAcentos(descricao).ToUpperInvariant() + " ";
        foreach (var (trechos, categoria) in PorEstabelecimento)
            if (trechos.Any(t => texto.Contains(t, StringComparison.Ordinal))) return categoria;
        return null;
    }

    public static async Task<CategorizacaoResponse> MontarAsync(AppDbContext db, string userId, int? ano, int? mes,
        CancellationToken ct)
    {
        var todas = await db.Transacoes.AsNoTracking()
            .Where(t => t.UserId == userId && !t.ForaDosTotais)
            .ToListAsync(ct);

        var escopo = ano is { } a && mes is { } m
            ? todas.Where(t => t.Competencia == new DateOnly(a, m, 1)).ToList()
            : todas;
        var pendentes = escopo.Where(Pendente).ToList();

        // O que o usuário já categorizou, por loja: a sugestão mais forte.
        var historico = todas
            .Where(t => t.Categoria != Categoria.Outros && !Pendente(t))
            // Receita e despesa da mesma origem são coisas diferentes ("Pix de" × "Pix para").
            .GroupBy(t => (RegrasCategoria.ChaveDeDescricao(t.Descricao), t.Tipo))
            .ToDictionary(g => g.Key, g => g.GroupBy(t => t.Categoria).OrderByDescending(c => c.Count()).First().Key);

        var grupos = pendentes
            .GroupBy(t => (Chave: RegrasCategoria.ChaveDeDescricao(t.Descricao), t.Tipo))
            .Select(g =>
            {
                var itens = g.OrderByDescending(t => t.Data).ToList();
                var exemplo = itens[0];
                var ehFatura = exemplo.Tipo == TipoTransacao.Despesa
                               && CulturaBr.SemAcentos(exemplo.Descricao).Contains("fatura", StringComparison.OrdinalIgnoreCase);
                var (sugestao, motivo) = ehFatura
                    ? (null, "pagamento de fatura: as compras do cartão já estão lançadas uma a uma")
                    : Sugerir(g.Key.Chave, exemplo, historico);
                return new GrupoPendente(g.Key.Chave, exemplo.Descricao, exemplo.Tipo.ToString().ToLowerInvariant(),
                    itens.Count, itens.Sum(t => t.Valor), exemplo.Data, exemplo.Conta, itens.Select(t => t.Id).ToList(),
                    sugestao?.ToString(), sugestao is { } s ? CategoriaInfo.Rotulo(s) : null, motivo, ehFatura);
            })
            .OrderByDescending(g => g.Total)
            .Take(150)
            .ToList();

        var total = escopo.Count;
        var pendentesHistorico = todas.Count(Pendente);
        return new CategorizacaoResponse(total, pendentes.Count,
            total == 0 ? 100 : Math.Round((total - pendentes.Count) * 100m / total, 1),
            todas.Count, pendentesHistorico, grupos);
    }

    private static (Categoria?, string?) Sugerir(string chave, Transacao exemplo,
        IReadOnlyDictionary<(string, TipoTransacao), Categoria> historico)
    {
        if (chave.Length >= 3 && historico.TryGetValue((chave, exemplo.Tipo), out var anterior))
            return (anterior, "como você já categorizou esta loja");
        // Sincronizado já com categoria (da AUVP ou de uma regra): sugere confirmar a mesma.
        if (exemplo.Categoria != Categoria.Outros) return (exemplo.Categoria, "categoria recebida na sincronização");
        if (exemplo.Tipo == TipoTransacao.Receita)
            return exemplo.Descricao.Contains("salar", StringComparison.OrdinalIgnoreCase)
                ? (Categoria.Salario, "pelo nome")
                : (null, null);
        if (PorNomeDoEstabelecimento(exemplo.Descricao) is { } porNome) return (porNome, "pelo nome do estabelecimento");
        // Despesa nunca é salário ("pagamento de pix" tem "pagamento", que o extrator lê como salário).
        if (HeuristicLlmExtractor.SugerirCategoria(exemplo.Descricao) is { } porPalavra && porPalavra != Categoria.Salario)
            return (porPalavra, "pelas palavras da descrição");
        return (null, null);
    }
}
