using System.Net;
using Microsoft.Extensions.Logging.Abstractions;
using Notas.Api.Services.Imagens;
using Xunit;

namespace Notas.Api.Tests;

public class RemoveBgTests
{
    private static readonly byte[] Recorte = [7, 7, 7];

    private static ReplicateBackgroundRemover Criar(HandlerDeUpscale handler, RemoveBgOptions? options = null, string chave = "token")
        => new(new HttpClient(handler), options ?? new RemoveBgOptions { TimeoutSegundos = 20 }, chave,
            NullLogger<ReplicateBackgroundRemover>.Instance);

    [Fact]
    public void Sem_chave_o_recurso_fica_desligado()
    {
        Assert.False(Criar(new HandlerDeUpscale(), chave: " ").Disponivel);
    }

    [Fact]
    public async Task Modelo_oficial_vai_pelo_nome_com_a_foto_no_campo_configurado()
    {
        var handler = new HandlerDeUpscale()
            .Responde(HttpStatusCode.OK, new { status = "succeeded", output = "https://exemplo/recorte.png" })
            .RespondeImagem(Recorte);

        var resultado = await Criar(handler).RemoverFundoAsync([1, 2], "image/jpeg");

        Assert.Equal(Recorte, resultado.Conteudo);
        Assert.Equal("image/png", resultado.ContentType);
        Assert.EndsWith("/models/bria/remove-background/predictions", handler.UrlsChamadas[0]);
        Assert.Contains("\"image\":\"data:image/jpeg;base64,", handler.CorposEnviados[0]);
    }

    [Fact]
    public async Task Com_versao_vai_por_versao()
    {
        var handler = new HandlerDeUpscale()
            .Responde(HttpStatusCode.OK, new { status = "starting", urls = new { get = "https://exemplo/p/1" } })
            .Responde(HttpStatusCode.OK, new { status = "succeeded", output = new[] { "https://exemplo/r.png" } })
            .RespondeImagem(Recorte);
        var options = new RemoveBgOptions { Version = "abc123", CampoImagem = "input_image", TimeoutSegundos = 20 };

        var resultado = await Criar(handler, options).RemoverFundoAsync([1], "image/png");

        Assert.Equal(Recorte, resultado.Conteudo);
        Assert.EndsWith("/v1/predictions", handler.UrlsChamadas[0]);
        Assert.Contains("\"version\":\"abc123\"", handler.CorposEnviados[0]);
        Assert.Contains("\"input_image\":", handler.CorposEnviados[0]);
    }

    [Fact]
    public async Task Falha_do_modelo_vira_mensagem()
    {
        var handler = new HandlerDeUpscale().Responde(HttpStatusCode.OK, new { status = "failed", error = "sem objeto" });

        var erro = await Assert.ThrowsAsync<UpscaleIndisponivelException>(
            () => Criar(handler).RemoverFundoAsync([1], "image/png"));
        Assert.Contains("sem objeto", erro.Message);
    }

    [Fact]
    public async Task Foto_grande_demais_nao_sai_e_pede_menor()
    {
        var handler = new HandlerDeUpscale();
        var erro = await Assert.ThrowsAsync<UpscaleIndisponivelException>(
            () => Criar(handler, new RemoveBgOptions { MaxUploadBytes = 4 }).RemoverFundoAsync(new byte[10], "image/png"));
        Assert.True(erro.TentarMenor);
        Assert.Empty(handler.UrlsChamadas);
    }
}
