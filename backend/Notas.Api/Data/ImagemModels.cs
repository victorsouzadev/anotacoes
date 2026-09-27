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

/// <summary>
/// Item da biblioteca do Editor de Imagens: arte que o usuário guardou pra
/// reusar em outros projetos (um adesivo pronto, uma logo sem fundo, um
/// recorte). A imagem vem em data URL, junto com uma miniatura pra lista não
/// precisar baixar tudo.
/// </summary>
public class ImageLibraryItem
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Name { get; set; } = "";
    /// <summary>De onde veio (corte, molde, social, ilustracao) — só pra exibir.</summary>
    public string Origin { get; set; } = "";
    public string Data { get; set; } = "";
    public string Thumb { get; set; } = "";
    public double WidthMm { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// Preferências do Editor de Imagens que valem pra conta inteira (não pra um
/// projeto), como as anotações de material da máquina de corte. JSON opaco,
/// um registro por usuário.
/// </summary>
public class ImagePreferences
{
    public string UserId { get; set; } = "";
    public string Data { get; set; } = "{}";
    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// Modelo de post do modo Redes sociais criado pelo usuário: um post salvo pra
/// servir de ponto de partida (formato, fundo, espaço da foto e camadas). Pode
/// substituir um modelo que já vem no editor — aí <see cref="Replaces"/> guarda
/// o id do original e a galeria mostra este no lugar dele. O conteúdo é JSON
/// opaco pro servidor, como nos projetos.
/// </summary>
public class ImageSocialTemplate
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Name { get; set; } = "";
    /// <summary>Story, Feed ou Carrossel — só pra agrupar na galeria.</summary>
    public string Group { get; set; } = "";
    /// <summary>Id do modelo do editor que este substitui (vazio = modelo novo).</summary>
    public string Replaces { get; set; } = "";
    public string Data { get; set; } = "{}";
    public string Thumb { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
