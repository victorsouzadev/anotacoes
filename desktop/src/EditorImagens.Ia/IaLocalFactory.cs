using Notas.Api.Services.Imagens;

namespace EditorImagens.Ia;

/// <summary>
/// As IAs do editor rodando no próprio PC, no lugar dos serviços da internet:
/// o backend continua chamando a mesma fábrica, e ela entrega os modelos
/// locais. A luz por IA fica de fora — é um modelo de difusão pesado demais
/// pra valer a pena aqui.
/// </summary>
public sealed class IaLocalFactory(ModelosLocais modelos) : IUpscalerFactory
{
    public Task<UpscaleEfetivo> ResolverAsync(string userId, CancellationToken ct = default) =>
        Task.FromResult(new UpscaleEfetivo(modelos.TemAmpliacao || modelos.TemRecorte, true, Luz: false));

    public Task<IImageUpscaler> CriarAsync(string userId, CancellationToken ct = default) =>
        Task.FromResult<IImageUpscaler>(new AmpliadorLocal(modelos));

    public Task<IImageRelighter> CriarRelighterAsync(string userId, CancellationToken ct = default) =>
        Task.FromResult<IImageRelighter>(new SemLuz());

    public Task<IBackgroundRemover> CriarRemovedorDeFundoAsync(string userId, CancellationToken ct = default) =>
        Task.FromResult<IBackgroundRemover>(new RemovedorLocal(modelos));

    /// <summary>Uma inferência de cada vez: a GPU é uma só e a memória de vídeo, curta.</summary>
    internal static readonly SemaphoreSlim Fila = new(1, 1);
}

internal sealed class AmpliadorLocal(ModelosLocais modelos) : IImageUpscaler
{
    public bool Disponivel => modelos.TemAmpliacao;

    public async Task<ImagemAmpliada> AmpliarAsync(byte[] imagem, string contentType, int escala, CancellationToken ct = default)
    {
        var sessao = modelos.Ampliacao ?? throw new UpscaleIndisponivelException("O modelo de ampliação não está instalado.");
        await IaLocalFactory.Fila.WaitAsync(ct);
        try
        {
            var png = await Task.Run(() => Ampliacao.Executar(sessao, imagem, escala), ct);
            return new ImagemAmpliada(png, "image/png");
        }
        catch (InvalidDataException)
        {
            throw new UpscaleIndisponivelException("Não consegui ler essa imagem.");
        }
        finally
        {
            IaLocalFactory.Fila.Release();
        }
    }
}

internal sealed class RemovedorLocal(ModelosLocais modelos) : IBackgroundRemover
{
    public bool Disponivel => modelos.TemRecorte;

    public async Task<ImagemAmpliada> RemoverFundoAsync(byte[] imagem, string contentType, CancellationToken ct = default)
    {
        var sessao = modelos.Recorte ?? throw new UpscaleIndisponivelException("O modelo de recorte não está instalado.");
        await IaLocalFactory.Fila.WaitAsync(ct);
        try
        {
            var png = await Task.Run(() => Recorte.Executar(sessao, imagem), ct);
            return new ImagemAmpliada(png, "image/png");
        }
        catch (InvalidDataException)
        {
            throw new UpscaleIndisponivelException("Não consegui ler essa imagem.");
        }
        finally
        {
            IaLocalFactory.Fila.Release();
        }
    }
}

internal sealed class SemLuz : IImageRelighter
{
    public bool Disponivel => false;

    public Task<ImagemAmpliada> ReiluminarAsync(byte[] imagem, string contentType, string direcao, CancellationToken ct = default) =>
        throw new UpscaleIndisponivelException("A luz por IA não está disponível na versão desktop.");
}
