namespace Notas.Api.Data;

// Configuração de IA de um usuário: qual provedor, qual modelo e a chave de API
// dele. Uma linha por usuário, no máximo.
//
// A chave fica cifrada (ver IProtetorDeSegredos) e nunca é devolvida ao cliente —
// só os últimos caracteres, para o usuário reconhecer qual chave está lá.
public class ConfiguracaoIa
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = "";

    /// <summary>"openrouter", "anthropic" ou vazio para seguir o padrão do servidor.</summary>
    public string Provedor { get; set; } = "";

    public string? ChaveApiCifrada { get; set; }

    /// <summary>Últimos caracteres da chave, em claro, só para exibição mascarada.</summary>
    public string? ChaveApiSufixo { get; set; }

    public string? Modelo { get; set; }

    public DateTime AtualizadoEm { get; set; } = DateTime.UtcNow;
}
