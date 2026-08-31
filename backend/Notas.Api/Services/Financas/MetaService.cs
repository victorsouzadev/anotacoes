using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Dtos;

namespace Notas.Api.Services.Financas;

public class MetaInvalidaException : Exception
{
    public MetaInvalidaException(string message) : base(message) { }
}

// Regras das metas de reserva: validação, progresso e a comparação entre o ritmo
// de aportes que a meta exige e o que o usuário vem praticando.
public class MetaService
{
    private readonly AppDbContext _db;
    private readonly FinancasClock _clock;

    public MetaService(AppDbContext db, FinancasClock clock)
    {
        _db = db;
        _clock = clock;
    }

    // ---------------------------------------------------------------- leitura

    public async Task<List<MetaResponse>> ListarAsync(string userId, bool incluirArquivadas, CancellationToken ct = default)
    {
        var query = _db.MetasReserva.AsNoTracking().Include(m => m.Aportes).Where(m => m.UserId == userId);
        if (!incluirArquivadas) query = query.Where(m => m.ArquivadaEm == null);

        var metas = await query.OrderBy(m => m.ConcluidaEm != null).ThenBy(m => m.DataAlvo ?? DateOnly.MaxValue)
            .ThenByDescending(m => m.CriadoEm).ToListAsync(ct);

        return metas.Select(Montar).ToList();
    }

    public async Task<MetaResponse?> ObterAsync(string userId, Guid id, CancellationToken ct = default)
    {
        var meta = await _db.MetasReserva.AsNoTracking().Include(m => m.Aportes)
            .FirstOrDefaultAsync(m => m.Id == id && m.UserId == userId, ct);
        return meta is null ? null : Montar(meta);
    }

    // Transações de investimento do usuário que ainda não viraram aporte de
    // nenhuma meta — o atalho para não redigitar o que já foi lançado.
    public async Task<List<InvestimentoDisponivelResponse>> InvestimentosDisponiveisAsync(
        string userId, CancellationToken ct = default)
    {
        var vinculadas = await _db.MetaAportes.AsNoTracking()
            .Where(a => a.TransacaoId != null)
            .Select(a => a.TransacaoId!.Value)
            .ToListAsync(ct);

        var investimentos = await _db.Transacoes.AsNoTracking()
            .Where(t => t.UserId == userId
                        && t.Categoria == Categoria.Investimentos
                        && t.Tipo == TipoTransacao.Despesa
                        && !vinculadas.Contains(t.Id))
            .OrderByDescending(t => t.Data)
            .Take(50)
            .ToListAsync(ct);

        return investimentos
            .Select(t => new InvestimentoDisponivelResponse(t.Id, t.Descricao, t.Valor, t.Data))
            .ToList();
    }

    // ---------------------------------------------------------------- escrita

    public async Task<MetaResponse> CriarAsync(string userId, SalvarMetaRequest req, CancellationToken ct = default)
    {
        Validar(req);

        var meta = new MetaReserva
        {
            UserId = userId,
            Nome = req.Nome.Trim(),
            ValorAlvo = Math.Round(req.ValorAlvo, 2, MidpointRounding.AwayFromZero),
            DataAlvo = req.DataAlvo,
            Observacoes = Normalizar(req.Observacoes),
        };

        _db.MetasReserva.Add(meta);
        await _db.SaveChangesAsync(ct);
        return Montar(meta);
    }

    public async Task<MetaResponse?> AtualizarAsync(string userId, Guid id, SalvarMetaRequest req, CancellationToken ct = default)
    {
        Validar(req);

        var meta = await _db.MetasReserva.Include(m => m.Aportes)
            .FirstOrDefaultAsync(m => m.Id == id && m.UserId == userId, ct);
        if (meta is null) return null;

        meta.Nome = req.Nome.Trim();
        meta.ValorAlvo = Math.Round(req.ValorAlvo, 2, MidpointRounding.AwayFromZero);
        meta.DataAlvo = req.DataAlvo;
        meta.Observacoes = Normalizar(req.Observacoes);

        // Baixar o alvo pode fechar a meta na hora; subir pode reabri-la.
        AtualizarConclusao(meta);

        await _db.SaveChangesAsync(ct);
        return Montar(meta);
    }

    public async Task<bool> RemoverAsync(string userId, Guid id, CancellationToken ct = default)
    {
        var meta = await _db.MetasReserva.FirstOrDefaultAsync(m => m.Id == id && m.UserId == userId, ct);
        if (meta is null) return false;

        _db.MetasReserva.Remove(meta);
        await _db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<MetaResponse?> ArquivarAsync(string userId, Guid id, bool arquivar, CancellationToken ct = default)
    {
        var meta = await _db.MetasReserva.Include(m => m.Aportes)
            .FirstOrDefaultAsync(m => m.Id == id && m.UserId == userId, ct);
        if (meta is null) return null;

        meta.ArquivadaEm = arquivar ? DateTime.UtcNow : null;
        await _db.SaveChangesAsync(ct);
        return Montar(meta);
    }

    public async Task<MetaResponse?> AdicionarAporteAsync(
        string userId, Guid metaId, CriarAporteRequest req, CancellationToken ct = default)
    {
        var meta = await _db.MetasReserva.Include(m => m.Aportes)
            .FirstOrDefaultAsync(m => m.Id == metaId && m.UserId == userId, ct);
        if (meta is null) return null;

        decimal valor;
        DateOnly data;

        if (req.TransacaoId is { } transacaoId)
        {
            var transacao = await _db.Transacoes.AsNoTracking()
                .FirstOrDefaultAsync(t => t.Id == transacaoId && t.UserId == userId, ct)
                ?? throw new MetaInvalidaException("Lançamento não encontrado.");

            if (transacao.Categoria != Categoria.Investimentos)
            {
                throw new MetaInvalidaException(
                    "Só lançamentos da categoria Investimentos podem ser vinculados a uma meta.");
            }

            // Sem esta checagem o mesmo dinheiro contaria em duas metas e a soma
            // dos progressos passaria do que foi realmente guardado.
            var jaVinculada = await _db.MetaAportes.AsNoTracking().AnyAsync(a => a.TransacaoId == transacaoId, ct);
            if (jaVinculada)
            {
                throw new MetaInvalidaException("Esse lançamento já foi vinculado a uma meta.");
            }

            valor = transacao.Valor;
            data = transacao.Data;
        }
        else
        {
            if (req.Valor is not { } informado || informado <= 0)
            {
                throw new MetaInvalidaException("Informe um valor maior que zero para o aporte.");
            }
            if (informado > 99_999_999m)
            {
                throw new MetaInvalidaException("Valor acima do limite suportado.");
            }

            valor = Math.Round(informado, 2, MidpointRounding.AwayFromZero);
            data = req.Data ?? _clock.Hoje();
        }

        var aporte = new MetaAporte
        {
            MetaId = meta.Id,
            Valor = valor,
            Data = data,
            Observacoes = Normalizar(req.Observacoes),
            TransacaoId = req.TransacaoId,
        };

        // Add pelo DbSet, e não pela navegação: a entidade já nasce com Id
        // preenchido, e anexá-la ao pai rastreado faria o EF classificá-la como
        // Modified e emitir UPDATE para uma linha inexistente. O próprio EF cuida
        // de refletir o novo aporte em meta.Aportes — adicionar aos dois lugares
        // deixaria o item duplicado na coleção e dobraria o total.
        _db.MetaAportes.Add(aporte);

        AtualizarConclusao(meta);
        await _db.SaveChangesAsync(ct);
        return Montar(meta);
    }

    public async Task<MetaResponse?> RemoverAporteAsync(string userId, Guid metaId, Guid aporteId, CancellationToken ct = default)
    {
        var meta = await _db.MetasReserva.Include(m => m.Aportes)
            .FirstOrDefaultAsync(m => m.Id == metaId && m.UserId == userId, ct);
        if (meta is null) return null;

        var aporte = meta.Aportes.FirstOrDefault(a => a.Id == aporteId);
        if (aporte is null) return null;

        _db.MetaAportes.Remove(aporte);
        meta.Aportes.Remove(aporte);

        AtualizarConclusao(meta);
        await _db.SaveChangesAsync(ct);
        return Montar(meta);
    }

    // ------------------------------------------------------------- progresso

    private static void AtualizarConclusao(MetaReserva meta)
    {
        var acumulado = meta.Aportes.Sum(a => a.Valor);
        var atingiu = acumulado >= meta.ValorAlvo;

        // A data de conclusão é preservada quando a meta continua batida, para o
        // histórico não mudar a cada aporte extra.
        if (atingiu && meta.ConcluidaEm is null) meta.ConcluidaEm = DateTime.UtcNow;
        else if (!atingiu) meta.ConcluidaEm = null;
    }

    private MetaResponse Montar(MetaReserva meta)
    {
        var hoje = _clock.Hoje();
        var acumulado = meta.Aportes.Sum(a => a.Valor);
        var restante = Math.Round(Math.Max(meta.ValorAlvo - acumulado, 0), 2, MidpointRounding.AwayFromZero);
        var percentual = meta.ValorAlvo <= 0 ? 0m
            : Math.Round(Math.Min(acumulado / meta.ValorAlvo * 100, 999), 2, MidpointRounding.AwayFromZero);

        var concluida = acumulado >= meta.ValorAlvo;
        var ritmo = RitmoMensal(meta, hoje);

        int? mesesRestantes = null;
        decimal? aporteMensal = null;

        if (meta.DataAlvo is { } alvo && !concluida)
        {
            // Meses "cheios" restantes, contando o mês corrente: uma meta para o fim
            // deste mês ainda tem um mês para receber aporte, não zero.
            var meses = (alvo.Year - hoje.Year) * 12 + alvo.Month - hoje.Month + 1;
            mesesRestantes = Math.Max(meses, 0);
            if (mesesRestantes > 0)
            {
                aporteMensal = Math.Round(restante / mesesRestantes.Value, 2, MidpointRounding.AwayFromZero);
            }
        }

        var situacao = concluida ? "concluida"
            : meta.DataAlvo is null ? "sem_prazo"
            : meta.DataAlvo < hoje ? "vencida"
            : aporteMensal is { } exigido && ritmo + 0.01m < exigido ? "atrasada"
            : "no_ritmo";

        DateOnly? previsao = null;
        if (!concluida && ritmo > 0)
        {
            var mesesAteFechar = (int)Math.Ceiling(restante / ritmo);
            // Um ritmo baixíssimo daria uma previsão de séculos, que não informa nada.
            if (mesesAteFechar <= 600) previsao = hoje.AddMonths(mesesAteFechar);
        }

        return new MetaResponse(
            meta.Id, meta.Nome, meta.ValorAlvo, meta.DataAlvo, meta.Observacoes,
            acumulado, restante, percentual,
            concluida, meta.ArquivadaEm is not null,
            aporteMensal, mesesRestantes, ritmo, situacao, previsao,
            meta.Aportes.OrderByDescending(a => a.Data).ThenByDescending(a => a.CriadoEm)
                .Select(a => new AporteResponse(a.Id, a.Valor, a.Data, a.Observacoes, a.TransacaoId, a.CriadoEm))
                .ToList(),
            meta.CriadoEm);
    }

    // Média mensal dos aportes desde o primeiro deles. Usar a data do primeiro
    // aporte, e não a criação da meta, evita punir quem cadastrou a meta com
    // meses de antecedência.
    private static decimal RitmoMensal(MetaReserva meta, DateOnly hoje)
    {
        if (meta.Aportes.Count == 0) return 0m;

        var primeiro = meta.Aportes.Min(a => a.Data);
        var meses = Math.Max((hoje.Year - primeiro.Year) * 12 + hoje.Month - primeiro.Month + 1, 1);
        return Math.Round(meta.Aportes.Sum(a => a.Valor) / meses, 2, MidpointRounding.AwayFromZero);
    }

    // -------------------------------------------------------------- validação

    private void Validar(SalvarMetaRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Nome))
        {
            throw new MetaInvalidaException("Dê um nome à meta.");
        }
        if (req.Nome.Trim().Length > 120)
        {
            throw new MetaInvalidaException("O nome da meta passa de 120 caracteres.");
        }
        if (req.ValorAlvo <= 0)
        {
            throw new MetaInvalidaException("O valor da meta deve ser maior que zero.");
        }
        if (req.ValorAlvo > 99_999_999m)
        {
            throw new MetaInvalidaException("Valor acima do limite suportado.");
        }
        if (req.DataAlvo is { } alvo && alvo > _clock.Hoje().AddYears(50))
        {
            throw new MetaInvalidaException("A data da meta está longe demais.");
        }
    }

    private static string? Normalizar(string? valor) =>
        string.IsNullOrWhiteSpace(valor) ? null : valor.Trim();
}
