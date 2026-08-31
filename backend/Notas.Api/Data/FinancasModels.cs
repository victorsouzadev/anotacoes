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
