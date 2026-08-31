using System.Globalization;
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

    // Quantos dias no futuro uma data extraída pode estar antes de ser rejeitada.
    // Alguma folga cobre lançamentos agendados; anos à frente são erro de extração.
    public int MaxDiasNoFuturo { get; set; } = 370;
}

// Orquestra a extração via LLM e a validação/normalização do resultado antes
// da persistência.
public class TransacaoExtractionService
{
    private readonly ILlmExtractor _extractor;
    private readonly ExtracaoOptions _options;
    private readonly FinancasClock _clock;

    public TransacaoExtractionService(ILlmExtractor extractor, IOptions<ExtracaoOptions> options, FinancasClock clock)
    {
        _extractor = extractor;
        _options = options.Value;
        _clock = clock;
    }

    public async Task<Transacao> ExtrairTransacaoAsync(string textoLivre, string userId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(textoLivre))
        {
            throw new ExtracaoInvalidaException("O texto do lançamento não pode ser vazio.");
        }

        var hoje = _clock.Hoje();
        var bruto = await _extractor.ExtrairAsync(textoLivre, hoje, cancellationToken);

        return Validar(bruto, textoLivre, userId, hoje);
    }

    private Transacao Validar(ExtracaoLlmResult bruto, string textoOriginal, string userId, DateOnly hoje)
    {
        if (string.IsNullOrWhiteSpace(bruto.Descricao))
        {
            throw new ExtracaoInvalidaException("Campo obrigatório ausente: descricao.");
        }

        if (bruto.Valor is null || bruto.Valor <= 0)
        {
            throw new ExtracaoInvalidaException(
                "Não identifiquei um valor no texto. Inclua a quantia, por exemplo: \"gastei 45 reais no mercado\".");
        }

        if (bruto.Valor > 99_999_999m)
        {
            throw new ExtracaoInvalidaException("Valor acima do limite suportado.");
        }

        if (!TryParseTipo(bruto.Tipo, out var tipo))
        {
            throw new ExtracaoInvalidaException($"Campo 'tipo' inválido: '{bruto.Tipo}'. Esperado 'receita' ou 'despesa'.");
        }

        if (!CategoriaInfo.TryParse(bruto.Categoria, out var categoria))
        {
            throw new ExtracaoInvalidaException($"Campo 'categoria' inválido: '{bruto.Categoria}'.");
        }

        var data = ParseData(bruto.Data, hoje);

        FormaPagamento? formaPagamento = null;
        if (!string.IsNullOrWhiteSpace(bruto.FormaPagamento))
        {
            if (!TryParseFormaPagamento(bruto.FormaPagamento, out var forma))
            {
                throw new ExtracaoInvalidaException($"Campo 'forma_pagamento' inválido: '{bruto.FormaPagamento}'.");
            }
            formaPagamento = forma;
        }

        var confianca = Math.Clamp(bruto.Confianca ?? 0f, 0f, 1f);

        var status = confianca < _options.LimiarConfianca
            ? StatusTransacao.PendenteRevisao
            : StatusTransacao.Confirmado;

        return new Transacao
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Descricao = Truncar(bruto.Descricao.Trim(), 500),
            Valor = Math.Round(bruto.Valor.Value, 2, MidpointRounding.AwayFromZero),
            Tipo = tipo,
            Categoria = categoria,
            Data = data,
            FormaPagamento = formaPagamento,
            TextoOriginal = Truncar(textoOriginal, 1000),
            ConfiancaIa = confianca,
            Status = status,
            Observacoes = string.IsNullOrWhiteSpace(bruto.Observacoes) ? null : Truncar(bruto.Observacoes.Trim(), 500),
            CriadoEm = DateTime.UtcNow
        };
    }

    // Parsing estrito em ISO 8601: depender da cultura do processo faria "05/07"
    // virar 7 de maio num servidor com cultura invariante.
    private DateOnly ParseData(string? bruto, DateOnly hoje)
    {
        if (string.IsNullOrWhiteSpace(bruto)) return hoje;

        if (!DateOnly.TryParseExact(bruto.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var data))
        {
            throw new ExtracaoInvalidaException($"Campo 'data' inválido: '{bruto}'. Esperado formato ISO 8601 (AAAA-MM-DD).");
        }

        if (data > hoje.AddDays(_options.MaxDiasNoFuturo))
        {
            throw new ExtracaoInvalidaException($"Data muito distante no futuro: '{bruto}'.");
        }

        if (data < hoje.AddYears(-50))
        {
            throw new ExtracaoInvalidaException($"Data muito antiga: '{bruto}'.");
        }

        return data;
    }

    private static string Truncar(string valor, int max) =>
        valor.Length <= max ? valor : valor[..max];

    private static bool TryParseTipo(string? valor, out TipoTransacao tipo)
    {
        tipo = default;
        if (string.IsNullOrWhiteSpace(valor)) return false;
        switch (valor.Trim().ToLowerInvariant())
        {
            case "receita" or "entrada": tipo = TipoTransacao.Receita; return true;
            case "despesa" or "saida" or "saída": tipo = TipoTransacao.Despesa; return true;
            default: return false;
        }
    }

    private static bool TryParseFormaPagamento(string valor, out FormaPagamento forma)
    {
        forma = default;
        switch (valor.Trim().ToLowerInvariant())
        {
            case "cartao" or "cartão" or "credito" or "crédito" or "debito" or "débito":
                forma = FormaPagamento.Cartao; return true;
            case "pix":
                forma = FormaPagamento.Pix; return true;
            case "dinheiro" or "especie" or "espécie":
                forma = FormaPagamento.Dinheiro; return true;
            case "boleto" or "fatura":
                forma = FormaPagamento.Boleto; return true;
            default:
                return false;
        }
    }
}
