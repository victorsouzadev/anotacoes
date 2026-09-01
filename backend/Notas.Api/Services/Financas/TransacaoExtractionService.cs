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

// Lançamentos aproveitados e o motivo de cada um que foi descartado — um extrato
// pode ter linhas que não são movimentação, e a interface precisa poder dizer
// quantas ficaram de fora.
public record ResultadoExtracao(IReadOnlyList<Transacao> Transacoes, IReadOnlyList<string> Descartes);

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

    public string Provedor => _extractor.Provedor;
    public bool SuportaAnexos => _extractor.SuportaAnexos;

    public async Task<Transacao> ExtrairTransacaoAsync(string textoLivre, string userId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(textoLivre))
        {
            throw new ExtracaoInvalidaException("O texto do lançamento não pode ser vazio.");
        }

        var resultado = await ExtrairAsync(EntradaExtracao.DeTexto(textoLivre), userId, cancellationToken);
        return resultado.Transacoes[0];
    }

    // Um texto digitado rende um lançamento; um extrato pode render dezenas. Uma
    // linha inválida no meio de um documento longo não invalida o documento
    // inteiro: ela é descartada e as demais seguem.
    public async Task<ResultadoExtracao> ExtrairAsync(
        EntradaExtracao entrada, string userId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(entrada.Texto) && !entrada.TemAnexos)
        {
            throw new ExtracaoInvalidaException("Envie um texto ou um arquivo para registrar o lançamento.");
        }

        if (entrada.TemAnexos && !_extractor.SuportaAnexos)
        {
            throw new LlmIndisponivelException(
                "A leitura de imagens e arquivos precisa de uma chave de API configurada " +
                "(OPENROUTER_API_KEY). Sem ela, só o lançamento por texto está disponível.");
        }

        var hoje = _clock.Hoje();
        var brutos = await _extractor.ExtrairAsync(entrada, hoje, cancellationToken);

        var textoOriginal = MontarTextoOriginal(entrada);
        var transacoes = new List<Transacao>(brutos.Count);
        var descartes = new List<string>();
        ExtracaoInvalidaException? primeiroErro = null;

        foreach (var bruto in brutos)
        {
            try
            {
                transacoes.Add(Validar(bruto, textoOriginal, userId, hoje));
            }
            catch (ExtracaoInvalidaException ex)
            {
                primeiroErro ??= ex;
                descartes.Add(ex.Message);
            }
        }

        if (transacoes.Count == 0)
        {
            // Nada aproveitável: devolve o motivo do primeiro descarte, que é mais
            // útil do que um "não encontrei nada" genérico.
            throw primeiroErro ?? new ExtracaoInvalidaException(
                "Não encontrei nenhum lançamento no que foi enviado.");
        }

        return new ResultadoExtracao(transacoes, descartes);
    }

    private static string MontarTextoOriginal(EntradaExtracao entrada)
    {
        if (!entrada.TemAnexos) return entrada.Texto;

        var nomes = string.Join(", ", entrada.Anexos.Select(a => a.NomeArquivo));
        return string.IsNullOrWhiteSpace(entrada.Texto) ? $"[arquivo] {nomes}" : $"{entrada.Texto} [arquivo] {nomes}";
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
