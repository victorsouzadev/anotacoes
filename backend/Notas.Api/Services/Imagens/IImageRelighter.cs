namespace Notas.Api.Services.Imagens;

/// <summary>
/// Reiluminação por IA. O que volta daqui NÃO é a foto final: é uma foto
/// parecida, com a luz que se queria — inclusive com o produto redesenhado.
/// Quem usa fica com a luz e descarta o resto (ver a transferência de luz no
/// cliente), então a resolução pequena basta e sai mais barata.
/// </summary>
public interface IImageRelighter
{
    bool Disponivel { get; }

    Task<ImagemAmpliada> ReiluminarAsync(
        byte[] imagem, string contentType, string direcao, CancellationToken ct = default);
}
