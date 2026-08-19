using System.Globalization;
using System.Text.RegularExpressions;

namespace Notas.Api.Services.Financas.Llm;

// Extrator heurístico baseado em regras/regex, usado como fallback quando nenhuma
// chave de API de LLM está configurada (ex.: ambiente de desenvolvimento local).
public class HeuristicLlmExtractor : ILlmExtractor
{
    private static readonly Regex ValorRegex = new(@"(\d+[.,]?\d*)", RegexOptions.Compiled);

    private static readonly (string[] Palavras, string Categoria)[] CategoriaPorPalavra =
    {
        (new[] { "mercado", "supermercado", "almoço", "almoco", "janta", "restaurante", "comida", "lanche" }, "alimentacao"),
        (new[] { "uber", "gasolina", "combustivel", "combustível", "ônibus", "onibus", "metro", "metrô" }, "transporte"),
        (new[] { "aluguel", "condominio", "condomínio" }, "moradia"),
        (new[] { "farmacia", "farmácia", "médico", "medico", "consulta", "remedio", "remédio" }, "saude"),
        (new[] { "curso", "faculdade", "escola", "livro" }, "educacao"),
        (new[] { "cinema", "show", "viagem", "bar" }, "lazer"),
        (new[] { "roupa", "loja", "compra" }, "compras"),
        (new[] { "luz", "agua", "água", "internet", "telefone", "conta de" }, "contas_servicos"),
        (new[] { "salario", "salário" }, "salario"),
        (new[] { "investimento", "aplicação", "aplicacao" }, "investimentos"),
    };

    private static readonly (string[] Palavras, string Forma)[] FormaPorPalavra =
    {
        (new[] { "pix" }, "pix"),
        (new[] { "cartao", "cartão" }, "cartao"),
        (new[] { "dinheiro", "espécie", "especie" }, "dinheiro"),
        (new[] { "boleto" }, "boleto"),
    };

    public Task<ExtracaoLlmResult> ExtrairAsync(string textoLivre, DateOnly dataEnvio, CancellationToken cancellationToken = default)
    {
        var textoLower = textoLivre.ToLowerInvariant();

        var tipo = textoLower.Contains("receb") || textoLower.Contains("salário") || textoLower.Contains("salario") || textoLower.Contains("ganhei")
            ? "receita"
            : "despesa";

        var valorMatch = ValorRegex.Match(textoLower.Replace("R$", "", StringComparison.OrdinalIgnoreCase));
        decimal valor = 0;
        if (valorMatch.Success)
        {
            var valorTexto = valorMatch.Value.Replace(".", "").Replace(",", ".");
            decimal.TryParse(valorTexto, NumberStyles.Any, CultureInfo.InvariantCulture, out valor);
        }

        var categoria = "outros";
        foreach (var (palavras, cat) in CategoriaPorPalavra)
        {
            if (palavras.Any(p => textoLower.Contains(p)))
            {
                categoria = cat;
                break;
            }
        }

        string? formaPagamento = null;
        foreach (var (palavras, forma) in FormaPorPalavra)
        {
            if (palavras.Any(p => textoLower.Contains(p)))
            {
                formaPagamento = forma;
                break;
            }
        }

        var data = dataEnvio;
        if (textoLower.Contains("ontem"))
        {
            data = dataEnvio.AddDays(-1);
        }
        else
        {
            var dataMatch = Regex.Match(textoLower, @"(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?");
            if (dataMatch.Success)
            {
                var dia = int.Parse(dataMatch.Groups[1].Value);
                var mes = int.Parse(dataMatch.Groups[2].Value);
                var ano = dataMatch.Groups[3].Success ? int.Parse(dataMatch.Groups[3].Value) : dataEnvio.Year;
                if (ano < 100) ano += 2000;
                try
                {
                    data = new DateOnly(ano, mes, dia);
                }
                catch (ArgumentOutOfRangeException)
                {
                    data = dataEnvio;
                }
            }
        }

        var descricao = textoLivre.Length > 60 ? textoLivre[..60] : textoLivre;

        var resultado = new ExtracaoLlmResult
        {
            Descricao = descricao,
            Valor = valor,
            Tipo = tipo,
            Categoria = categoria,
            Data = data.ToString("yyyy-MM-dd"),
            FormaPagamento = formaPagamento,
            // Confiança conservadora: este extrator é apenas um fallback local,
            // não substitui um LLM real.
            Confianca = valor > 0 ? 0.55f : 0.2f,
            Observacoes = null
        };

        return Task.FromResult(resultado);
    }
}
