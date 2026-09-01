using System.Globalization;
using System.Text;
using System.Runtime.CompilerServices;

[assembly: InternalsVisibleTo("Notas.Api.Tests")]

namespace Notas.Api.Services;

/// <summary>
/// Formatação em português do Brasil que não depende do ICU estar instalado.
/// </summary>
/// <remarks>
/// As imagens Alpine do .NET sobem em modo globalization-invariant, e nele
/// <c>CultureInfo.GetCultureInfo("pt-BR")</c> lança <see
/// cref="CultureNotFoundException"/>. Como as chamadas ficavam em campos
/// <c>static readonly</c>, a exceção virava <c>TypeInitializationException</c> na
/// primeira requisição e derrubava o endpoint inteiro com 500 — foi exatamente
/// isso que quebrou o dashboard de finanças e o teste de conexão da IA em
/// produção. O Dockerfile agora instala o ICU, mas manter o plano B aqui é o que
/// garante que uma imagem sem ele volte a degradar o rótulo em vez de derrubar a
/// API.
/// </remarks>
public static class CulturaBr
{
    /// <summary>
    /// A cultura pt-BR quando o ICU está disponível; a invariante caso contrário.
    /// </summary>
    public static CultureInfo Cultura { get; } = Resolver();

    /// <summary><c>true</c> quando o pt-BR de verdade foi carregado.</summary>
    public static bool IcuDisponivel { get; } = Cultura.Name == "pt-BR";

    private static CultureInfo Resolver()
    {
        try
        {
            return CultureInfo.GetCultureInfo("pt-BR");
        }
        catch (CultureNotFoundException)
        {
            return CultureInfo.InvariantCulture;
        }
    }

    /// <summary>Rótulo curto de competência, no formato <c>set./26</c>.</summary>
    public static string MesAbreviado(DateOnly data) => MesAbreviado(data, IcuDisponivel);

    /// <summary>Valor com milhar e dois decimais, no formato <c>1.234,50</c>.</summary>
    public static string Dinheiro(decimal valor) => Dinheiro(valor, IcuDisponivel);

    // Os overloads abaixo existem para que os testes consigam exercitar o
    // caminho sem ICU mesmo rodando numa máquina que tem ICU: o modo
    // globalization-invariant é uma chave de inicialização do processo e não dá
    // para ligá-la no meio de uma suíte de testes.

    internal static string MesAbreviado(DateOnly data, bool comIcu) =>
        comIcu
            ? data.ToString("MMM/yy", Cultura)
            : $"{MesesAbreviados[data.Month - 1]}/{data.Year % 100:00}";

    internal static string Dinheiro(decimal valor, bool comIcu) =>
        valor.ToString("N2", comIcu ? Cultura : FormatoNumericoBr);

    /// <summary>
    /// Devolve o texto sem acentos ("Educação" vira "Educacao"), preservando a
    /// letra base em vez de apagar o caractere.
    /// </summary>
    /// <remarks>
    /// <c>string.Normalize</c> é um no-op em modo globalization-invariant: sem
    /// ICU, "Educação" continua "Educação" e o filtro de categoria simplesmente
    /// deixava de casar. A tabela abaixo roda antes da normalização justamente
    /// para que o resultado seja o mesmo com ou sem ICU.
    /// </remarks>
    public static string SemAcentos(string? valor)
    {
        if (string.IsNullOrEmpty(valor)) return "";

        var dobrado = new StringBuilder(valor.Length);
        foreach (var c in valor)
        {
            var i = ComAcento.IndexOf(c);
            dobrado.Append(i >= 0 ? SemAcento[i] : c);
        }

        // A decomposição ainda cobre o que vier já decomposto na origem ("e" +
        // acento combinante) e letras fora da tabela — quando há ICU.
        var decomposto = dobrado.ToString().Normalize(NormalizationForm.FormD);

        return string.Concat(decomposto.Where(c =>
            CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark));
    }

    private const string ComAcento = "áàâãäåçéèêëíìîïñóòôõöúùûüýÁÀÂÃÄÅÇÉÈÊËÍÌÎÏÑÓÒÔÕÖÚÙÛÜÝ";
    private const string SemAcento = "aaaaaaceeeeiiiinooooouuuuyAAAAAACEEEEIIIINOOOOOUUUUY";

    // Abreviações como o pt-BR as escreve (com o ponto), para quando não há ICU.
    private static readonly string[] MesesAbreviados =
        ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];

    private static readonly NumberFormatInfo FormatoNumericoBr = new()
    {
        NumberDecimalSeparator = ",",
        NumberGroupSeparator = ".",
        NumberGroupSizes = [3],
        NumberNegativePattern = 1, // -1.234,50
    };
}
