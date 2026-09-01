using System.Globalization;
using Notas.Api.Services;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>
/// Regressão do 500 em produção: a imagem Alpine subia em modo
/// globalization-invariant e <c>GetCultureInfo("pt-BR")</c> derrubava, num campo
/// <c>static readonly</c>, o dashboard de finanças e o teste de conexão da IA.
/// </summary>
public class CulturaBrTests
{
    [Fact]
    public void ResolverCultura_NaoLanca_MesmoSemIcu()
    {
        // O simples fato de tocar na classe já executaria o inicializador antigo.
        var excecao = Record.Exception(() => CulturaBr.Cultura);

        Assert.Null(excecao);
        Assert.NotNull(CulturaBr.Cultura);
    }

    [Theory]
    [InlineData(2026, 1, "jan./26")]
    [InlineData(2026, 9, "set./26")]
    [InlineData(2026, 12, "dez./26")]
    [InlineData(2025, 5, "mai./25")]
    [InlineData(2000, 3, "mar./00")]
    public void MesAbreviado_SemIcu_UsaOsRotulosEmPortugues(int ano, int mes, string esperado)
    {
        var data = new DateOnly(ano, mes, 1);

        Assert.Equal(esperado, CulturaBr.MesAbreviado(data, comIcu: false));
    }

    [Theory]
    [InlineData(0, "0,00")]
    [InlineData(42.5, "42,50")]
    [InlineData(1234.5, "1.234,50")]
    [InlineData(1234567.891, "1.234.567,89")]
    [InlineData(-1234.5, "-1.234,50")]
    public void Dinheiro_SemIcu_UsaVirgulaEPonto(decimal valor, string esperado)
    {
        Assert.Equal(esperado, CulturaBr.Dinheiro(valor, comIcu: false));
    }

    // As duas comparações abaixo são o coração do teste: garantem que o plano B
    // devolve exatamente o mesmo texto que o pt-BR de verdade, e não uma
    // aproximação que mudaria a tela conforme a imagem tivesse ICU ou não.

    [Fact]
    public void MesAbreviado_SemIcu_ProduzOMesmoTextoQueOPtBrDeVerdade()
    {
        SePuderCarregarPtBr(cultura =>
        {
            for (var i = 0; i < 36; i++)
            {
                var data = new DateOnly(2024, 1, 1).AddMonths(i);

                Assert.Equal(
                    data.ToString("MMM/yy", cultura),
                    CulturaBr.MesAbreviado(data, comIcu: false));
            }
        });
    }

    [Theory]
    [InlineData(0)]
    [InlineData(0.05)]
    [InlineData(42.5)]
    [InlineData(999.999)]
    [InlineData(1234.5)]
    [InlineData(1234567.891)]
    [InlineData(-1234.5)]
    public void Dinheiro_SemIcu_ProduzOMesmoTextoQueOPtBrDeVerdade(decimal valor)
    {
        SePuderCarregarPtBr(cultura =>
            Assert.Equal(valor.ToString("N2", cultura), CulturaBr.Dinheiro(valor, comIcu: false)));
    }

    // string.Normalize é um no-op sem ICU, então estes casos valem tanto rodando
    // com ICU quanto sem: o resultado tem de ser o mesmo nos dois mundos.

    [Theory]
    [InlineData("Educação", "Educacao")]
    [InlineData("Contas e Serviços", "Contas e Servicos")]
    [InlineData("Alimentação", "Alimentacao")]
    [InlineData("São Paulo", "Sao Paulo")]
    [InlineData("Anotações — Finanças", "Anotacoes — Financas")]
    [InlineData("ÁÀÂÃÇÉÊÍÓÔÕÚÜ", "AAAACEEIOOOUU")]
    [InlineData("sem acento nenhum", "sem acento nenhum")]
    [InlineData("", "")]
    public void SemAcentos_FuncionaComOuSemIcu(string entrada, string esperado)
    {
        Assert.Equal(esperado, CulturaBr.SemAcentos(entrada));
    }

    [Fact]
    public void SemAcentos_TambemCobreAcentoJaDecomposto()
    {
        // "e" + acento agudo combinante, a forma que o FormD produziria.
        Assert.Equal("cafe", CulturaBr.SemAcentos("caf\u0065\u0301"));
    }

    private static void SePuderCarregarPtBr(Action<CultureInfo> verificar)
    {
        CultureInfo cultura;
        try
        {
            cultura = CultureInfo.GetCultureInfo("pt-BR");
        }
        catch (CultureNotFoundException)
        {
            // Rodando sem ICU: não há referência com que comparar, e os testes
            // de valor literal acima já cobrem o formato.
            return;
        }

        verificar(cultura);
    }
}
