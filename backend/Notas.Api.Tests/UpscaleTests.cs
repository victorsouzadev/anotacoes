using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Notas.Api.Endpoints;
using Notas.Api.Services.Imagens;
using Xunit;

namespace Notas.Api.Tests;

// Serviço externo de mentira: responde o que foi roteirizado e guarda o que
// recebeu, pra exercitar a ampliação sem gastar chamada paga.
internal sealed class HandlerDeUpscale : HttpMessageHandler
{
    private readonly Queue<(HttpStatusCode Status, string Corpo, string? Tipo)> _respostas = new();

    public List<string> UrlsChamadas { get; } = new();
    public List<string> CorposEnviados { get; } = new();

    public HandlerDeUpscale Responde(HttpStatusCode status, object corpo)
    {
        _respostas.Enqueue((status, JsonSerializer.Serialize(corpo), null));
        return this;
    }

    public HandlerDeUpscale RespondeImagem(byte[] bytes, string tipo = "image/png")
    {
        _respostas.Enqueue((HttpStatusCode.OK, Convert.ToBase64String(bytes), tipo));
        return this;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        UrlsChamadas.Add(request.RequestUri!.ToString());
        CorposEnviados.Add(request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct));

        if (_respostas.Count == 0) throw new InvalidOperationException("Handler sem resposta roteirizada.");
        var (status, corpo, tipo) = _respostas.Dequeue();

        var content = tipo is null
            ? new StringContent(corpo, Encoding.UTF8, "application/json")
            : new ByteArrayContent(Convert.FromBase64String(corpo));
        if (tipo is not null) content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(tipo);

        return new HttpResponseMessage(status) { Content = content };
    }
}

public class UpscaleTests
{
    private static readonly byte[] Ampliada = [1, 2, 3, 4, 5];

    private static ReplicateUpscaler Criar(HandlerDeUpscale handler, string chave = "token-de-teste")
    {
        var options = Options.Create(new UpscaleOptions { ApiKey = chave, TimeoutSegundos = 20 });
        return new ReplicateUpscaler(new HttpClient(handler), options, NullLogger<ReplicateUpscaler>.Instance);
    }

    [Fact]
    public void Sem_chave_o_recurso_fica_desligado()
    {
        var upscaler = Criar(new HandlerDeUpscale(), chave: "");
        Assert.False(upscaler.Disponivel);
    }

    [Fact]
    public async Task Amplia_quando_o_servico_responde_de_primeira()
    {
        var handler = new HandlerDeUpscale()
            .Responde(HttpStatusCode.OK, new { status = "succeeded", output = "https://exemplo/ampliada.png" })
            .RespondeImagem(Ampliada);

        var resultado = await Criar(handler).AmpliarAsync([9, 9, 9], "image/jpeg", 2);

        Assert.Equal(Ampliada, resultado.Conteudo);
        Assert.Equal("image/png", resultado.ContentType);
        // A foto vai como data URL, e a escala pedida chega ao modelo.
        Assert.Contains("data:image/jpeg;base64,", handler.CorposEnviados[0]);
        Assert.Contains("\"scale\":2", handler.CorposEnviados[0]);
    }

    [Fact]
    public async Task Espera_a_predicao_sair_da_fila()
    {
        var handler = new HandlerDeUpscale()
            .Responde(HttpStatusCode.OK, new { status = "starting", urls = new { get = "https://exemplo/predicao/1" } })
            .Responde(HttpStatusCode.OK, new { status = "processing", urls = new { get = "https://exemplo/predicao/1" } })
            .Responde(HttpStatusCode.OK, new { status = "succeeded", output = new[] { "https://exemplo/ampliada.png" } })
            .RespondeImagem(Ampliada);

        var resultado = await Criar(handler).AmpliarAsync([9], "image/png", 2);

        Assert.Equal(Ampliada, resultado.Conteudo);
        // Saída em lista também é entendida — cada modelo devolve de um jeito.
        Assert.Contains(handler.UrlsChamadas, u => u.Contains("predicao/1"));
    }

    [Fact]
    public async Task Falha_do_modelo_vira_mensagem_pro_usuario()
    {
        var handler = new HandlerDeUpscale()
            .Responde(HttpStatusCode.OK, new { status = "failed", error = "imagem corrompida" });

        var erro = await Assert.ThrowsAsync<UpscaleIndisponivelException>(
            () => Criar(handler).AmpliarAsync([9], "image/png", 2));
        Assert.Contains("imagem corrompida", erro.Message);
    }

    [Fact]
    public async Task Chave_recusada_diz_o_que_houve()
    {
        var handler = new HandlerDeUpscale().Responde(HttpStatusCode.Unauthorized, new { detail = "no" });

        var erro = await Assert.ThrowsAsync<UpscaleIndisponivelException>(
            () => Criar(handler).AmpliarAsync([9], "image/png", 2));
        Assert.Contains("recusada", erro.Message);
    }

    [Fact]
    public async Task Imagem_grande_demais_nao_sai_do_servidor()
    {
        var handler = new HandlerDeUpscale();
        var options = Options.Create(new UpscaleOptions { ApiKey = "x", MaxUploadBytes = 10 });
        var upscaler = new ReplicateUpscaler(new HttpClient(handler), options, NullLogger<ReplicateUpscaler>.Instance);

        await Assert.ThrowsAsync<UpscaleIndisponivelException>(
            () => upscaler.AmpliarAsync(new byte[50], "image/png", 2));
        Assert.Empty(handler.UrlsChamadas);
    }

    [Theory]
    [InlineData("data:image/png;base64,AAECAwQ=", true)]
    [InlineData("data:image/jpeg;base64,AAECAwQ=", true)]
    // O que entra aqui é repassado a um serviço externo: só imagem que o editor
    // sabe desenhar passa.
    [InlineData("data:image/svg+xml;base64,AAECAwQ=", false)]
    [InlineData("data:text/html;base64,AAECAwQ=", false)]
    [InlineData("https://exemplo/foto.png", false)]
    [InlineData("data:image/png;base64,isso-nao-e-base64!!", false)]
    [InlineData("", false)]
    public void Só_data_url_de_imagem_é_aceita(string valor, bool esperado)
    {
        Assert.Equal(esperado, ImagemEndpoints.TentarLerDataUrl(valor, out _, out _));
    }
}

public class UpscaleErroDoModeloTests
{
    private static ReplicateUpscaler Criar(HandlerDeUpscale handler)
    {
        var options = Microsoft.Extensions.Options.Options.Create(
            new UpscaleOptions { ApiKey = "token-de-teste", TimeoutSegundos = 20 });
        return new ReplicateUpscaler(new HttpClient(handler), options,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<ReplicateUpscaler>.Instance);
    }

    [Fact]
    public async Task Foto_maior_que_a_GPU_vira_explicacao_util()
    {
        // Texto real devolvido pelo modelo quando a foto passa do que cabe na T4.
        var handler = new HandlerDeUpscale().Responde(HttpStatusCode.OK, new
        {
            status = "failed",
            error = "Input image of dimensions (4000, 1848, 3) has a total number of pixels 7392000 "
                + "greater than the max size that fits in GPU memory on this hardware, 2096704. "
                + "Resize input image and try again.",
        });

        var erro = await Assert.ThrowsAsync<UpscaleIndisponivelException>(
            () => Criar(handler).AmpliarAsync([9], "image/png", 2));

        // O usuário precisa saber o que fazer, não ler o traço do modelo.
        Assert.Contains("passa do tamanho", erro.Message);
        Assert.DoesNotContain("GPU memory", erro.Message);
    }

    [Fact]
    public async Task GPU_sem_memoria_pede_pra_tentar_menor()
    {
        // Texto real: a GPU é compartilhada, e o que cabe muda conforme a fila.
        var handler = new HandlerDeUpscale().Responde(HttpStatusCode.OK, new
        {
            status = "failed",
            error = "CUDA out of memory. Tried to allocate 3.96 GiB. GPU 0 has a total capacity of "
                + "14.56 GiB of which 3.81 GiB is free.",
        });

        var erro = await Assert.ThrowsAsync<UpscaleIndisponivelException>(
            () => Criar(handler).AmpliarAsync([9], "image/png", 2));

        // Sinaliza retentativa: a mesma foto menor costuma passar.
        Assert.True(erro.TentarMenor);
        Assert.Contains("sem memória", erro.Message);
        Assert.DoesNotContain("CUDA", erro.Message);
    }

    [Fact]
    public async Task Falha_que_nao_e_de_tamanho_nao_pede_retentativa()
    {
        var handler = new HandlerDeUpscale().Responde(HttpStatusCode.OK,
            new { status = "failed", error = "modelo indisponível" });

        var erro = await Assert.ThrowsAsync<UpscaleIndisponivelException>(
            () => Criar(handler).AmpliarAsync([9], "image/png", 2));

        Assert.False(erro.TentarMenor);
    }

    [Fact]
    public async Task Outra_falha_do_modelo_continua_aparecendo_como_veio()
    {
        var handler = new HandlerDeUpscale().Responde(HttpStatusCode.OK,
            new { status = "failed", error = "arquivo corrompido" });

        var erro = await Assert.ThrowsAsync<UpscaleIndisponivelException>(
            () => Criar(handler).AmpliarAsync([9], "image/png", 2));

        Assert.Contains("arquivo corrompido", erro.Message);
    }
}
