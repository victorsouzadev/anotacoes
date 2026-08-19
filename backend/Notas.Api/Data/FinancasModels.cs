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
