using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Dtos;

namespace Notas.Api.Services.Financas;

// Entrada inválida vinda do cliente ao salvar um orçamento — vira 400.
public class OrcamentoInvalidoException : Exception
{
    public OrcamentoInvalidoException(string message) : base(message) { }
}

// Regras da ferramenta de orçamento: validação da distribuição, conversão de
// percentual em reais e cruzamento com o que já foi gasto no mês.
public class OrcamentoService
{
    // Percentuais são comparados com folga porque vêm de sliders e arredondamentos
    // no cliente; 0,01 ponto percentual é ruído, não erro do usuário.
    private const decimal ToleranciaPercentual = 0.01m;

    private readonly AppDbContext _db;
    private readonly FinancasClock _clock;

    public OrcamentoService(AppDbContext db, FinancasClock clock)
    {
        _db = db;
        _clock = clock;
    }

    // ---------------------------------------------------------------- leitura

    public async Task<Orcamento?> ObterAsync(string userId, int ano, int mes, CancellationToken ct = default)
    {
        ValidarCompetencia(ano, mes);
        return await _db.Orcamentos.AsNoTracking()
            .Include(o => o.Itens)
            .FirstOrDefaultAsync(o => o.UserId == userId && o.Ano == ano && o.Mes == mes, ct);
    }

    public async Task<List<Orcamento>> ListarAsync(string userId, CancellationToken ct = default) =>
        await _db.Orcamentos.AsNoTracking()
            .Include(o => o.Itens)
            .OrderByDescending(o => o.Ano).ThenByDescending(o => o.Mes)
            .ToListAsync(ct);

    // ---------------------------------------------------------------- escrita

    // Cria ou substitui integralmente o orçamento do mês. Substituir os itens em
    // bloco (em vez de fazer diff) mantém o estado sempre coerente com o que o
    // usuário vê na tela de distribuição.
    public async Task<Orcamento> SalvarAsync(string userId, SalvarOrcamentoRequest req, CancellationToken ct = default)
    {
        ValidarCompetencia(req.Ano, req.Mes);
        var itens = ValidarDistribuicao(req.ValorTotal, req.Itens);

        // Os itens antigos são apagados direto no banco, sem passar pelo rastreador:
        // carregá-los via Include e removê-los da coleção faz o EF tentar apenas
        // desassociar as linhas, e a gravação falha contra a FK obrigatória.
        // A transação garante que não sobre um orçamento sem distribuição caso a
        // segunda etapa falhe.
        await using var tx = await _db.Database.BeginTransactionAsync(ct);

        var orcamento = await _db.Orcamentos
            .FirstOrDefaultAsync(o => o.UserId == userId && o.Ano == req.Ano && o.Mes == req.Mes, ct);

        if (orcamento is null)
        {
            orcamento = new Orcamento
            {
                UserId = userId,
                Ano = req.Ano,
                Mes = req.Mes,
                CriadoEm = DateTime.UtcNow,
            };
            _db.Orcamentos.Add(orcamento);
        }
        else
        {
            await _db.OrcamentoItens.Where(i => i.OrcamentoId == orcamento.Id).ExecuteDeleteAsync(ct);
        }

        orcamento.ValorTotal = Math.Round(req.ValorTotal, 2, MidpointRounding.AwayFromZero);
        orcamento.Observacoes = string.IsNullOrWhiteSpace(req.Observacoes) ? null : req.Observacoes.Trim();
        orcamento.AtualizadoEm = DateTime.UtcNow;
        var novos = itens.Select(i => new OrcamentoItem
        {
            OrcamentoId = orcamento.Id,
            Categoria = i.Categoria,
            Percentual = i.Percentual,
        }).ToList();

        // AddRange explícito: como a entidade já nasce com Id preenchido, anexá-la
        // apenas pela navegação de um pai já rastreado faz o EF classificá-la como
        // Modified e emitir um UPDATE para uma linha que ainda não existe.
        _db.OrcamentoItens.AddRange(novos);
        orcamento.Itens = novos;

        await _db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return orcamento;
    }

    public async Task<bool> RemoverAsync(string userId, int ano, int mes, CancellationToken ct = default)
    {
        ValidarCompetencia(ano, mes);
        var orcamento = await _db.Orcamentos.Include(o => o.Itens)
            .FirstOrDefaultAsync(o => o.UserId == userId && o.Ano == ano && o.Mes == mes, ct);
        if (orcamento is null) return false;

        _db.Orcamentos.Remove(orcamento);
        await _db.SaveChangesAsync(ct);
        return true;
    }

    // Copiar a distribuição de um mês para outro é o caminho comum: quase ninguém
    // redesenha o orçamento do zero todo mês.
    public async Task<Orcamento> CopiarAsync(string userId, CopiarOrcamentoRequest req, CancellationToken ct = default)
    {
        ValidarCompetencia(req.AnoOrigem, req.MesOrigem);
        ValidarCompetencia(req.AnoDestino, req.MesDestino);

        if (req.AnoOrigem == req.AnoDestino && req.MesOrigem == req.MesDestino)
        {
            throw new OrcamentoInvalidoException("O mês de origem e o de destino são o mesmo.");
        }

        var origem = await ObterAsync(userId, req.AnoOrigem, req.MesOrigem, ct)
            ?? throw new OrcamentoInvalidoException($"Não há orçamento em {req.MesOrigem:D2}/{req.AnoOrigem} para copiar.");

        return await SalvarAsync(userId, new SalvarOrcamentoRequest(
            req.AnoDestino,
            req.MesDestino,
            req.ValorTotal ?? origem.ValorTotal,
            origem.Itens.Select(i => new OrcamentoItemRequest(i.Categoria, i.Percentual)).ToList(),
            origem.Observacoes), ct);
    }

    // ---------------------------------------------------------------- histórico

    // Evolução dos últimos meses: quanto foi planejado e quanto saiu de fato.
    // Meses sem orçamento entram assim mesmo, com o realizado, senão a série teria
    // buracos justamente onde o usuário não se planejou.
    public async Task<List<HistoricoMesResponse>> HistoricoAsync(
        string userId, int meses, CancellationToken ct = default)
    {
        var quantidade = Math.Clamp(meses, 1, 36);
        var hoje = _clock.Hoje();
        var primeiroMes = new DateOnly(hoje.Year, hoje.Month, 1).AddMonths(-(quantidade - 1));
        var (_, ultimoDia) = FinancasClock.LimitesDoMes(hoje.Year, hoje.Month);

        var orcamentos = await _db.Orcamentos.AsNoTracking()
            .Include(o => o.Itens)
            .Where(o => o.UserId == userId)
            .ToListAsync(ct);

        var despesas = await _db.Transacoes.AsNoTracking()
            .Where(t => t.UserId == userId && t.Tipo == TipoTransacao.Despesa
                        && t.Data >= primeiroMes && t.Data <= ultimoDia)
            .ToListAsync(ct);

        var realizadoPorMes = despesas
            .GroupBy(t => (t.Data.Year, t.Data.Month))
            .ToDictionary(g => g.Key, g => g.Sum(t => t.Valor));

        var resultado = new List<HistoricoMesResponse>(quantidade);
        for (var i = 0; i < quantidade; i++)
        {
            var mes = primeiroMes.AddMonths(i);
            var orcamento = orcamentos.FirstOrDefault(o => o.Ano == mes.Year && o.Mes == mes.Month);
            var realizado = realizadoPorMes.GetValueOrDefault((mes.Year, mes.Month));
            var total = orcamento?.ValorTotal ?? 0m;
            var utilizado = Percentual(realizado, total);

            var situacao = orcamento is null ? "sem_orcamento"
                : realizado > total ? "estourado"
                : utilizado >= 80m ? "atencao"
                : "ok";

            resultado.Add(new HistoricoMesResponse(
                mes.Year, mes.Month,
                mes.ToString("MMM/yy", System.Globalization.CultureInfo.GetCultureInfo("pt-BR")),
                orcamento is not null, total, realizado, utilizado, situacao));
        }

        return resultado;
    }

    // ------------------------------------------------------------ acompanhamento

    public async Task<AcompanhamentoResponse> AcompanharAsync(string userId, int ano, int mes, CancellationToken ct = default)
    {
        ValidarCompetencia(ano, mes);

        var orcamento = await ObterAsync(userId, ano, mes, ct);
        var (inicio, fim) = FinancasClock.LimitesDoMes(ano, mes);

        var despesas = await _db.Transacoes.AsNoTracking()
            .Where(t => t.UserId == userId && t.Tipo == TipoTransacao.Despesa && t.Data >= inicio && t.Data <= fim)
            .ToListAsync(ct);

        var realizadoPorCategoria = despesas
            .GroupBy(t => t.Categoria)
            .ToDictionary(g => g.Key, g => g.Sum(t => t.Valor));

        var valorTotal = orcamento?.ValorTotal ?? 0m;
        var itensOrcamento = orcamento?.Itens.OrderByDescending(i => i.Percentual).ToList() ?? new List<OrcamentoItem>();
        var planejados = Distribuir(valorTotal, itensOrcamento.Select(i => i.Percentual).ToList());

        var itens = new List<AcompanhamentoItemResponse>();
        for (var i = 0; i < itensOrcamento.Count; i++)
        {
            var item = itensOrcamento[i];
            var realizado = realizadoPorCategoria.GetValueOrDefault(item.Categoria);
            itens.Add(MontarItem(item.Categoria, item.Percentual, planejados[i], realizado));
        }

        // Gastos em categorias fora do orçamento também precisam aparecer, senão o
        // total realizado da tela não bate com o extrato.
        foreach (var (categoria, realizado) in realizadoPorCategoria)
        {
            if (itensOrcamento.Any(i => i.Categoria == categoria)) continue;
            itens.Add(MontarItem(categoria, 0m, 0m, realizado));
        }

        var totalPlanejado = planejados.Sum();
        var totalRealizado = realizadoPorCategoria.Values.Sum();

        var grupos = itens
            .GroupBy(i => i.Grupo)
            .Select(g => new AcompanhamentoGrupoResponse(
                g.Key,
                RotuloGrupo(g.Key),
                Percentual(g.Sum(i => i.ValorPlanejado), valorTotal),
                g.Sum(i => i.ValorPlanejado),
                g.Sum(i => i.ValorRealizado)))
            .OrderByDescending(g => g.ValorPlanejado)
            .ToList();

        var decorrido = PercentualDoMesDecorrido(ano, mes);
        var projecao = decorrido > 0
            ? Math.Round(totalRealizado / decorrido * 100m, 2, MidpointRounding.AwayFromZero)
            : 0m;

        return new AcompanhamentoResponse(
            ano, mes,
            orcamento is not null,
            valorTotal,
            totalPlanejado,
            totalRealizado,
            Math.Round(valorTotal - totalRealizado, 2, MidpointRounding.AwayFromZero),
            Percentual(totalRealizado, valorTotal),
            decorrido,
            projecao,
            itens.OrderByDescending(i => i.ValorPlanejado).ThenByDescending(i => i.ValorRealizado).ToList(),
            grupos);
    }

    private static AcompanhamentoItemResponse MontarItem(Categoria categoria, decimal percentual, decimal planejado, decimal realizado)
    {
        var utilizado = Percentual(realizado, planejado);
        var situacao = planejado <= 0 ? "sem_orcamento"
            : realizado > planejado ? "estourado"
            : utilizado >= 80m ? "atencao"
            : "ok";

        return new AcompanhamentoItemResponse(
            categoria.ToString(),
            CategoriaInfo.Rotulo(categoria),
            CategoriaInfo.Grupo(categoria).ToString(),
            percentual,
            planejado,
            realizado,
            Math.Round(planejado - realizado, 2, MidpointRounding.AwayFromZero),
            utilizado,
            situacao);
    }

    // Quanto do mês já passou, para comparar o ritmo de gasto com o do calendário.
    // Meses passados contam como 100%, futuros como 0%.
    private decimal PercentualDoMesDecorrido(int ano, int mes)
    {
        var hoje = _clock.Hoje();
        var (inicio, fim) = FinancasClock.LimitesDoMes(ano, mes);

        if (hoje > fim) return 100m;
        if (hoje < inicio) return 0m;

        return Math.Round((decimal)hoje.Day / DateTime.DaysInMonth(ano, mes) * 100m, 2, MidpointRounding.AwayFromZero);
    }

    private static decimal Percentual(decimal parte, decimal total) =>
        total <= 0 ? 0m : Math.Round(parte / total * 100m, 2, MidpointRounding.AwayFromZero);

    public static string RotuloGrupo(string grupo) => grupo switch
    {
        nameof(GrupoCategoria.Essenciais) => "Essenciais",
        nameof(GrupoCategoria.EstiloDeVida) => "Estilo de vida",
        nameof(GrupoCategoria.Futuro) => "Futuro",
        nameof(GrupoCategoria.Receita) => "Receita",
        _ => grupo,
    };

    // ------------------------------------------------------------- distribuição

    // Converte percentuais em reais garantindo que a soma feche exatamente com o
    // valor total. Arredondar cada fatia isoladamente sobraria ou faltaria alguns
    // centavos; aqui o resto é distribuído para as fatias com maior parte fracionária
    // (método do maior resto), que é o mesmo critério usado em rateio eleitoral.
    public static List<decimal> Distribuir(decimal total, IReadOnlyList<decimal> percentuais)
    {
        var n = percentuais.Count;
        if (n == 0) return new List<decimal>();
        if (total <= 0) return Enumerable.Repeat(0m, n).ToList();

        var exatos = percentuais.Select(p => total * p / 100m).ToList();
        var valores = exatos.Select(v => Math.Floor(v * 100m) / 100m).ToList();

        var centavosRestantes = (int)Math.Round((total - valores.Sum()) * 100m, MidpointRounding.AwayFromZero);
        if (centavosRestantes <= 0) return valores;

        var ordem = Enumerable.Range(0, n)
            .OrderByDescending(i => exatos[i] - valores[i])
            .ThenByDescending(i => exatos[i])
            .ToList();

        for (var k = 0; k < centavosRestantes && k < n; k++)
        {
            valores[ordem[k]] += 0.01m;
        }

        return valores;
    }

    // --------------------------------------------------------------- validação

    private static void ValidarCompetencia(int ano, int mes)
    {
        if (mes is < 1 or > 12)
        {
            throw new OrcamentoInvalidoException($"Mês inválido: {mes}. Esperado entre 1 e 12.");
        }
        if (ano is < 2000 or > 2100)
        {
            throw new OrcamentoInvalidoException($"Ano inválido: {ano}.");
        }
    }

    private static List<OrcamentoItemRequest> ValidarDistribuicao(decimal valorTotal, List<OrcamentoItemRequest>? itens)
    {
        if (valorTotal <= 0)
        {
            throw new OrcamentoInvalidoException("O valor total do orçamento deve ser maior que zero.");
        }
        if (valorTotal > 99_999_999m)
        {
            throw new OrcamentoInvalidoException("Valor total acima do limite suportado.");
        }
        if (itens is null || itens.Count == 0)
        {
            throw new OrcamentoInvalidoException("Informe ao menos uma categoria na distribuição.");
        }

        var normalizados = new List<OrcamentoItemRequest>(itens.Count);
        var vistas = new HashSet<Categoria>();

        foreach (var item in itens)
        {
            if (!Enum.IsDefined(item.Categoria))
            {
                throw new OrcamentoInvalidoException($"Categoria inválida: '{item.Categoria}'.");
            }
            if (!CategoriaInfo.EhOrcavel(item.Categoria))
            {
                throw new OrcamentoInvalidoException(
                    $"A categoria '{CategoriaInfo.Rotulo(item.Categoria)}' é de receita e não entra na distribuição de gastos.");
            }
            if (!vistas.Add(item.Categoria))
            {
                throw new OrcamentoInvalidoException(
                    $"A categoria '{CategoriaInfo.Rotulo(item.Categoria)}' aparece mais de uma vez na distribuição.");
            }

            var percentual = Math.Round(item.Percentual, 4, MidpointRounding.AwayFromZero);
            if (percentual <= 0)
            {
                throw new OrcamentoInvalidoException(
                    $"O percentual de '{CategoriaInfo.Rotulo(item.Categoria)}' deve ser maior que zero. Para não orçar a categoria, remova-a da lista.");
            }
            if (percentual > 100)
            {
                throw new OrcamentoInvalidoException(
                    $"O percentual de '{CategoriaInfo.Rotulo(item.Categoria)}' não pode passar de 100%.");
            }

            normalizados.Add(item with { Percentual = percentual });
        }

        var soma = normalizados.Sum(i => i.Percentual);
        if (Math.Abs(soma - 100m) > ToleranciaPercentual)
        {
            var diferenca = Math.Round(100m - soma, 2);
            var comoTexto = diferenca > 0 ? $"faltam {diferenca}%" : $"sobram {Math.Abs(diferenca)}%";
            throw new OrcamentoInvalidoException(
                $"A distribuição precisa somar 100% — atualmente soma {Math.Round(soma, 2)}% ({comoTexto}).");
        }

        return normalizados;
    }
}
