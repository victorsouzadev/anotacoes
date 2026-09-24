namespace Notas.Api.Services.Imagens;

/// <summary>
/// Remoção de fundo por IA: volta um PNG do mesmo enquadramento, com o fundo
/// transparente. Serve onde o balde de tinta não dá conta — cabelo, pelo,
/// fundo com textura ou degradê.
/// </summary>
public interface IBackgroundRemover
{
    bool Disponivel { get; }

    Task<ImagemAmpliada> RemoverFundoAsync(byte[] imagem, string contentType, CancellationToken ct = default);
}
