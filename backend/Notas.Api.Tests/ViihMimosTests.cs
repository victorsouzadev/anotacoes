using Notas.Api.Endpoints;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>Quem usa a precificação guardada no painel da Viih Mimos.</summary>
public class ViihMimosTests
{
    static ViihMimosOptions Opcoes(string usuarios = "viih@x.com, outro@x.com") =>
        new() { Url = "https://painel", Chave = new string('a', 32), Usuarios = usuarios };

    [Fact] public void Liga_com_url_e_chave_longa() => Assert.True(Opcoes().Ligado);
    [Fact] public void Chave_curta_nao_liga() => Assert.False(new ViihMimosOptions { Url = "https://painel", Chave = "curta" }.Ligado);
    [Fact] public void So_os_emails_da_lista_usam() 
    {
        Assert.True(Opcoes().Pode("VIIH@x.com"));
        Assert.False(Opcoes().Pode("estranho@x.com"));
        Assert.False(Opcoes("").Pode("viih@x.com"));
    }
}
