namespace Notas.Api.Data;

// Ferramenta "Ações": as compras e vendas de ações/FIIs da B3. A carteira (quantidade,
// preço médio, resultado) é calculada a partir delas; a cotação vem da brapi.dev.

/// <summary>Uma compra ou venda de um ativo.</summary>
public class AcaoOperacao
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = "";
    /// <summary>Código na B3, em maiúsculas (PETR4, MXRF11).</summary>
    public string Ticker { get; set; } = "";
    /// <summary>"compra" ou "venda".</summary>
    public string Tipo { get; set; } = "compra";
    public decimal Quantidade { get; set; }
    public decimal PrecoUnitario { get; set; }
    /// <summary>Corretagem e taxas da operação; entram no custo da compra e saem do valor da venda.</summary>
    public decimal Taxas { get; set; }
    public DateOnly Data { get; set; }
    public string? Observacoes { get; set; }
    public DateTime CriadoEm { get; set; } = DateTime.UtcNow;
}
