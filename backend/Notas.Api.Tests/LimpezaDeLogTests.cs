using Notas.Api.Services.Agente;
using Xunit;

namespace Notas.Api.Tests;

public class LimpezaDeLogTests
{
    [Theory]
    [InlineData("Host=pg;Password=abc123;Database=hub")]
    [InlineData("Authorization: Bearer eyJhbGciOi")]
    [InlineData("apikey: sk-ant-xyz")]
    [InlineData("x-ApiKey=123")]
    public void Linha_com_segredo_sai_inteira(string linha)
    {
        var limpo = LimpezaDeLog.Limpar("antes\n" + linha + "\ndepois");
        Assert.Equal($"antes\n{LimpezaDeLog.Aviso}\ndepois", limpo);
    }

    [Fact]
    public void Linha_comum_fica_igual() =>
        Assert.Equal("info: subiu na porta 8080\nwarn: health lento", LimpezaDeLog.Limpar("info: subiu na porta 8080\nwarn: health lento"));
}
