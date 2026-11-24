using System.Text.Json;
using System.Text.RegularExpressions;

namespace Hub.Plugin;

/// <summary>
/// Regras do <c>plugin.json</c> (contrato 1, spec 029). Única cópia: o deployer do núcleo, o SDK e o agente
/// (spec 039) usam estas mesmas regras.
/// </summary>
public static partial class RegrasDoManifesto
{
    /// <summary>Maior versão do contrato que o núcleo conhece; aceita também a anterior (spec 032).</summary>
    public const int ContratoAtual = 1;

    /// <summary>Rotas do núcleo que nenhum plug-in pode ocupar, nem por cima nem por baixo.</summary>
    public static readonly string[] Reservadas =
        ["/", "/api/auth", "/api/core", "/api/plugins", "/api/sistema", "/autorizar", "/.well-known", "/ops", "/sites",
            "/api/painel", "/plugins"];

    /// <summary>Ids que viram nome de papel e de schema no Postgres e já são do sistema (spec 040, R5).</summary>
    public static readonly string[] IdsReservados = ["postgres", "nucleo", "public", "hub", "information-schema"];

    /// <summary>Id no padrão e fora dos reservados: a conferência antes de qualquer uso do id no banco (spec 040).</summary>
    public static bool IdPermitido(string? id) =>
        id is not null && IdValido().IsMatch(id) && !id.EndsWith('\n') && !IdReservado(id);

    private static bool IdReservado(string id) => IdsReservados.Contains(id) || id.StartsWith("pg-", StringComparison.Ordinal);

    /// <summary>Tabelas do núcleo (prefixo <c>core_</c> e as de login) que plug-in nenhum declara.</summary>
    public static readonly string[] TabelasDoNucleo =
        ["users", "refresh_tokens", "__EFMigrationsHistory", "__EFMigrationsLock"];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [GeneratedRegex("^[a-z][a-z0-9-]{1,30}$")] private static partial Regex IdValido();
    [GeneratedRegex("^[a-z][a-z0-9]*_$")] private static partial Regex PrefixoValido();
    // Ponto vale (arquivos como /sw-cerebro.js, spec 033), mas não ".." nem segmento começando com ponto.
    [GeneratedRegex(@"^/[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)*(/[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)*)*$")] private static partial Regex RotaValida();
    [GeneratedRegex("^/data/[a-z][a-z0-9-]{0,30}$")] private static partial Regex DadoValido();

    /// <summary>Lê o manifesto de um texto JSON; nulo quando o JSON é inválido.</summary>
    public static Manifesto? LerJson(string json)
    {
        try { return JsonSerializer.Deserialize<Manifesto>(json, Json); }
        catch (JsonException) { return null; }
    }

    /// <summary>Rotas que o Caddy manda para o plug-in: a própria e as legadas.</summary>
    public static IEnumerable<string> TodasAsRotas(this Manifesto m) => new[] { m.Rota }.Concat(m.RotasLegadas ?? []);

    /// <summary>Rota a é igual a b, ou uma está dentro da outra (<c>/api</c> engloba <c>/api/auth</c>).</summary>
    public static bool Sobrepoe(string a, string b)
    {
        a = a.TrimEnd('/'); b = b.TrimEnd('/');
        if (a.Length == 0 || b.Length == 0) return a == b; // "/" só conflita com "/" (a raiz é o hub)
        return a == b || a.StartsWith(b + "/") || b.StartsWith(a + "/");
    }

    /// <summary>Problemas do manifesto sozinho e contra os já registrados. Vazio = pode subir.</summary>
    public static List<string> Validar(Manifesto? m, string idEsperado, IEnumerable<Manifesto> outros)
    {
        var p = new List<string>();
        if (m is null) return ["plugin.json ausente ou inválido"];
        if (m.Id != idEsperado) p.Add($"id do manifesto ({m.Id}) difere do plugins.lock ({idEsperado})");
        if (!IdValido().IsMatch(m.Id ?? "")) p.Add("id fora do padrão ^[a-z][a-z0-9-]{1,30}$");
        else if (IdReservado(m.Id!)) p.Add($"o id {m.Id} é reservado do sistema");
        if (string.IsNullOrWhiteSpace(m.Nome) || string.IsNullOrWhiteSpace(m.Icone)) p.Add("nome e icone são obrigatórios");
        if (m.Contrato > ContratoAtual || m.Contrato < ContratoAtual - 1)
            p.Add($"contrato {m.Contrato} não suportado (núcleo aceita {ContratoAtual - 1} e {ContratoAtual})");
        if (m.Rota != "/" + m.Id) p.Add($"rota precisa ser /{m.Id}");
        if (m.Porta is < 1 or > 65535) p.Add("porta inválida");
        if (string.IsNullOrEmpty(m.Health) || !m.Health.StartsWith(m.Rota + "/")) p.Add($"health precisa ficar sob {m.Rota}/");
        if (m.Mcp is { } mcp && !mcp.StartsWith(m.Rota + "/")) p.Add($"mcp precisa ficar sob {m.Rota}/");

        foreach (var r in m.TodasAsRotas())
        {
            foreach (var res in Reservadas)
                if (Sobrepoe(r ?? "", res)) p.Add($"rota {r} invade a rota reservada {res}");
            if (!RotaValida().IsMatch(r ?? "")) p.Add($"rota inválida: {r}");
        }

        // Pastas próprias, uma por nome, nunca o banco nem as chaves do núcleo (spec 030).
        foreach (var d in m.Dados ?? [])
            if (!DadoValido().IsMatch(d) || d is "/data/db" or "/data/core") p.Add($"dados inválido: {d} (use /data/<nome>, fora de db e core)");

        var prefixo = m.Tabelas?.Prefixo ?? "";
        if (!PrefixoValido().IsMatch(prefixo)) p.Add("tabelas.prefixo fora do padrão (ex.: dieta_)");
        if (prefixo == "core_") p.Add("o prefixo core_ é do núcleo");
        foreach (var t in m.Tabelas?.Legadas ?? [])
            if (TabelasDoNucleo.Contains(t, StringComparer.OrdinalIgnoreCase) || t.StartsWith("core_", StringComparison.OrdinalIgnoreCase))
                p.Add($"a tabela {t} é do núcleo");

        foreach (var o in outros.Where(o => o.Id != m.Id))
        {
            foreach (var r in m.TodasAsRotas())
                foreach (var ro in o.TodasAsRotas())
                    if (Sobrepoe(r, ro)) p.Add($"rota {r} sobrepõe {ro} do plug-in {o.Id}");
            var po = o.Tabelas?.Prefixo ?? "";
            if (prefixo.Length > 0 && po.Length > 0 && (prefixo.StartsWith(po) || po.StartsWith(prefixo)))
                p.Add($"prefixo {prefixo} sobrepõe {po} do plug-in {o.Id}");
            foreach (var t in (m.Tabelas?.Legadas ?? []).Intersect(o.Tabelas?.Legadas ?? [], StringComparer.OrdinalIgnoreCase))
                p.Add($"a tabela {t} já é do plug-in {o.Id}");
        }
        return p.Distinct().ToList();
    }
}
