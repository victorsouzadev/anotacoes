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

    /// <summary>
    /// De onde veio o lançamento quando não foi digitado aqui ("auvp"). Junto com
    /// <see cref="IdExterno"/> identifica a transação na origem, para uma nova
    /// sincronização não duplicar o que já foi importado.
    /// </summary>
    public string? OrigemExterna { get; set; }
    public string? IdExterno { get; set; }

    /// <summary>
    /// Fica na lista, mas não soma em saldo, gráficos nem orçamento: transferência
    /// entre contas do próprio usuário, ou algo que ele marcou como "não é gasto".
    /// </summary>
    public bool ForaDosTotais { get; set; }

    /// <summary>
    /// Mês em que o lançamento conta (sempre dia 1). Para quase tudo é o mês da
    /// data; numa compra no cartão é o mês da fatura, que o banco informa — é por
    /// ele que o painel da AUVP soma, e é por ele que os totais daqui somam.
    /// Preenchido sozinho a partir da data quando não informado (ver AppDbContext).
    /// </summary>
    public DateOnly Competencia { get; set; }

    /// <summary>
    /// O usuário escolheu a categoria (mesmo que tenha sido "Outros"). Sem isso,
    /// um lançamento em Outros é tratado como "ainda não categorizado".
    /// </summary>
    public bool CategoriaConfirmada { get; set; }

    /// <summary>Compra parcelada: "3/10" vira Parcela 3, TotalParcelas 10.</summary>
    public int? Parcela { get; set; }
    public int? TotalParcelas { get; set; }

    /// <summary>Conta ou cartão de origem, quando importado do banco.</summary>
    public string? Conta { get; set; }

    /// <summary>Tags do usuário (na AUVP), separadas por "|".</summary>
    public string? Tags { get; set; }

    /// <summary>Chave do orçamento da AUVP (CUSTOS_FIXOS, CONFORTO…), quando houver.</summary>
    public string? OrcamentoAuvp { get; set; }

    public IReadOnlyList<string> ListaDeTags() =>
        string.IsNullOrEmpty(Tags) ? [] : Tags.Split('|', StringSplitOptions.RemoveEmptyEntries);

    public static DateOnly CompetenciaDe(DateOnly data) => new(data.Year, data.Month, 1);
}

// Lançamento importado que o usuário excluiu: a próxima sincronização não o traz
// de volta. Só a identificação na origem fica guardada.
public class TransacaoExcluida
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = "";
    public string Origem { get; set; } = "";
    public string IdExterno { get; set; } = "";
    public DateTime ExcluidaEm { get; set; } = DateTime.UtcNow;
}

// "Tudo que tiver essa cara é dessa categoria": aprendida quando o usuário corrige
// a categoria de um lançamento, aplicada aos que entram depois.
public class RegraCategoria
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = "";

    /// <summary>Descrição normalizada (ver ChaveDeDescricao).</summary>
    public string Chave { get; set; } = "";
    public Categoria Categoria { get; set; }
    public DateTime AtualizadaEm { get; set; } = DateTime.UtcNow;
}

// Conexão com a API da AUVP Financeiro (open banking): a chave do usuário, cifrada
// como as de IA, e quando foi a última sincronização. Uma linha por usuário.
public class ConfiguracaoAuvp
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = "";

    public string? ChaveCifrada { get; set; }

    /// <summary>Últimos caracteres da chave, em claro, só para exibição mascarada.</summary>
    public string? ChaveSufixo { get; set; }

    public DateTime? UltimaSincronizacaoEm { get; set; }
    public DateTime AtualizadoEm { get; set; } = DateTime.UtcNow;
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
