using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;

namespace Notas.Api.Services.Financas;

// ---------------------------------------------------------------- respostas

public record SaudeFinanceira(
    int Ano, int Mes,
    decimal Receitas, decimal Despesas,
    // Taxa de poupança: quanto da receita sobrou. Do mês e média dos últimos 6.
    decimal? TaxaPoupanca, decimal? TaxaPoupancaMedia,
    // Reserva de emergência.
    decimal GastoEssencialMedio, int MesesReservaAlvo, decimal ReservaAlvo, decimal ReservaAtual,
    decimal? MesesCobertos, Guid? MetaReservaId,
    // Pague-se primeiro.
    decimal PercentualPagueSePrimeiro, decimal ValorPagueSePrimeiro, decimal GuardadoNoMes,
    // Orçamento base zero: quanto da renda ainda não tem destino.
    decimal RendaDoMes, decimal ComDestino, decimal ADistribuir,
    // Independência financeira (regra dos 4%).
    decimal GastoAnual, decimal PatrimonioAlvo, decimal PatrimonioInvestido, decimal PoupancaMensalMedia,
    decimal? AnosParaIndependencia);

public record FatiaMetodo(string Chave, string Nome, decimal Percentual, decimal Planejado, decimal Realizado,
    decimal Utilizado, string Descricao, List<string> Categorias);

public record MetodoResponse(string Metodo, string Nome, int Ano, int Mes, decimal Renda, List<FatiaMetodo> Fatias,
    decimal SemFatia);

public record EnvelopeResponse(string Categoria, string CategoriaRotulo, decimal PlanejadoMes, decimal GastoMes,
    decimal SaldoAcumulado, int MesesConsiderados);

public record ProvisaoResponse(Guid Id, string Nome, decimal Valor, int MesVencimento, decimal ValorReservado,
    decimal ValorMensal, DateOnly ProximoVencimento, int MesesRestantes, decimal NecessarioPorMes,
    decimal ReservadoEsperado, string Situacao);

public record ProvisoesResponse(List<ProvisaoResponse> Itens, decimal TotalMensal, decimal TotalAnual);

public record DividaResponse(Guid Id, string Nome, decimal Saldo, decimal JurosMensal, decimal ParcelaMinima);

public record PassoQuitacao(string Nome, int MesQuitacao);

public record EstrategiaQuitacao(string Estrategia, bool Viavel, int Meses, decimal JurosTotais,
    decimal TotalPago, List<PassoQuitacao> Ordem);

public record SimulacaoDividas(decimal PagamentoMensal, EstrategiaQuitacao BolaDeNeve,
    EstrategiaQuitacao Avalanche, string Recomendacao);

public record EventoFluxo(DateOnly Data, string Descricao, decimal Valor, string Origem);

public record PontoFluxo(DateOnly Data, decimal Saldo);

public record FluxoCaixaResponse(decimal SaldoInicial, string OrigemSaldo, List<PontoFluxo> Pontos,
    List<EventoFluxo> Eventos, decimal MenorSaldo, DateOnly DataMenorSaldo, DateOnly? PrimeiroDiaNegativo,
    decimal SaldoFinal);

public record CategoriaVariacao(string Categoria, string Rotulo, decimal Valor, decimal ValorMesAnterior);

public record FechamentoResponse(int Ano, int Mes,
    decimal Receitas, decimal Despesas, decimal Saldo, decimal? TaxaPoupanca,
    decimal? OrcamentoUtilizado, List<CategoriaVariacao> Categorias,
    decimal? MetaPoupanca, string? Reflexao, string? Compromisso, DateTime? AtualizadoEm);

// ---------------------------------------------------------------- serviço

// As metodologias de organização financeira, calculadas sobre os lançamentos:
// taxa de poupança, reserva de emergência, pague-se primeiro, base zero,
// independência financeira, divisão da renda (50/30/20, AUVP, 6 potes),
// envelopes, provisões anuais, quitação de dívidas, fluxo de caixa e Kakeibo.
public class PlanejamentoService(AppDbContext db, FinancasClock clock)
{
    // Retorno real anual assumido para a conta de independência financeira.
    private const double RetornoRealAnual = 0.04;

    public async Task<PreferenciasFinancas> PreferenciasAsync(string userId, CancellationToken ct) =>
        await db.PreferenciasFinancas.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == userId, ct)
        ?? new PreferenciasFinancas { UserId = userId };

    private Task<List<Transacao>> DoPeriodoAsync(string userId, DateOnly de, DateOnly ate, CancellationToken ct) =>
        db.Transacoes.AsNoTracking()
            .Where(t => t.UserId == userId && !t.ForaDosTotais && t.Competencia >= de && t.Competencia <= ate)
            .ToListAsync(ct);

    private async Task<decimal> AportesAvulsosAsync(string userId, DateOnly de, DateOnly ate, CancellationToken ct)
    {
        var fim = ate.AddMonths(1).AddDays(-1);
        return await db.MetaAportes.AsNoTracking()
            .Where(a => a.TransacaoId == null && a.Data >= de && a.Data <= fim
                        && db.MetasReserva.Any(m => m.Id == a.MetaId && m.UserId == userId))
            .SumAsync(a => (decimal?)a.Valor, ct) ?? 0m;
    }

    // ------------------------------------------------------------ saúde financeira

    public async Task<SaudeFinanceira> SaudeAsync(string userId, int ano, int mes, CancellationToken ct)
    {
        var p = await PreferenciasAsync(userId, ct);
        var competencia = new DateOnly(ano, mes, 1);
        var inicio = competencia.AddMonths(-5);
        var transacoes = await DoPeriodoAsync(userId, inicio, competencia, ct);

        var doMes = transacoes.Where(t => t.Competencia == competencia).ToList();
        var receitas = doMes.Where(t => t.Tipo == TipoTransacao.Receita).Sum(t => t.Valor);
        var despesas = doMes.Where(t => t.Tipo == TipoTransacao.Despesa).Sum(t => t.Valor);

        // Só os meses com algum lançamento entram na média — um mês vazio no começo
        // do histórico puxaria tudo para baixo.
        var porMes = transacoes.GroupBy(t => t.Competencia)
            .Select(g => new
            {
                Receitas = g.Where(t => t.Tipo == TipoTransacao.Receita).Sum(t => t.Valor),
                Despesas = g.Where(t => t.Tipo == TipoTransacao.Despesa).Sum(t => t.Valor),
                Essenciais = g.Where(t => t.Tipo == TipoTransacao.Despesa
                                          && CategoriaInfo.Grupo(t.Categoria) == GrupoCategoria.Essenciais)
                    .Sum(t => t.Valor),
            })
            .ToList();

        var receitaTotal = porMes.Sum(m => m.Receitas);
        var taxaMedia = receitaTotal > 0 ? Pct((receitaTotal - porMes.Sum(m => m.Despesas)) / receitaTotal) : (decimal?)null;
        var essencialMedio = porMes.Count > 0 ? Arred(porMes.Average(m => m.Essenciais)) : 0m;
        var gastoMedio = porMes.Count > 0 ? porMes.Average(m => m.Despesas) : 0m;
        var poupancaMedia = porMes.Count > 0 ? Arred(porMes.Average(m => m.Receitas - m.Despesas)) : 0m;

        // Reserva de emergência: o saldo da meta escolhida como reserva.
        var reservaAtual = 0m;
        if (p.MetaReservaId is { } metaId)
            reservaAtual = await db.MetaAportes.AsNoTracking()
                .Where(a => a.MetaId == metaId && db.MetasReserva.Any(m => m.Id == metaId && m.UserId == userId))
                .SumAsync(a => (decimal?)a.Valor, ct) ?? 0m;

        // Pague-se primeiro: o que foi para investimento ou meta neste mês.
        var guardado = doMes.Where(t => t.Tipo == TipoTransacao.Despesa && t.Categoria == Categoria.Investimentos)
                           .Sum(t => t.Valor)
                       + await AportesAvulsosAsync(userId, competencia, competencia, ct);

        // Base zero: a renda é a prevista no orçamento (ou, sem ele, a recebida);
        // tem destino o que foi distribuído no orçamento mais as provisões anuais.
        var orcamento = await db.Orcamentos.AsNoTracking().Include(o => o.Itens)
            .FirstOrDefaultAsync(o => o.UserId == userId && o.Ano == ano && o.Mes == mes, ct);
        var renda = orcamento?.ValorTotal ?? receitas;
        var distribuido = orcamento is null
            ? 0m
            : OrcamentoService.Distribuir(orcamento.ValorTotal, orcamento.Itens.Select(i => i.Percentual).ToList()).Sum();
        var provisoes = await db.ProvisoesAnuais.AsNoTracking().Where(x => x.UserId == userId)
            .SumAsync(x => (decimal?)x.Valor, ct) ?? 0m;
        var comDestino = Arred(distribuido + provisoes / 12m);

        var gastoAnual = Arred(gastoMedio * 12);
        var alvo = gastoAnual * 25; // regra dos 4%: 1 / 0,04

        return new SaudeFinanceira(ano, mes, receitas, despesas,
            receitas > 0 ? Pct((receitas - despesas) / receitas) : null, taxaMedia,
            essencialMedio, p.MesesReserva, essencialMedio * p.MesesReserva, reservaAtual,
            essencialMedio > 0 ? Math.Round(reservaAtual / essencialMedio, 1) : null, p.MetaReservaId,
            p.PercentualPagueSePrimeiro, Arred(receitas * p.PercentualPagueSePrimeiro / 100m), guardado,
            renda, comDestino, Arred(renda - comDestino),
            gastoAnual, alvo, p.PatrimonioInvestido, poupancaMedia,
            AnosParaAlvo(p.PatrimonioInvestido, poupancaMedia, alvo));
    }

    /// <summary>
    /// Anos até o patrimônio atingir o alvo, aportando a poupança média todo mês
    /// com retorno real de 4% ao ano. Null se a poupança não chega lá em 100 anos.
    /// </summary>
    public static decimal? AnosParaAlvo(decimal patrimonio, decimal aporteMensal, decimal alvo)
    {
        if (alvo <= 0) return null;
        if (patrimonio >= alvo) return 0;
        if (aporteMensal <= 0) return null;

        var r = Math.Pow(1 + RetornoRealAnual, 1.0 / 12) - 1;
        var saldo = (double)patrimonio;
        for (var m = 1; m <= 1200; m++)
        {
            saldo = saldo * (1 + r) + (double)aporteMensal;
            if (saldo >= (double)alvo) return Math.Round(m / 12m, 1);
        }
        return null;
    }

    // ------------------------------------------------------------ métodos de divisão

    private record DefFatia(string Chave, string Nome, decimal Percentual, string Descricao, Categoria[] Categorias,
        bool IncluiAportes = false, string? OrcamentoAuvp = null);

    private static readonly Dictionary<string, (string Nome, DefFatia[] Fatias)> Metodos = new()
    {
        ["50-30-20"] = ("Regra 50/30/20", [
            new("necessidades", "Necessidades", 50, "Moradia, contas, mercado, transporte, saúde e educação.",
                [Categoria.Moradia, Categoria.ContasServicos, Categoria.Alimentacao, Categoria.Transporte,
                 Categoria.Saude, Categoria.Educacao]),
            new("desejos", "Desejos", 30, "Lazer, compras e o que não é essencial.",
                [Categoria.Lazer, Categoria.Compras, Categoria.Outros]),
            new("poupanca", "Poupança e dívidas", 20, "Investimentos e aportes em metas.",
                [Categoria.Investimentos], IncluiAportes: true),
        ]),
        ["auvp"] = ("Método AUVP", [
            new("custos-fixos", "Custos Fixos", 50, "O que mantém a casa funcionando.",
                [Categoria.Moradia, Categoria.ContasServicos, Categoria.Alimentacao, Categoria.Transporte,
                 Categoria.Saude], OrcamentoAuvp: "CUSTOS_FIXOS"),
            new("conforto", "Conforto", 20, "O que deixa a vida mais confortável.",
                [Categoria.Compras], OrcamentoAuvp: "CONFORTO"),
            new("metas", "Metas", 10, "Objetivos de médio prazo (viagem, carro).",
                [], IncluiAportes: true, OrcamentoAuvp: "METAS"),
            new("prazeres", "Prazeres", 10, "Lazer e diversão sem culpa.",
                [Categoria.Lazer, Categoria.Outros], OrcamentoAuvp: "PRAZERES"),
            new("conhecimento", "Conhecimento", 5, "Cursos, livros, formação.",
                [Categoria.Educacao], OrcamentoAuvp: "CONHECIMENTO"),
            new("liberdade", "Liberdade Financeira", 5, "Investimentos de longo prazo.",
                [Categoria.Investimentos], OrcamentoAuvp: "LIBERDADE_FINANCEIRA"),
        ]),
        ["6-potes"] = ("6 Potes (T. Harv Eker)", [
            new("necessidades", "Necessidades", 55, "Despesas do dia a dia.",
                [Categoria.Moradia, Categoria.ContasServicos, Categoria.Alimentacao, Categoria.Transporte,
                 Categoria.Saude]),
            new("liberdade", "Liberdade financeira", 10, "Investir para gerar renda — nunca gastar.",
                [Categoria.Investimentos]),
            new("longo-prazo", "Poupança de longo prazo", 10, "Compras grandes planejadas.",
                [], IncluiAportes: true),
            new("educacao", "Educação", 10, "Aprender e se desenvolver.", [Categoria.Educacao]),
            new("diversao", "Diversão", 10, "Gastar com prazer, todo mês.",
                [Categoria.Lazer, Categoria.Compras, Categoria.Outros]),
            new("doacoes", "Doações", 5, "Ajudar outras pessoas (lançamentos com tag de doação).", []),
        ]),
    };

    public static bool MetodoValido(string metodo) => Metodos.ContainsKey(metodo);

    public async Task<MetodoResponse> MetodoAsync(string userId, int ano, int mes, string? metodo, CancellationToken ct)
    {
        var p = await PreferenciasAsync(userId, ct);
        var chave = metodo is not null && Metodos.ContainsKey(metodo) ? metodo : p.Metodo;
        if (!Metodos.ContainsKey(chave)) chave = "50-30-20";
        var (nome, defs) = Metodos[chave];

        var competencia = new DateOnly(ano, mes, 1);
        var doMes = await DoPeriodoAsync(userId, competencia, competencia, ct);
        var renda = doMes.Where(t => t.Tipo == TipoTransacao.Receita).Sum(t => t.Valor);
        var despesas = doMes.Where(t => t.Tipo == TipoTransacao.Despesa).ToList();
        var aportes = await AportesAvulsosAsync(userId, competencia, competencia, ct);

        // Cada despesa cai numa fatia só. No método AUVP o orçamento marcado lá
        // vence a categoria; nos outros, doação é reconhecida pela tag.
        var porFatia = defs.ToDictionary(d => d.Chave, _ => 0m);
        var semFatia = 0m;
        foreach (var t in despesas)
        {
            DefFatia? alvo = null;
            if (chave == "auvp" && t.OrcamentoAuvp is { } o) alvo = defs.FirstOrDefault(d => d.OrcamentoAuvp == o);
            if (alvo is null && chave == "6-potes"
                && t.ListaDeTags().Any(x => CulturaBr.SemAcentos(x).Contains("doac", StringComparison.OrdinalIgnoreCase)))
                alvo = defs.First(d => d.Chave == "doacoes");
            alvo ??= defs.FirstOrDefault(d => d.Categorias.Contains(t.Categoria));

            if (alvo is null) semFatia += t.Valor;
            else porFatia[alvo.Chave] += t.Valor;
        }

        var paraAportes = defs.FirstOrDefault(d => d.IncluiAportes);
        if (paraAportes is not null) porFatia[paraAportes.Chave] += aportes;

        var fatias = defs.Select(d =>
        {
            var planejado = Arred(renda * d.Percentual / 100m);
            var realizado = Arred(porFatia[d.Chave]);
            return new FatiaMetodo(d.Chave, d.Nome, d.Percentual, planejado, realizado,
                planejado > 0 ? Pct(realizado / planejado) : 0, d.Descricao,
                d.Categorias.Select(CategoriaInfo.Rotulo).ToList());
        }).ToList();

        return new MetodoResponse(chave, nome, ano, mes, renda, fatias, Arred(semFatia));
    }

    // ------------------------------------------------------------ envelopes

    // Saldo que sobra (ou falta) em cada categoria do orçamento, acumulado mês a
    // mês desde o primeiro orçamento dos últimos 12 meses: o que não foi gasto
    // fica no envelope para o mês seguinte.
    public async Task<List<EnvelopeResponse>> EnvelopesAsync(string userId, int ano, int mes, CancellationToken ct)
    {
        var competencia = new DateOnly(ano, mes, 1);
        var desde = competencia.AddMonths(-11);
        var orcamentos = await db.Orcamentos.AsNoTracking().Include(o => o.Itens)
            .Where(o => o.UserId == userId)
            .ToListAsync(ct);
        orcamentos = orcamentos
            .Where(o => new DateOnly(o.Ano, o.Mes, 1) >= desde && new DateOnly(o.Ano, o.Mes, 1) <= competencia)
            .OrderBy(o => o.Ano).ThenBy(o => o.Mes)
            .ToList();
        if (orcamentos.Count == 0) return [];

        var inicio = new DateOnly(orcamentos[0].Ano, orcamentos[0].Mes, 1);
        var despesas = (await DoPeriodoAsync(userId, inicio, competencia, ct))
            .Where(t => t.Tipo == TipoTransacao.Despesa).ToList();

        var categorias = orcamentos.SelectMany(o => o.Itens.Select(i => i.Categoria)).Distinct().ToList();
        var saldo = categorias.ToDictionary(c => c, _ => 0m);
        var planejadoMes = categorias.ToDictionary(c => c, _ => 0m);
        var gastoMes = categorias.ToDictionary(c => c, _ => 0m);
        var meses = 0;

        for (var m = inicio; m <= competencia; m = m.AddMonths(1))
        {
            meses++;
            var o = orcamentos.FirstOrDefault(x => x.Ano == m.Year && x.Mes == m.Month);
            var planejados = new Dictionary<Categoria, decimal>();
            if (o is not null)
            {
                var valores = OrcamentoService.Distribuir(o.ValorTotal, o.Itens.Select(i => i.Percentual).ToList());
                for (var i = 0; i < o.Itens.Count; i++) planejados[o.Itens[i].Categoria] = valores[i];
            }

            foreach (var c in categorias)
            {
                var plan = planejados.GetValueOrDefault(c);
                var gasto = despesas.Where(t => t.Competencia == m && t.Categoria == c).Sum(t => t.Valor);
                saldo[c] += plan - gasto;
                if (m == competencia) { planejadoMes[c] = plan; gastoMes[c] = gasto; }
            }
        }

        return categorias
            .Select(c => new EnvelopeResponse(c.ToString(), CategoriaInfo.Rotulo(c), Arred(planejadoMes[c]),
                Arred(gastoMes[c]), Arred(saldo[c]), meses))
            .OrderBy(e => e.SaldoAcumulado)
            .ToList();
    }

    // ------------------------------------------------------------ provisões anuais

    public async Task<ProvisoesResponse> ProvisoesAsync(string userId, CancellationToken ct)
    {
        var hoje = clock.Hoje();
        var lista = await db.ProvisoesAnuais.AsNoTracking().Where(x => x.UserId == userId)
            .OrderBy(x => x.MesVencimento).ToListAsync(ct);
        var itens = lista.Select(x => MontarProvisao(x, hoje)).OrderBy(x => x.ProximoVencimento).ToList();
        return new ProvisoesResponse(itens, Arred(lista.Sum(x => x.Valor) / 12m), lista.Sum(x => x.Valor));
    }

    public static ProvisaoResponse MontarProvisao(ProvisaoAnual x, DateOnly hoje)
    {
        // Próximo vencimento: o mês informado, neste ano ou no seguinte se já passou.
        var proximo = new DateOnly(hoje.Year, x.MesVencimento, 1);
        if (proximo < new DateOnly(hoje.Year, hoje.Month, 1)) proximo = proximo.AddYears(1);
        var mesesRestantes = Math.Max(1, (proximo.Year - hoje.Year) * 12 + proximo.Month - hoje.Month + 1);

        var mensal = Arred(x.Valor / 12m);
        // Se estivesse guardando 1/12 por mês desde o vencimento anterior.
        var esperado = Arred(x.Valor * Math.Clamp(12 - mesesRestantes + 1, 0, 12) / 12m);
        var falta = Math.Max(0, x.Valor - x.ValorReservado);
        var situacao = x.ValorReservado >= x.Valor ? "completa"
            : x.ValorReservado >= esperado ? "em-dia"
            : "atrasada";

        return new ProvisaoResponse(x.Id, x.Nome, x.Valor, x.MesVencimento, x.ValorReservado, mensal, proximo,
            mesesRestantes, Arred(falta / mesesRestantes), esperado, situacao);
    }

    // ------------------------------------------------------------ dívidas

    public static SimulacaoDividas SimularDividas(IReadOnlyList<Divida> dividas, decimal extra)
    {
        var pagamento = dividas.Sum(d => d.ParcelaMinima) + Math.Max(0, extra);
        var bola = Simular(dividas, pagamento, ds => ds.OrderBy(d => d.Saldo).ThenByDescending(d => d.Juros), "bola-de-neve");
        var avalanche = Simular(dividas, pagamento, ds => ds.OrderByDescending(d => d.Juros).ThenBy(d => d.Saldo), "avalanche");

        var economia = bola.JurosTotais - avalanche.JurosTotais;
        var recomendacao = !avalanche.Viavel
            ? "Com esse pagamento as dívidas não diminuem: os juros crescem mais rápido. Aumente o valor extra ou renegocie."
            : economia > 50
                ? $"A avalanche economiza R$ {CulturaBr.Dinheiro(economia)} em juros. A bola de neve quita a primeira dívida antes — escolha a que você vai conseguir manter."
                : "As duas estratégias dão resultado parecido; a bola de neve tende a motivar mais por quitar dívidas cedo.";

        return new SimulacaoDividas(pagamento, bola, avalanche, recomendacao);
    }

    private sealed class EmCurso(string nome, decimal saldo, decimal juros, decimal minima)
    {
        public string Nome { get; } = nome;
        public decimal Saldo { get; set; } = saldo;
        public decimal Juros { get; } = juros;
        public decimal Minima { get; } = minima;
    }

    private static EstrategiaQuitacao Simular(IReadOnlyList<Divida> dividas, decimal pagamento,
        Func<IEnumerable<EmCurso>, IEnumerable<EmCurso>> ordenar, string nome)
    {
        var abertas = dividas.Where(d => d.Saldo > 0)
            .Select(d => new EmCurso(d.Nome, d.Saldo, d.JurosMensal / 100m, d.ParcelaMinima)).ToList();
        var ordem = new List<PassoQuitacao>();
        decimal juros = 0, pago = 0;
        var mes = 0;

        while (abertas.Count > 0 && mes < 600)
        {
            mes++;
            foreach (var d in abertas)
            {
                var j = Math.Round(d.Saldo * d.Juros, 2);
                d.Saldo += j;
                juros += j;
            }

            // Mínimo em todas; o que sobra vai inteiro para a primeira da ordem.
            var disponivel = pagamento;
            foreach (var d in abertas)
            {
                var p = Math.Min(d.Minima, d.Saldo);
                d.Saldo -= p;
                disponivel -= p;
                pago += p;
            }
            foreach (var d in ordenar(abertas))
            {
                if (disponivel <= 0) break;
                var p = Math.Min(disponivel, d.Saldo);
                d.Saldo -= p;
                disponivel -= p;
                pago += p;
            }

            foreach (var d in abertas.Where(d => d.Saldo <= 0.005m).ToList())
            {
                ordem.Add(new PassoQuitacao(d.Nome, mes));
                abertas.Remove(d);
            }

            // Saldo total crescendo depois de um ano: não vai quitar nunca.
            if (mes == 12 && abertas.Sum(d => d.Saldo) >= dividas.Sum(d => d.Saldo)) break;
        }

        var viavel = abertas.Count == 0;
        return new EstrategiaQuitacao(nome, viavel, viavel ? mes : 0, Arred(juros), Arred(pago), ordem);
    }

    // ------------------------------------------------------------ fluxo de caixa

    /// <param name="cartoes">Cartões com dia de vencimento e fatura aberta (da AUVP), se houver.</param>
    public async Task<FluxoCaixaResponse> FluxoAsync(string userId, int dias, decimal saldoInicial, string origemSaldo,
        IReadOnlyList<(string Nome, int DiaVencimento, decimal FaturaAberta)> cartoes, CancellationToken ct)
    {
        var hoje = clock.Hoje();
        var fim = hoje.AddDays(dias);
        var eventos = new List<EventoFluxo>();

        // Cartão não sai da conta na compra, sai na fatura: compras no cartão de um
        // cartão conhecido viram a fatura do mês; as demais entram pela data.
        var nomesCartao = cartoes.Select(c => c.Nome).ToHashSet();
        bool EhDoCartao(Transacao t) => t.FormaPagamento == FormaPagamento.Cartao && t.Conta is not null
                                        && nomesCartao.Contains(t.Conta);

        var futuras = await db.Transacoes.AsNoTracking()
            .Where(t => t.UserId == userId && !t.ForaDosTotais && t.Data > hoje && t.Data <= fim)
            .ToListAsync(ct);
        foreach (var t in futuras.Where(t => !EhDoCartao(t)))
            eventos.Add(new EventoFluxo(t.Data, t.Descricao, t.Tipo == TipoTransacao.Receita ? t.Valor : -t.Valor,
                "lançamento"));

        // Faturas: a aberta no próximo vencimento; as seguintes pela soma das
        // parcelas já lançadas para aquele cartão naquele mês de competência.
        foreach (var (nome, dia, aberta) in cartoes)
        {
            var parcelas = await db.Transacoes.AsNoTracking()
                .Where(t => t.UserId == userId && !t.ForaDosTotais && t.Conta == nome
                            && t.Tipo == TipoTransacao.Despesa && t.Competencia > Transacao.CompetenciaDe(hoje))
                .GroupBy(t => t.Competencia)
                .Select(g => new { g.Key, Total = g.Sum(t => t.Valor) })
                .ToListAsync(ct);

            for (var i = 0; i < 4; i++)
            {
                var mesRef = new DateOnly(hoje.Year, hoje.Month, 1).AddMonths(i);
                var venc = new DateOnly(mesRef.Year, mesRef.Month, Math.Min(dia, DateTime.DaysInMonth(mesRef.Year, mesRef.Month)));
                if (venc <= hoje || venc > fim) continue;
                var valor = eventos.Any(e => e.Origem == "fatura" && e.Descricao.EndsWith(nome))
                    ? parcelas.FirstOrDefault(p => p.Key == Transacao.CompetenciaDe(venc))?.Total ?? 0
                    : aberta;
                if (valor > 0) eventos.Add(new EventoFluxo(venc, $"Fatura {nome}", -valor, "fatura"));
            }
        }

        // Recorrentes (salário, contas, assinaturas) projetados no dia de costume,
        // a menos que o mês já tenha um lançamento futuro da mesma origem.
        var historico = await db.Transacoes.AsNoTracking()
            .Where(t => t.UserId == userId && t.Competencia >= Transacao.CompetenciaDe(hoje).AddMonths(-5)
                        && t.Data <= hoje)
            .ToListAsync(ct);
        foreach (var r in Recorrencias.Detectar(historico.Where(t => !EhDoCartao(t))))
        {
            for (var i = 0; i <= dias / 28 + 1; i++)
            {
                var mesRef = new DateOnly(hoje.Year, hoje.Month, 1).AddMonths(i);
                var data = new DateOnly(mesRef.Year, mesRef.Month,
                    Math.Min(r.DiaHabitual, DateTime.DaysInMonth(mesRef.Year, mesRef.Month)));
                if (data <= hoje || data > fim) continue;
                // Já aconteceu este mês (ex.: conta paga antes do dia de costume).
                if (historico.Any(t => t.Competencia == mesRef && t.Tipo == r.Ultimo.Tipo
                                       && RegrasCategoria.ChaveDeDescricao(t.Descricao) == r.Chave)) continue;
                if (futuras.Any(t => Transacao.CompetenciaDe(t.Data) == mesRef
                                     && RegrasCategoria.ChaveDeDescricao(t.Descricao) == r.Chave)) continue;
                eventos.Add(new EventoFluxo(data, r.Ultimo.Descricao,
                    r.Ultimo.Tipo == TipoTransacao.Receita ? r.ValorMedio : -r.ValorMedio, "recorrente"));
            }
        }

        eventos = eventos.OrderBy(e => e.Data).ThenByDescending(e => e.Valor).ToList();

        var pontos = new List<PontoFluxo>();
        var saldo = saldoInicial;
        var menor = saldoInicial;
        var dataMenor = hoje;
        DateOnly? negativo = saldoInicial < 0 ? hoje : null;
        pontos.Add(new PontoFluxo(hoje, saldo));
        for (var d = hoje.AddDays(1); d <= fim; d = d.AddDays(1))
        {
            saldo += eventos.Where(e => e.Data == d).Sum(e => e.Valor);
            pontos.Add(new PontoFluxo(d, Arred(saldo)));
            if (saldo < menor) { menor = saldo; dataMenor = d; }
            if (saldo < 0 && negativo is null) negativo = d;
        }

        return new FluxoCaixaResponse(saldoInicial, origemSaldo, pontos, eventos, Arred(menor), dataMenor, negativo,
            Arred(saldo));
    }

    // ------------------------------------------------------------ fechamento (Kakeibo)

    public async Task<FechamentoResponse> FechamentoAsync(string userId, int ano, int mes, CancellationToken ct)
    {
        var competencia = new DateOnly(ano, mes, 1);
        var transacoes = await DoPeriodoAsync(userId, competencia.AddMonths(-1), competencia, ct);
        var doMes = transacoes.Where(t => t.Competencia == competencia).ToList();
        var anterior = transacoes.Where(t => t.Competencia != competencia).ToList();

        var receitas = doMes.Where(t => t.Tipo == TipoTransacao.Receita).Sum(t => t.Valor);
        var despesas = doMes.Where(t => t.Tipo == TipoTransacao.Despesa).Sum(t => t.Valor);

        var categorias = doMes.Concat(anterior).Where(t => t.Tipo == TipoTransacao.Despesa)
            .Select(t => t.Categoria).Distinct()
            .Select(c => new CategoriaVariacao(c.ToString(), CategoriaInfo.Rotulo(c),
                doMes.Where(t => t.Tipo == TipoTransacao.Despesa && t.Categoria == c).Sum(t => t.Valor),
                anterior.Where(t => t.Tipo == TipoTransacao.Despesa && t.Categoria == c).Sum(t => t.Valor)))
            .OrderByDescending(c => c.Valor)
            .ToList();

        var orcamento = await db.Orcamentos.AsNoTracking()
            .FirstOrDefaultAsync(o => o.UserId == userId && o.Ano == ano && o.Mes == mes, ct);
        var salvo = await db.FechamentosMes.AsNoTracking()
            .FirstOrDefaultAsync(f => f.UserId == userId && f.Ano == ano && f.Mes == mes, ct);

        return new FechamentoResponse(ano, mes, receitas, despesas, receitas - despesas,
            receitas > 0 ? Pct((receitas - despesas) / receitas) : null,
            orcamento is { ValorTotal: > 0 } ? Pct(despesas / orcamento.ValorTotal) : null,
            categorias, salvo?.MetaPoupanca, salvo?.Reflexao, salvo?.Compromisso, salvo?.AtualizadoEm);
    }

    // ------------------------------------------------------------ util

    private static decimal Arred(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
    private static decimal Pct(decimal fracao) => Math.Round(fracao * 100m, 1, MidpointRounding.AwayFromZero);
}
