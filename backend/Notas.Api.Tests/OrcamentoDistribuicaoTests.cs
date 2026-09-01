using Notas.Api.Services.Financas;
using Xunit;

namespace Notas.Api.Tests;

// A distribuição precisa fechar exatamente com o valor total: arredondar cada
// fatia isoladamente sobraria ou faltaria centavos no fim do mês.
public class OrcamentoDistribuicaoTests
{
    [Theory]
    [InlineData(1000, new[] { 50.0, 30.0, 20.0 })]
    [InlineData(3000, new[] { 25.0, 12.0, 6.0, 5.0, 2.0, 12.0, 10.0, 8.0, 20.0 })]
    // Três fatias iguais de um valor não divisível: 33,33 + 33,33 + 33,34.
    [InlineData(100, new[] { 33.3333, 33.3333, 33.3334 })]
    [InlineData(4567.89, new[] { 33.3333, 33.3333, 33.3334 })]
    [InlineData(0.03, new[] { 33.3333, 33.3333, 33.3334 })]
    [InlineData(1234.56, new[] { 7.0, 13.0, 21.0, 59.0 })]
    public void SomaDasFatiasEhExatamenteOTotal(decimal total, double[] percentuais)
    {
        var valores = OrcamentoService.Distribuir(total, percentuais.Select(p => (decimal)p).ToList());

        Assert.Equal(total, valores.Sum());
        Assert.All(valores, v => Assert.Equal(v, Math.Round(v, 2)));
    }

    [Fact]
    public void CadaFatiaFicaNoMaximoUmCentavoAcimaDoExato()
    {
        var percentuais = new List<decimal> { 33.3333m, 33.3333m, 33.3334m };
        var valores = OrcamentoService.Distribuir(100m, percentuais);

        for (var i = 0; i < valores.Count; i++)
        {
            var exato = 100m * percentuais[i] / 100m;
            Assert.InRange(valores[i] - exato, -0.01m, 0.01m);
        }
    }

    [Fact]
    public void TotalZeroDistribuiZeros()
    {
        var valores = OrcamentoService.Distribuir(0m, new List<decimal> { 50m, 50m });
        Assert.Equal(new[] { 0m, 0m }, valores);
    }

    [Fact]
    public void ListaVaziaNaoQuebra()
    {
        Assert.Empty(OrcamentoService.Distribuir(1000m, new List<decimal>()));
    }

    [Fact]
    public void TodosOsModelosSomamCemPorCento()
    {
        foreach (var modelo in ModelosOrcamento.Todos)
        {
            Assert.Equal(100m, modelo.Itens.Sum(i => i.Percentual));
            Assert.All(modelo.Itens, i => Assert.True(CategoriaInfo.EhOrcavel(i.Categoria),
                $"modelo '{modelo.Id}' usa categoria não orçável"));
            Assert.Equal(modelo.Itens.Length, modelo.Itens.Select(i => i.Categoria).Distinct().Count());
        }
    }
}
