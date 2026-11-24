using System.Text;
using System.Text.RegularExpressions;

namespace Notas.Deployer;

/// <summary>Linha do <c>plugins.lock</c>: <c>id: imagem@versão</c>. Comentada = desligado (spec 029).</summary>
public record EntradaLock(string Id, string Imagem, string Versao, bool Ativo)
{
    public string Referencia => $"{Imagem}:{Versao}";
}

public static partial class Plugins
{
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

    /// <summary>Regras do manifesto: ficam no SDK (<see cref="RegrasDoManifesto"/>), a mesma cópia do agente (spec 039).</summary>
    public static List<string> Validar(Manifesto? m, string idEsperado, IEnumerable<Manifesto> outros) =>
        RegrasDoManifesto.Validar(m, idEsperado, outros);

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
