using System.Text.Json;
using System.Text.RegularExpressions;

namespace Hub.Plugin;

public record Tabelas(string Prefixo, List<string>? Legadas);

/// <summary>Manifesto do plug-in, contrato 1 (spec 029). O deployer do núcleo confere as mesmas regras.</summary>
/// <param name="Congelado">Plug-in sem evolução (spec 034): fica no ar na versão do plugins.lock; o hub mostra "congelado".</param>
public record Manifesto(
    string Id, string Nome, string Icone, string? Descricao, int Contrato, string Rota, int Porta, string Health,
    string? Mcp, List<string>? RotasLegadas, Tabelas Tabelas, bool UsaIa, List<string>? Dados, string? Android,
    bool Congelado = false)
{
    public const int ContratoConhecido = 1;

    public static readonly string[] RotasReservadas =
        ["/", "/api/auth", "/api/core", "/api/plugins", "/api/sistema", "/autorizar", "/.well-known", "/ops", "/sites"];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static Manifesto Ler(string caminho) =>
        JsonSerializer.Deserialize<Manifesto>(File.ReadAllText(caminho), Json)
        ?? throw new InvalidOperationException($"plugin.json vazio: {caminho}");

    private static bool Sobrepoe(string a, string b)
    {
        a = a.TrimEnd('/'); b = b.TrimEnd('/');
        if (a.Length == 0 || b.Length == 0) return a == b;
        return a == b || a.StartsWith(b + "/") || b.StartsWith(a + "/");
    }

    /// <summary>Problemas do manifesto; vazia quando ele segue o contrato.</summary>
    public IReadOnlyList<string> Problemas()
    {
        var p = new List<string>();
        if (!Regex.IsMatch(Id ?? "", "^[a-z][a-z0-9-]{1,30}$")) p.Add("id precisa seguir ^[a-z][a-z0-9-]{1,30}$");
        if (string.IsNullOrWhiteSpace(Nome)) p.Add("nome é obrigatório");
        if (string.IsNullOrWhiteSpace(Icone)) p.Add("icone é obrigatório");
        if (Contrato < ContratoConhecido - 1 || Contrato > ContratoConhecido) p.Add($"contrato precisa ser {ContratoConhecido - 1} ou {ContratoConhecido}");
        if (Rota != "/" + Id) p.Add("rota precisa ser /<id>");
        foreach (var r in new[] { Rota ?? "" }.Concat(RotasLegadas ?? []))
            if (RotasReservadas.Any(res => Sobrepoe(r, res))) p.Add($"rota {r} invade uma rota reservada do núcleo");
        if (Porta is < 1 or > 65535) p.Add("porta inválida");
        if (Health is null || !Health.StartsWith(Rota + "/")) p.Add("health precisa ficar sob <rota>/");
        if (Tabelas is null || !Regex.IsMatch(Tabelas.Prefixo ?? "", "^[a-z][a-z0-9]*_$") || Tabelas.Prefixo == "core_")
            p.Add("tabelas.prefixo inválido (ex.: dieta_; core_ é do núcleo)");
        return p;
    }
}
