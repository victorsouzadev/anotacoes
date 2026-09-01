using Microsoft.Extensions.Options;
using Notas.Api.Data;
using Notas.Api.Services.Financas;
using Notas.Api.Services.Financas.Llm;
using Xunit;

namespace Notas.Api.Tests;

// Testes de unidade da extração: o extrator heurístico é determinístico e o
// validador é lógica pura, então não precisam subir a API.
public class HeuristicLlmExtractorTests
{
    private static readonly DateOnly Hoje = new(2026, 8, 31);

    private static ExtracaoLlmResult Extrair(string texto) =>
        new HeuristicLlmExtractor()
            .ExtrairAsync(EntradaExtracao.DeTexto(texto), Hoje)
            .GetAwaiter().GetResult()[0];

    [Theory]
    [InlineData("gastei 45 reais no mercado hoje", 45)]
    [InlineData("almoço 32,50", 32.50)]
    // O primeiro número não é o valor: "2" é quantidade de pizzas.
    [InlineData("comprei 2 pizzas por 60 reais", 60)]
    // O primeiro número aqui é o dia do mês, não a quantia.
    [InlineData("dia 05/07 recebi 3000 de salário", 3000)]
    // Separador de milhar com centavos: o formato brasileiro completo.
    [InlineData("gastei R$ 1.234,56 no mercado", 1234.56)]
    [InlineData("paguei R$ 1.500 de aluguel", 1500)]
    [InlineData("uber 18.90", 18.90)]
    [InlineData("paguei 120 de conta de luz ontem", 120)]
    public void ExtraiValorCorreto(string texto, decimal esperado)
    {
        Assert.Equal(esperado, Extrair(texto).Valor);
    }

    [Theory]
    [InlineData("gastei 45 no mercado", "despesa")]
    [InlineData("recebi 3000 de salário", "receita")]
    [InlineData("ganhei 200 de bônus", "receita")]
    // Os dois verbos aparecem; vale o que vem primeiro na frase.
    [InlineData("paguei 50 do boleto que recebi", "despesa")]
    [InlineData("recebi 500 e paguei 100 de conta", "receita")]
    public void DetectaTipo(string texto, string esperado)
    {
        Assert.Equal(esperado, Extrair(texto).Tipo);
    }

    [Theory]
    [InlineData("gastei 45 no supermercado", "alimentacao")]
    [InlineData("uber 20 reais", "transporte")]
    [InlineData("paguei 1500 de aluguel", "moradia")]
    [InlineData("farmácia 60", "saude")]
    [InlineData("conta de luz 130", "contas_servicos")]
    [InlineData("cinema 40", "lazer")]
    [InlineData("investi 500 no tesouro", "investimentos")]
    [InlineData("paguei 33 de algo indefinido", "outros")]
    public void DetectaCategoria(string texto, string esperado)
    {
        Assert.Equal(esperado, Extrair(texto).Categoria);
    }

    [Theory]
    [InlineData("gastei 20 hoje", "2026-08-31")]
    [InlineData("gastei 20 ontem", "2026-08-30")]
    [InlineData("gastei 20 anteontem", "2026-08-29")]
    [InlineData("gastei 20 semana passada", "2026-08-24")]
    [InlineData("gastei 20 dia 05/07", "2026-07-05")]
    // Sem ano explícito, uma data à frente de hoje é do ano anterior.
    [InlineData("gastei 20 dia 25/12", "2025-12-25")]
    // Data impossível: cai para a data de envio em vez de estourar.
    [InlineData("gastei 20 dia 45/99", "2026-08-31")]
    public void DetectaData(string texto, string esperado)
    {
        Assert.Equal(esperado, Extrair(texto).Data);
    }

    [Theory]
    [InlineData("paguei 50 no pix", "pix")]
    [InlineData("paguei 50 no cartão", "cartao")]
    [InlineData("paguei 50 em dinheiro", "dinheiro")]
    [InlineData("paguei 50 de boleto", "boleto")]
    public void DetectaFormaPagamento(string texto, string esperado)
    {
        Assert.Equal(esperado, Extrair(texto).FormaPagamento);
    }

    [Fact]
    public void TextoSemNumeroTemConfiancaMinima()
    {
        var r = Extrair("fui no mercado");
        Assert.Equal(0m, r.Valor);
        Assert.True(r.Confianca < 0.2f);
    }

    [Fact]
    public void ValorAncoradoEmMoedaAumentaConfianca()
    {
        var ancorado = Extrair("gastei R$ 45 no mercado");
        var solto = Extrair("mercado 45");
        Assert.True(ancorado.Confianca > solto.Confianca);
    }

    [Fact]
    public void DescricaoLongaEhTruncadaSemPartirPalavra()
    {
        var texto = new string('a', 20) + " " + string.Join(' ', Enumerable.Repeat("palavra", 12)) + " 50 reais";
        var descricao = Extrair(texto).Descricao!;
        Assert.True(descricao.Length <= 61, $"descrição com {descricao.Length} caracteres");
        Assert.EndsWith("…", descricao);
    }
}

public class TransacaoExtractionServiceTests
{
    // Extrator de teste que devolve exatamente o resultado passado, para exercitar
    // o validador isoladamente.
    private sealed class ExtratorFixo : ILlmExtractor
    {
        private readonly ExtracaoLlmResult[] _resultados;
        public ExtratorFixo(params ExtracaoLlmResult[] resultados) => _resultados = resultados;

        public string Provedor => "fixo";
        public bool SuportaAnexos => true;

        public Task<IReadOnlyList<ExtracaoLlmResult>> ExtrairAsync(
            EntradaExtracao entrada, DateOnly d, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<ExtracaoLlmResult>>(_resultados);
    }

    private static ExtracaoLlmResult Valido() => new()
    {
        Descricao = "Mercado",
        Valor = 45.678m,
        Tipo = "despesa",
        Categoria = "alimentacao",
        Data = "2026-08-30",
        Confianca = 0.9f,
    };

    // Fábrica de teste: devolve sempre o mesmo extrator, para exercitar o
    // validador sem depender de banco nem de configuração de usuário.
    private sealed class FabricaFixa : ILlmExtractorFactory
    {
        private readonly ILlmExtractor _extrator;
        public FabricaFixa(ILlmExtractor extrator) => _extrator = extrator;

        public Task<ConfiguracaoEfetiva> ResolverAsync(string userId, CancellationToken ct = default) =>
            Task.FromResult(new ConfiguracaoEfetiva(_extrator.Provedor, "modelo-de-teste", true, true,
                _extrator.SuportaAnexos));

        public Task<ILlmExtractor> CriarAsync(string userId, CancellationToken ct = default) =>
            Task.FromResult(_extrator);

        public ILlmExtractor CriarAvulso(string provedor, string? chave, string? modelo) => _extrator;
    }

    private static Transacao Executar(ExtracaoLlmResult bruto)
    {
        var clock = new FinancasClock(Options.Create(new FinancasOptions()));
        var service = new TransacaoExtractionService(
            new FabricaFixa(new ExtratorFixo(bruto)), Options.Create(new ExtracaoOptions()), clock);
        return service.ExtrairTransacaoAsync("texto original", "user-1").GetAwaiter().GetResult();
    }

    private static ExtracaoInvalidaException ExecutarEsperandoErro(ExtracaoLlmResult bruto) =>
        Assert.Throws<ExtracaoInvalidaException>(() => Executar(bruto));

    [Fact]
    public void NormalizaResultadoValido()
    {
        var t = Executar(Valido());

        Assert.Equal("Mercado", t.Descricao);
        Assert.Equal(45.68m, t.Valor); // arredondado para 2 casas
        Assert.Equal(TipoTransacao.Despesa, t.Tipo);
        Assert.Equal(Categoria.Alimentacao, t.Categoria);
        Assert.Equal(new DateOnly(2026, 8, 30), t.Data);
        Assert.Equal(StatusTransacao.Confirmado, t.Status);
        Assert.Equal("texto original", t.TextoOriginal);
    }

    [Fact]
    public void ConfiancaAbaixoDoLimiarMarcaPendenteRevisao()
    {
        var bruto = Valido();
        bruto.Confianca = 0.4f; // limiar padrão é 0.6
        Assert.Equal(StatusTransacao.PendenteRevisao, Executar(bruto).Status);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void DescricaoVaziaEhRejeitada(string? descricao)
    {
        var bruto = Valido();
        bruto.Descricao = descricao;
        Assert.Contains("descricao", ExecutarEsperandoErro(bruto).Message);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0d)]
    [InlineData(-10d)]
    public void ValorInvalidoEhRejeitado(double? valor)
    {
        var bruto = Valido();
        bruto.Valor = valor is null ? null : (decimal)valor.Value;
        Assert.Contains("valor", ExecutarEsperandoErro(bruto).Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void TipoInvalidoEhRejeitado()
    {
        var bruto = Valido();
        bruto.Tipo = "transferencia";
        Assert.Contains("tipo", ExecutarEsperandoErro(bruto).Message);
    }

    [Fact]
    public void CategoriaInvalidaEhRejeitada()
    {
        var bruto = Valido();
        bruto.Categoria = "criptomoedas";
        Assert.Contains("categoria", ExecutarEsperandoErro(bruto).Message);
    }

    [Theory]
    [InlineData("Contas e Serviços", Categoria.ContasServicos)]
    [InlineData("contas-servicos", Categoria.ContasServicos)]
    [InlineData("ALIMENTACAO", Categoria.Alimentacao)]
    [InlineData("Educação", Categoria.Educacao)]
    public void CategoriaEhParseadaSemAcentoESemCaseSensitivity(string bruto, Categoria esperada)
    {
        var entrada = Valido();
        entrada.Categoria = bruto;
        Assert.Equal(esperada, Executar(entrada).Categoria);
    }

    [Fact]
    public void DataNaoIso8601EhRejeitada()
    {
        var bruto = Valido();
        bruto.Data = "30/08/2026";
        Assert.Contains("data", ExecutarEsperandoErro(bruto).Message);
    }

    [Fact]
    public void DataMuitoNoFuturoEhRejeitada()
    {
        var bruto = Valido();
        bruto.Data = "2099-01-01";
        Assert.Contains("futuro", ExecutarEsperandoErro(bruto).Message);
    }

    [Fact]
    public void DataAusenteUsaHoje()
    {
        var bruto = Valido();
        bruto.Data = null;
        var clock = new FinancasClock(Options.Create(new FinancasOptions()));
        Assert.Equal(clock.Hoje(), Executar(bruto).Data);
    }

    [Fact]
    public void FormaPagamentoInvalidaEhRejeitada()
    {
        var bruto = Valido();
        bruto.FormaPagamento = "cheque";
        Assert.Contains("forma_pagamento", ExecutarEsperandoErro(bruto).Message);
    }
}
