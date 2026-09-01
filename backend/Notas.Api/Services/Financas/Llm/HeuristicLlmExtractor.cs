using System.Globalization;
using System.Text.RegularExpressions;

namespace Notas.Api.Services.Financas.Llm;

// Extrator heurístico baseado em regras/regex, usado como fallback quando nenhuma
// chave de API de LLM está configurada (ex.: ambiente de desenvolvimento local).
public partial class HeuristicLlmExtractor : ILlmExtractor
{
    // Número no formato brasileiro: milhar com ponto e centavos com vírgula
    // ("1.234,56"), ou formato simples ("45", "32,50", "45.90").
    [GeneratedRegex(@"\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?")]
    private static partial Regex NumeroRegex();

    // Um valor monetário é bem mais provável quando está colado num marcador de
    // dinheiro. Capturamos o número em qualquer um dos lados do marcador.
    [GeneratedRegex(@"(?:r\$\s*(?<v>\d[\d.,]*))|(?:(?<v>\d[\d.,]*)\s*(?:reais|real|conto|pila|mangos?))")]
    private static partial Regex ValorAncoradoRegex();

    [GeneratedRegex(@"\b(?<d>\d{1,2})[/-](?<m>\d{1,2})(?:[/-](?<a>\d{2,4}))?\b")]
    private static partial Regex DataRegex();

    // Trechos que contêm números mas nunca são o valor: datas, horas e percentuais.
    [GeneratedRegex(@"\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b\d{1,2}[h:]\d{0,2}\b|\b\d+\s*%")]
    private static partial Regex RuidoNumericoRegex();

    private static readonly (string[] Palavras, string Categoria)[] CategoriaPorPalavra =
    {
        (new[] { "aluguel", "condominio", "condomínio", "iptu", "financiamento" }, "moradia"),
        (new[] { "luz", "energia", "agua", "água", "internet", "telefone", "celular", "gás", "gas", "conta de", "assinatura", "netflix", "spotify" }, "contas_servicos"),
        (new[] { "mercado", "supermercado", "feira", "almoço", "almoco", "janta", "jantar", "café", "cafe", "restaurante", "comida", "lanche", "padaria", "ifood" }, "alimentacao"),
        (new[] { "uber", "99", "taxi", "táxi", "gasolina", "combustivel", "combustível", "etanol", "estacionamento", "pedágio", "pedagio", "ônibus", "onibus", "metro", "metrô", "passagem" }, "transporte"),
        (new[] { "farmacia", "farmácia", "médico", "medico", "dentista", "consulta", "exame", "remedio", "remédio", "plano de saude", "plano de saúde", "academia" }, "saude"),
        (new[] { "curso", "faculdade", "escola", "livro", "mensalidade", "material escolar" }, "educacao"),
        (new[] { "cinema", "show", "viagem", "bar", "cerveja", "festa", "jogo", "streaming" }, "lazer"),
        (new[] { "roupa", "tênis", "tenis", "sapato", "loja", "presente", "compra", "shopping" }, "compras"),
        (new[] { "salario", "salário", "pagamento", "freela", "freelance" }, "salario"),
        (new[] { "investimento", "investi", "aplicação", "aplicacao", "poupança", "poupanca", "tesouro", "cdb", "ações", "acoes" }, "investimentos"),
    };

    private static readonly (string[] Palavras, string Forma)[] FormaPorPalavra =
    {
        (new[] { "pix" }, "pix"),
        (new[] { "cartao", "cartão", "crédito", "credito", "débito", "debito" }, "cartao"),
        (new[] { "dinheiro", "espécie", "especie" }, "dinheiro"),
        (new[] { "boleto", "fatura" }, "boleto"),
    };

    private static readonly string[] PalavrasReceita =
        { "recebi", "receber", "recebimento", "ganhei", "ganho", "salário", "salario", "entrou", "caiu na conta", "vendi", "reembolso", "restituição", "restituicao" };

    private static readonly string[] PalavrasDespesa =
        { "gastei", "paguei", "comprei", "pagamento de", "torrei", "debitou", "saiu da conta" };

    public string Provedor => "heuristico";

    // Regex não lê foto de cupom nem PDF: quem tenta importar arquivo sem um LLM
    // configurado recebe um erro claro, em vez de um resultado inventado.
    public bool SuportaAnexos => false;

    public Task<IReadOnlyList<ExtracaoLlmResult>> ExtrairAsync(
        EntradaExtracao entrada, DateOnly dataEnvio, CancellationToken cancellationToken = default)
    {
        var textoLivre = entrada.Texto;
        var textoLower = textoLivre.ToLowerInvariant();

        var tipo = DetectarTipo(textoLower);
        var (valor, valorAncorado) = ExtrairValor(textoLower);
        var categoria = DetectarCategoria(textoLower) ?? (tipo == "receita" ? "salario" : "outros");
        var formaPagamento = DetectarForma(textoLower);
        var (data, dataExplicita) = DetectarData(textoLower, dataEnvio);

        var descricao = MontarDescricao(textoLivre);

        var resultado = new ExtracaoLlmResult
        {
            Descricao = descricao,
            Valor = valor,
            Tipo = tipo,
            Categoria = categoria,
            Data = data.ToString("yyyy-MM-dd"),
            FormaPagamento = formaPagamento,
            Confianca = CalcularConfianca(valor, valorAncorado, categoria, dataExplicita),
            Observacoes = null
        };

        return Task.FromResult<IReadOnlyList<ExtracaoLlmResult>>(new[] { resultado });
    }

    // A confiança é deliberadamente conservadora: este extrator é um fallback local
    // sem compreensão de linguagem. Ela sobe conforme os sinais ficam menos ambíguos,
    // para que um texto simples e bem formado não caia sempre em revisão manual.
    private static float CalcularConfianca(decimal valor, bool valorAncorado, string categoria, bool dataExplicita)
    {
        if (valor <= 0) return 0.1f;

        var confianca = 0.45f;
        if (valorAncorado) confianca += 0.2f;          // "R$ 45" / "45 reais" é inequívoco
        if (categoria != "outros") confianca += 0.15f; // achamos uma palavra-chave conhecida
        if (dataExplicita) confianca += 0.05f;
        return Math.Clamp(confianca, 0f, 0.9f);
    }

    private static string DetectarTipo(string textoLower)
    {
        var indiceReceita = PrimeiraOcorrencia(textoLower, PalavrasReceita);
        var indiceDespesa = PrimeiraOcorrencia(textoLower, PalavrasDespesa);

        if (indiceReceita < 0) return "despesa";
        if (indiceDespesa < 0) return "receita";

        // Ambos aparecem ("paguei o boleto com o que recebi"): vale o verbo que
        // vem primeiro, que costuma ser o da ação principal da frase.
        return indiceReceita < indiceDespesa ? "receita" : "despesa";
    }

    private static int PrimeiraOcorrencia(string texto, string[] palavras)
    {
        var menor = -1;
        foreach (var palavra in palavras)
        {
            var i = texto.IndexOf(palavra, StringComparison.Ordinal);
            if (i >= 0 && (menor < 0 || i < menor)) menor = i;
        }
        return menor;
    }

    // Prioriza o número colado num marcador de dinheiro ("R$ 60", "60 reais"); só
    // se não houver nenhum é que cai para o maior número restante do texto. Pegar o
    // primeiro número seria errado em "comprei 2 pizzas por 60 reais" e em
    // "dia 05/07 recebi 3000".
    private static (decimal Valor, bool Ancorado) ExtrairValor(string textoLower)
    {
        foreach (Match m in ValorAncoradoRegex().Matches(textoLower))
        {
            if (TryParseValorBr(m.Groups["v"].Value, out var ancorado) && ancorado > 0)
            {
                return (ancorado, true);
            }
        }

        // Sem marcador: remove datas/horas/percentuais e fica com o maior número,
        // que num lançamento é quase sempre a quantia.
        var limpo = RuidoNumericoRegex().Replace(textoLower, " ");
        decimal melhor = 0;
        foreach (Match m in NumeroRegex().Matches(limpo))
        {
            if (TryParseValorBr(m.Value, out var candidato) && candidato > melhor)
            {
                melhor = candidato;
            }
        }
        return (melhor, false);
    }

    // "1.234,56" -> 1234.56 | "32,50" -> 32.50 | "45.90" -> 45.90 | "1.234" -> 1234
    private static bool TryParseValorBr(string bruto, out decimal valor)
    {
        valor = 0;
        var texto = bruto.Trim().TrimEnd('.', ',');
        if (texto.Length == 0) return false;

        if (texto.Contains(','))
        {
            // Vírgula é sempre o separador decimal no formato brasileiro.
            texto = texto.Replace(".", "").Replace(',', '.');
        }
        else if (texto.Contains('.'))
        {
            var partes = texto.Split('.');
            var ultima = partes[^1];
            // "1.234" e "1.234.567" são milhar; "45.90" é decimal.
            texto = partes.Length > 2 || ultima.Length == 3
                ? string.Concat(partes)
                : texto;
        }

        return decimal.TryParse(texto, NumberStyles.Any, CultureInfo.InvariantCulture, out valor);
    }

    private static string? DetectarCategoria(string textoLower)
    {
        foreach (var (palavras, cat) in CategoriaPorPalavra)
        {
            if (palavras.Any(p => ContemPalavra(textoLower, p))) return cat;
        }
        return null;
    }

    private static string? DetectarForma(string textoLower)
    {
        foreach (var (palavras, forma) in FormaPorPalavra)
        {
            if (palavras.Any(p => ContemPalavra(textoLower, p))) return forma;
        }
        return null;
    }

    // Busca por palavra inteira, não por substring: "gastei" contém "gas" e faria
    // qualquer gasto ser classificado como conta de gás.
    private static bool ContemPalavra(string texto, string palavra)
    {
        var de = 0;
        while (de <= texto.Length - palavra.Length)
        {
            var i = texto.IndexOf(palavra, de, StringComparison.Ordinal);
            if (i < 0) return false;

            var fim = i + palavra.Length;
            var antesOk = i == 0 || !char.IsLetterOrDigit(texto[i - 1]);
            var depoisOk = fim >= texto.Length || !char.IsLetterOrDigit(texto[fim]);
            if (antesOk && depoisOk) return true;

            de = i + 1;
        }
        return false;
    }

    private static (DateOnly Data, bool Explicita) DetectarData(string textoLower, DateOnly dataEnvio)
    {
        if (textoLower.Contains("anteontem")) return (dataEnvio.AddDays(-2), true);
        if (textoLower.Contains("ontem")) return (dataEnvio.AddDays(-1), true);
        if (textoLower.Contains("semana passada")) return (dataEnvio.AddDays(-7), true);
        if (textoLower.Contains("mês passado") || textoLower.Contains("mes passado")) return (dataEnvio.AddMonths(-1), true);
        if (textoLower.Contains("hoje")) return (dataEnvio, true);

        var m = DataRegex().Match(textoLower);
        if (m.Success)
        {
            var dia = int.Parse(m.Groups["d"].Value);
            var mes = int.Parse(m.Groups["m"].Value);
            var ano = m.Groups["a"].Success ? int.Parse(m.Groups["a"].Value) : dataEnvio.Year;
            if (ano < 100) ano += 2000;

            try
            {
                var data = new DateOnly(ano, mes, dia);
                // Sem ano explícito, uma data à frente de hoje quase sempre é do ano
                // anterior ("lancei dia 28/12" digitado em janeiro).
                if (!m.Groups["a"].Success && data > dataEnvio) data = data.AddYears(-1);
                return (data, true);
            }
            catch (ArgumentOutOfRangeException)
            {
                // Data impossível (ex.: 32/13): ignora e usa a data de envio.
            }
        }

        return (dataEnvio, false);
    }

    private static string MontarDescricao(string textoLivre)
    {
        var texto = textoLivre.Trim();
        if (texto.Length <= 60) return texto;

        // Corta na última palavra inteira dentro do limite, em vez de partir a palavra.
        var corte = texto[..60].LastIndexOf(' ');
        return (corte > 20 ? texto[..corte] : texto[..60]).TrimEnd() + "…";
    }
}
