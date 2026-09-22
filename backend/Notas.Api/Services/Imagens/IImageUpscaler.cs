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
/// <param name="tentarMenor">
/// Verdadeiro quando a mesma foto, menor, tem chance de passar — é o caso da
/// GPU sem memória, que depende de quem mais está usando o serviço na hora.
/// Insistir igual só repetiria a falha; insistir menor costuma resolver.
/// </param>
public class UpscaleIndisponivelException(string mensagem, bool tentarMenor = false) : Exception(mensagem)
{
    public bool TentarMenor { get; } = tentarMenor;
}
