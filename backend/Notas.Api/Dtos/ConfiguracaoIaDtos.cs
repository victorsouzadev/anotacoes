namespace Notas.Api.Dtos;

// PUT /api/configuracoes/ia
//
// `ChaveApi` ausente (null) significa "não mexer na chave já salva" — o cliente
// nunca recebe a chave de volta, então não teria como reenviá-la ao salvar
// apenas o modelo. String vazia significa "remover a chave".
// `ChaveUpscale` segue a mesma regra da `ChaveApi`: null mantém, vazio remove.
public record SalvarConfiguracaoIaRequest(string? Provedor, string? Modelo, string? ChaveApi, string? ChaveUpscale);

public record ModeloSugeridoResponse(string Id, string Nome, string Descricao, bool LeImagens);

// GET /api/configuracoes/ia
public record ConfiguracaoIaResponse(
    // O que o usuário escolheu (vazio = seguir o padrão do servidor).
    string Provedor,
    string? Modelo,

    // O que de fato vai ser usado, depois de combinar com o padrão do servidor.
    string ProvedorEfetivo,
    string ModeloEfetivo,
    bool SuportaAnexos,

    bool ChaveConfigurada,
    /// <summary>Algo como "sk-or-…a1b2". Nunca a chave inteira.</summary>
    string? ChaveMascarada,
    /// <summary>Verdadeiro quando a chave em uso é a do servidor, e não a do usuário.</summary>
    bool UsandoChaveDoServidor,

    List<ModeloSugeridoResponse> ModelosSugeridos,

    // Ampliação de imagem por IA (Editor de Imagens): outro serviço, outro token.
    bool ChaveUpscaleConfigurada,
    string? ChaveUpscaleMascarada,
    /// <summary>Verdadeiro quando quem amplia é a chave do servidor, e não a do usuário.</summary>
    bool UpscaleUsandoChaveDoServidor,
    /// <summary>Dá pra ampliar agora? Chave do usuário ou do servidor, qualquer uma.</summary>
    bool UpscaleDisponivel,

    DateTime? AtualizadoEm);

// POST /api/configuracoes/ia/testar
public record TestarConfiguracaoIaRequest(string? Provedor, string? Modelo, string? ChaveApi);

public record TestarConfiguracaoIaResponse(bool Ok, string Mensagem, string? Exemplo);
