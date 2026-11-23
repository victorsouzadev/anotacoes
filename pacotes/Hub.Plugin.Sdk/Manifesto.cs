using System.Text.Json;

namespace Hub.Plugin;

public record Tabelas(string Prefixo, List<string>? Legadas);

/// <summary>Manifesto do plug-in, contrato 1 (spec 029). O deployer do núcleo confere as mesmas regras.</summary>
/// <param name="Congelado">Plug-in sem evolução (spec 034): fica no ar na versão do plugins.lock; o hub mostra "congelado".</param>
public record Manifesto(
    string Id, string Nome, string Icone, string? Descricao, int Contrato, string Rota, int Porta, string Health,
    string? Mcp, List<string>? RotasLegadas, Tabelas Tabelas, bool UsaIa, List<string>? Dados, string? Android,
    bool Congelado = false)
{
    public const int ContratoConhecido = RegrasDoManifesto.ContratoAtual;

    public static readonly string[] RotasReservadas = RegrasDoManifesto.Reservadas;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static Manifesto Ler(string caminho) =>
        JsonSerializer.Deserialize<Manifesto>(File.ReadAllText(caminho), Json)
        ?? throw new InvalidOperationException($"plugin.json vazio: {caminho}");

    /// <summary>Problemas do manifesto sozinho (as regras do deployer); vazia quando ele segue o contrato.</summary>
    public IReadOnlyList<string> Problemas() => RegrasDoManifesto.Validar(this, Id, []);
}
