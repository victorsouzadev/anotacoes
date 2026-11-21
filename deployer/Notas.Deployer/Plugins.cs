using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Notas.Deployer;

/// <summary>Linha do <c>plugins.lock</c>: <c>id: imagem@versão</c>. Comentada = desligado (spec 029).</summary>
public record EntradaLock(string Id, string Imagem, string Versao, bool Ativo)
{
    public string Referencia => $"{Imagem}:{Versao}";
}

public record TabelasManifesto(string Prefixo, List<string>? Legadas);

/// <summary><c>plugin.json</c>, contrato 1 (specs/029-nucleo-plugins/contracts/plugin-manifesto.md).</summary>
public record Manifesto(
    string Id, string Nome, string Icone, string? Descricao, int Contrato, string Rota, int Porta, string Health,
    string? Mcp, List<string>? RotasLegadas, TabelasManifesto Tabelas, bool UsaIa, List<string>? Dados, string? Android)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static Manifesto? Ler(string json)
    {
        try { return JsonSerializer.Deserialize<Manifesto>(json, Json); }
        catch (JsonException) { return null; }
    }

    /// <summary>Rotas que o Caddy manda para o plug-in: a própria e as legadas.</summary>
    public IEnumerable<string> TodasAsRotas() => new[] { Rota }.Concat(RotasLegadas ?? []);
}

public static partial class Plugins
{
    /// <summary>Maior versão do contrato que este núcleo conhece; aceita também a anterior (spec 032).</summary>
    public const int ContratoAtual = 1;

    /// <summary>Rotas do núcleo que nenhum plug-in pode ocupar, nem por cima nem por baixo.</summary>
    public static readonly string[] Reservadas =
        ["/", "/api/auth", "/api/core", "/api/plugins", "/api/sistema", "/autorizar", "/.well-known", "/ops", "/sites"];

    /// <summary>Tabelas do núcleo (prefixo <c>core_</c> e as de login) que plug-in nenhum declara.</summary>
    public static readonly string[] TabelasDoNucleo =
        ["users", "refresh_tokens", "__EFMigrationsHistory", "__EFMigrationsLock"];

    [GeneratedRegex("^[a-z][a-z0-9-]{1,30}$")] private static partial Regex IdValido();
    [GeneratedRegex("^[a-z][a-z0-9]*_$")] private static partial Regex PrefixoValido();
    // Ponto vale (arquivos como /sw-cerebro.js, spec 033), mas não ".." nem segmento começando com ponto.
    [GeneratedRegex(@"^/[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)*(/[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)*)*$")] private static partial Regex RotaValida();
    [GeneratedRegex("^/data/[a-z][a-z0-9-]{0,30}$")] private static partial Regex DadoValido();
    [GeneratedRegex(@"^(?<id>[a-z][a-z0-9-]*)\s*:\s*(?<img>[a-z0-9./_-]+)@(?<ver>[A-Za-z0-9._-]+)$")] private static partial Regex LinhaLock();

    public static List<EntradaLock> LerLock(string texto)
    {
        var lista = new List<EntradaLock>();
        foreach (var bruta in texto.Split('\n'))
        {
            var linha = bruta.Trim();
            var ativo = true;
            if (linha.StartsWith('#'))
            {
                ativo = false;
                linha = linha.TrimStart('#').Trim();
            }
            var semComentario = linha.Split('#', 2)[0].Trim();
            var m = LinhaLock().Match(semComentario);
            if (!m.Success) continue;
            lista.Add(new EntradaLock(m.Groups["id"].Value, m.Groups["img"].Value, m.Groups["ver"].Value, ativo));
        }
        // Uma linha ativa ganha de uma comentada com o mesmo id; ids ativos repetidos: vale a primeira.
        return lista.GroupBy(e => e.Id).Select(g => g.FirstOrDefault(e => e.Ativo) ?? g.First()).ToList();
    }

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
                if (Sobrepoe(r, res)) p.Add($"rota {r} invade a rota reservada {res}");
            if (!RotaValida().IsMatch(r)) p.Add($"rota inválida: {r}");
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

    /// <summary>A tabela pertence ao plug-in (prefixo, legadas ou o histórico de migração dele).</summary>
    public static bool EDoPlugin(Manifesto m, string tabela) =>
        tabela.StartsWith(m.Tabelas.Prefixo, StringComparison.OrdinalIgnoreCase)
        || (m.Tabelas.Legadas ?? []).Contains(tabela, StringComparer.OrdinalIgnoreCase)
        || tabela.Equals("__EFMigrationsHistory_" + m.Id, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Tabelas fora do plug-in cujo esquema mudou (criadas, apagadas ou alteradas) entre os dois retratos de
    /// <c>sqlite_master</c> (spec 031). O <c>__EFMigrationsLock</c> é compartilhado e fica de fora.
    /// </summary>
    public static List<string> MudancasForaDoDono(Manifesto m, IReadOnlyDictionary<string, string> antes,
        IReadOnlyDictionary<string, string> depois)
    {
        bool Ignorar(string t) => EDoPlugin(m, t) || t.Equals("__EFMigrationsLock", StringComparison.OrdinalIgnoreCase)
                                  || t.StartsWith("sqlite_", StringComparison.OrdinalIgnoreCase);
        return antes.Keys.Union(depois.Keys)
            .Select(chave => (chave, tabela: chave.Split(':', 2)[^1]))
            .Where(x => !Ignorar(TabelaDe(x.chave, antes, depois)))
            .Where(x => antes.GetValueOrDefault(x.chave) != depois.GetValueOrDefault(x.chave))
            .Select(x => TabelaDe(x.chave, antes, depois))
            .Distinct().Order().ToList();
    }

    // Chave do retrato: "tipo:nome"; o valor é "tabela\u001fsql". A tabela dona de índice/gatilho é a tbl_name.
    private static string TabelaDe(string chave, IReadOnlyDictionary<string, string> a, IReadOnlyDictionary<string, string> d) =>
        (a.GetValueOrDefault(chave) ?? d.GetValueOrDefault(chave) ?? "").Split('\u001f', 2)[0];

    /// <summary>Trecho do Caddy do plug-in (importado de <c>plugins.d/*.caddy</c>): rotas sem reescrever o caminho.</summary>
    public static string GerarCaddy(Manifesto m)
    {
        var sb = new StringBuilder($"# Gerado pelo deployer para o plug-in {m.Id}. Não edite à mão.\n");
        foreach (var r in m.TodasAsRotas())
        {
            foreach (var caminho in new[] { r, r + "/*" })
            {
                sb.Append($"handle {caminho} {{\n");
                sb.Append($"    reverse_proxy {NomeContainer(m.Id)}:{m.Porta} {{\n        flush_interval -1\n");
                sb.Append("        header_up X-Forwarded-Proto {http.request.header.X-Forwarded-Proto}\n    }\n}\n");
            }
        }
        return sb.ToString();
    }

    public static string NomeContainer(string id) => "plugin-" + id;
}
