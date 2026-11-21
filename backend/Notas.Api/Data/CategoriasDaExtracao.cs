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

