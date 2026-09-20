namespace Notas.Api.Services.Imagens;

public interface IImageUpscaler
{
    /// <summary>Está configurado? Sem chave, o recurso nem aparece pro usuário.</summary>
    bool Disponivel { get; }

    /// <summary>Devolve a imagem ampliada, já em bytes.</summary>
    Task<ImagemAmpliada> AmpliarAsync(byte[] imagem, string contentType, int escala, CancellationToken ct = default);
}

public record ImagemAmpliada(byte[] Conteudo, string ContentType);

/// <summary>
/// Falha que o usuário precisa ler: sem chave, arquivo grande demais, serviço
/// fora do ar ou demorando além do teto.
/// </summary>
public class UpscaleIndisponivelException(string mensagem) : Exception(mensagem);
