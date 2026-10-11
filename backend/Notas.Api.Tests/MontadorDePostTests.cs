using System.Text.Json;
using Notas.Api.Services.Imagens;
using Xunit;

namespace Notas.Api.Tests;

// Post com IA: a resposta só vale se apontar um modelo que recebe foto, e o
// que não cabe nele (índice de texto, foto, filtro) é descartado.
public class MontadorDePostTests
{
    private static readonly ModeloParaIa Feed = new("vm-feed-novidade", "Novidade", "Feed", "foto do produto", 1, false, new[] { "novidade", "topo de bolo personalizado", "@viihmimos_" });
    private static readonly ModeloParaIa Entregas = new("vm-carrossel-entregas", "Entregas", "Carrossel", "uma entrega por post", 4, true, new[] { "entregas\nda semana" });
    private static readonly ModeloParaIa SemFoto = new("vm-feed-obrigada", "Obrigada", "Feed", "", 0, false, new[] { "obrigada!" });

    private static PedidoPost Pedido(string tipo = "auto") =>
        new(new[] { "data:image/jpeg;base64,AA", "data:image/jpeg;base64,BB" }, new[] { Feed, Entregas, SemFoto },
            new[] { "original", "quente" }, tipo, "carinhoso", "kit festa da Alice", "Viih Mimos");

    private static string Resposta(object conteudo) => JsonSerializer.Serialize(new
    {
        choices = new[] { new { message = new { content = JsonSerializer.Serialize(conteudo) } } },
    });

    [Fact]
    public void So_oferece_modelos_com_foto_do_tipo_pedido()
    {
        Assert.Equal(new[] { "vm-feed-novidade", "vm-carrossel-entregas" }, MontadorDePost.Candidatos(Pedido()).Select(m => m.Id));
        Assert.Equal(new[] { "vm-feed-novidade" }, MontadorDePost.Candidatos(Pedido("Feed")).Select(m => m.Id));
        var prompt = MontadorDePost.Prompt(Pedido(), MontadorDePost.Candidatos(Pedido()));
        Assert.Contains("kit festa da Alice", prompt);
        Assert.Contains("[1] topo de bolo personalizado", prompt);
        Assert.DoesNotContain("vm-feed-obrigada", prompt);
    }

    [Fact]
    public void Le_o_post_e_descarta_o_que_nao_cabe()
    {
        var corpo = Resposta(new
        {
            modelo = "vm-feed-novidade",
            textos = new object[] { new { indice = 1, texto = "kit festa da alice" }, new { indice = 9, texto = "fora" }, new { indice = 0, texto = " " } },
            ordemFotos = new[] { 1, 1, 7 },
            filtro = "inexistente",
            explicacao = "uma foto só do kit",
        });
        var p = MontadorDePost.LerPost(corpo, false, new[] { Feed, Entregas }, 2, new[] { "original", "quente" });

        Assert.NotNull(p);
        Assert.Equal("vm-feed-novidade", p!.ModeloId);
        Assert.Equal(new[] { new TextoDoPost(1, "kit festa da alice") }, p.Textos);
        Assert.Equal(new[] { 1, 0 }, p.OrdemFotos);
        Assert.Null(p.Filtro);
    }

    [Fact]
    public void Modelo_fora_da_lista_e_recusado()
    {
        var corpo = Resposta(new { modelo = "vm-feed-obrigada", textos = Array.Empty<object>() });
        Assert.Null(MontadorDePost.LerPost(corpo, false, new[] { Feed }, 1, Array.Empty<string>()));
    }
}
