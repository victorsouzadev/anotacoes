using System.Globalization;
using System.Text.RegularExpressions;

namespace Notas.Deployer;

public record MemoriaDoPlugin(string Id, int MemoriaMb, int LimiteMb);

/// <summary>Memória e conexões da VPS (spec 040, R8). Nulo = não deu para ler.</summary>
public record RecursosLidos(int? MemoriaTotalMb, int? MemoriaLivreMb, List<MemoriaDoPlugin>? Plugins, int? Conexoes, int? ConexoesMaximas);

public static partial class Recursos
{
    [GeneratedRegex(@"\A[0-9a-f]{7}\z")] private static partial Regex Versao();
    [GeneratedRegex(@"^(?<n>[0-9.]+)\s*(?<u>B|KiB|MiB|GiB)$")] private static partial Regex Tamanho();
    [GeneratedRegex(@"^(?<c>MemTotal|MemAvailable):\s+(?<k>\d+) kB", RegexOptions.Multiline)] private static partial Regex LinhaMem();

    /// <summary>A tag das imagens é o commit curto.</summary>
    public static bool VersaoValida(string v) => Versao().IsMatch(v);

    /// <summary>Nulo quando o registro recusou ou não respondeu: "denied" também aparece para pacote que não existe.</summary>
    public static bool? Publicada(Resultado r) =>
        r.Codigo == 0 ? true
        : r.Erro.Contains("no such manifest", StringComparison.OrdinalIgnoreCase)
          || r.Erro.Contains("manifest unknown", StringComparison.OrdinalIgnoreCase) ? false
        : null;

    public static List<string> ComandoStats() => ["stats", "--no-stream", "--format", "{{.Name}}\t{{.MemUsage}}"];

    public static List<string> ComandoConexoes(string container) => PreparoDoBanco.ComandoPsql(container, "postgres",
        "SELECT count(*), current_setting('max_connections') FROM pg_stat_activity WHERE backend_type = 'client backend'");

    public static RecursosLidos Montar(string meminfo, Resultado stats, Resultado pg)
    {
        var mem = LinhaMem().Matches(meminfo).ToDictionary(m => m.Groups["c"].Value,
            m => (int)(long.Parse(m.Groups["k"].Value, CultureInfo.InvariantCulture) / 1024));
        int? Mem(string c) => mem.TryGetValue(c, out var v) ? v : null;
        var con = pg.Codigo == 0 ? pg.Saida.Trim().Split('|') : [];
        int? Con(int i) => con.Length == 2 && int.TryParse(con[i], NumberStyles.None, CultureInfo.InvariantCulture, out var v) ? v : null;
        return new RecursosLidos(Mem("MemTotal"), Mem("MemAvailable"), stats.Codigo == 0 ? LerStats(stats.Saida) : null, Con(0), Con(1));
    }

    public static List<MemoriaDoPlugin> LerStats(string saida)
    {
        var l = new List<MemoriaDoPlugin>();
        foreach (var linha in saida.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var p = linha.Trim().Split('\t');
            if (p.Length != 2 || !p[0].StartsWith("plugin-", StringComparison.Ordinal)) continue;
            var uso = p[1].Split('/');
            if (uso.Length == 2 && Mb(uso[0]) is { } usado && Mb(uso[1]) is { } limite)
                l.Add(new MemoriaDoPlugin(p[0]["plugin-".Length..], usado, limite));
        }
        return l;
    }

    private static int? Mb(string t)
    {
        var m = Tamanho().Match(t.Trim());
        if (!m.Success || !double.TryParse(m.Groups["n"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var n)) return null;
        return (int)Math.Round(m.Groups["u"].Value switch { "GiB" => n * 1024, "MiB" => n, "KiB" => n / 1024, _ => n / 1048576 });
    }
}
