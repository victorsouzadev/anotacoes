namespace Notas.Api.Data;

/// <summary>
/// Projeto da ferramenta "Editor de Imagens": as artes importadas e todos os
/// parâmetros de contorno/corte/folha. Como nas notas, o conteúdo é um blob JSON
/// opaco para o servidor — quem conhece o formato é o frontend, então evoluir a
/// ferramenta não exige migration.
/// </summary>
public class ImageProject
{
    // Id é UUID gerado no cliente, como nas notas — deixa o PUT idempotente.
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Data { get; set; } = "{}";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}
