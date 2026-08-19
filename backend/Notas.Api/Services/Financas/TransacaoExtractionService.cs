using Microsoft.Extensions.Options;
using Notas.Api.Data;
using Notas.Api.Services.Financas.Llm;

namespace Notas.Api.Services.Financas;

public class ExtracaoOptions
{
    public const string SectionName = "Extracao";

    // Limiar de confiança abaixo do qual o lançamento é marcado como
    // "pendente_revisao". Configurável via appsettings.
    public float LimiarConfianca { get; set; } = 0.6f;
}

// Orquestra a extração via LLM e a validação/normalização do resultado antes
// da persistência.
public class TransacaoExtractionService
{
    private readonly ILlmExtractor _extractor;
    private readonly ExtracaoOptions _options;

    public TransacaoExtractionService(ILlmExtractor extractor, IOptions<ExtracaoOptions> options)
    {
        _extractor = extractor;
        _options = options.Value;
    }

    public async Task<Transacao> ExtrairTransacaoAsync(string textoLivre, string userId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(textoLivre))
        {
            throw new ExtracaoInvalidaException("O texto do lançamento não pode ser vazio.");
        }

        var dataEnvio = DateOnly.FromDateTime(DateTime.UtcNow);
        var bruto = await _extractor.ExtrairAsync(textoLivre, dataEnvio, cancellationToken);

        return Validar(bruto, textoLivre, userId, dataEnvio);
    }

    private Transacao Validar(ExtracaoLlmResult bruto, string textoOriginal, string userId, DateOnly dataEnvio)
    {
        if (string.IsNullOrWhiteSpace(bruto.Descricao))
        {
            throw new ExtracaoInvalidaException("Campo obrigatório ausente: descricao.");
        }

        if (bruto.Valor is null || bruto.Valor <= 0)
        {
            throw new ExtracaoInvalidaException("Campo obrigatório ausente ou inválido: valor.");
        }

        if (!TryParseTipo(bruto.Tipo, out var tipo))
        {
            throw new ExtracaoInvalidaException($"Campo 'tipo' inválido: '{bruto.Tipo}'. Esperado 'receita' ou 'despesa'.");
        }

        if (!TryParseCategoria(bruto.Categoria, out var categoria))
        {
            throw new ExtracaoInvalidaException($"Campo 'categoria' inválido: '{bruto.Categoria}'.");
        }

        DateOnly data = dataEnvio;
        if (!string.IsNullOrWhiteSpace(bruto.Data) && !DateOnly.TryParse(bruto.Data, out data))
        {
            throw new ExtracaoInvalidaException($"Campo 'data' inválido: '{bruto.Data}'. Esperado formato ISO 8601 (AAAA-MM-DD).");
        }

        FormaPagamento? formaPagamento = null;
        if (!string.IsNullOrWhiteSpace(bruto.FormaPagamento))
        {
            if (!TryParseFormaPagamento(bruto.FormaPagamento, out var forma))
            {
                throw new ExtracaoInvalidaException($"Campo 'forma_pagamento' inválido: '{bruto.FormaPagamento}'.");
            }
            formaPagamento = forma;
        }

        var confianca = bruto.Confianca ?? 0f;
        confianca = Math.Clamp(confianca, 0f, 1f);

        var status = confianca < _options.LimiarConfianca
            ? StatusTransacao.PendenteRevisao
            : StatusTransacao.Confirmado;

        return new Transacao
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Descricao = bruto.Descricao.Trim(),
            Valor = Math.Round(bruto.Valor.Value, 2),
            Tipo = tipo,
            Categoria = categoria,
            Data = data,
            FormaPagamento = formaPagamento,
            TextoOriginal = textoOriginal,
            ConfiancaIa = confianca,
            Status = status,
            Observacoes = bruto.Observacoes,
            CriadoEm = DateTime.UtcNow
        };
    }

    private static bool TryParseTipo(string? valor, out TipoTransacao tipo)
    {
        tipo = default;
        if (string.IsNullOrWhiteSpace(valor)) return false;
        switch (valor.Trim().ToLowerInvariant())
        {
            case "receita": tipo = TipoTransacao.Receita; return true;
            case "despesa": tipo = TipoTransacao.Despesa; return true;
            default: return false;
        }
    }

    private static bool TryParseCategoria(string? valor, out Categoria categoria)
    {
        categoria = Categoria.Outros;
        if (string.IsNullOrWhiteSpace(valor)) return false;
        var normalizado = valor.Trim().ToLowerInvariant().Replace("-", "_").Replace(" ", "_");
        switch (normalizado)
        {
            case "alimentacao": categoria = Categoria.Alimentacao; return true;
            case "transporte": categoria = Categoria.Transporte; return true;
            case "moradia": categoria = Categoria.Moradia; return true;
            case "saude": categoria = Categoria.Saude; return true;
            case "educacao": categoria = Categoria.Educacao; return true;
            case "lazer": categoria = Categoria.Lazer; return true;
            case "compras": categoria = Categoria.Compras; return true;
            case "contas_servicos" or "contas" or "servicos": categoria = Categoria.ContasServicos; return true;
            case "salario": categoria = Categoria.Salario; return true;
            case "investimentos": categoria = Categoria.Investimentos; return true;
            case "outros": categoria = Categoria.Outros; return true;
            default: return false;
        }
    }

    private static bool TryParseFormaPagamento(string valor, out FormaPagamento forma)
    {
        forma = default;
        switch (valor.Trim().ToLowerInvariant())
        {
            case "cartao":
            case "cartão":
                forma = FormaPagamento.Cartao; return true;
            case "pix":
                forma = FormaPagamento.Pix; return true;
            case "dinheiro":
                forma = FormaPagamento.Dinheiro; return true;
            case "boleto":
                forma = FormaPagamento.Boleto; return true;
            default:
                return false;
        }
    }
}
