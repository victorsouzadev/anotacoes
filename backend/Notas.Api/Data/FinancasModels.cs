namespace Notas.Api.Data;

public enum TipoTransacao
{
    Receita,
    Despesa
}

public enum Categoria
{
    Alimentacao,
    Transporte,
    Moradia,
    Saude,
    Educacao,
    Lazer,
    Compras,
    ContasServicos,
    Salario,
    Investimentos,
    Outros
}

public enum FormaPagamento
{
    Cartao,
    Pix,
    Dinheiro,
    Boleto
}

public enum StatusTransacao
{
    Confirmado,
    PendenteRevisao
}

public class Transacao
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = "";

    public string Descricao { get; set; } = "";
    public decimal Valor { get; set; }
    public TipoTransacao Tipo { get; set; }
    public Categoria Categoria { get; set; }
    public DateOnly Data { get; set; }
    public FormaPagamento? FormaPagamento { get; set; }
    public string TextoOriginal { get; set; } = "";
    public float ConfiancaIa { get; set; }
    public StatusTransacao Status { get; set; }
    public string? Observacoes { get; set; }
    public DateTime CriadoEm { get; set; } = DateTime.UtcNow;
}

// Orçamento mensal: um valor total que o usuário distribui entre categorias.
// Há no máximo um orçamento por (usuário, ano, mês).
public class Orcamento
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = "";

    public int Ano { get; set; }
    public int Mes { get; set; }

    // Valor total a distribuir no mês (normalmente a renda prevista).
    public decimal ValorTotal { get; set; }

    public string? Observacoes { get; set; }

    public DateTime CriadoEm { get; set; } = DateTime.UtcNow;
    public DateTime AtualizadoEm { get; set; } = DateTime.UtcNow;

    public List<OrcamentoItem> Itens { get; set; } = new();
}

// Fatia do orçamento destinada a uma categoria.
//
// O percentual é a fonte da verdade, não o valor: assim, ao mudar o valor total do
// mês (ex.: mudou o salário), a distribuição inteira reescala sozinha e continua
// somando 100%. O valor em reais é sempre derivado na leitura.
public class OrcamentoItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrcamentoId { get; set; }

    public Categoria Categoria { get; set; }
    public decimal Percentual { get; set; }
}

// Meta de reserva: "juntar R$ 10.000 até dezembro". O progresso vem de aportes
// explícitos, e não da soma de tudo que foi para a categoria Investimentos —
// com mais de uma meta ativa essa soma seria contada duas vezes.
public class MetaReserva
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = "";

    public string Nome { get; set; } = "";
    public decimal ValorAlvo { get; set; }

    /// <summary>Prazo opcional. Sem ele a meta não tem ritmo exigido, só progresso.</summary>
    public DateOnly? DataAlvo { get; set; }

    public string? Observacoes { get; set; }

    public DateTime CriadoEm { get; set; } = DateTime.UtcNow;
    public DateTime? ConcluidaEm { get; set; }
    public DateTime? ArquivadaEm { get; set; }

    public List<MetaAporte> Aportes { get; set; } = new();
}

// Um depósito na meta. Pode ser avulso ou vinculado a uma transação de
// investimento já lançada — o vínculo é único, para o mesmo dinheiro não ser
// contado em duas metas.
public class MetaAporte
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MetaId { get; set; }

    public decimal Valor { get; set; }
    public DateOnly Data { get; set; }
    public string? Observacoes { get; set; }

    public Guid? TransacaoId { get; set; }

    public DateTime CriadoEm { get; set; } = DateTime.UtcNow;
}
