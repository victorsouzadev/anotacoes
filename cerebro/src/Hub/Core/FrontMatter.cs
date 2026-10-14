using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Hub.Core;

/// <summary>
/// Frontmatter YAML no subconjunto que o Obsidian usa em Properties:
/// escalares, listas inline [a, b] e listas em bloco (- item).
/// Linhas que não entende são preservadas como estão, para nunca destruir
/// propriedades escritas por você ou por plugins.
/// </summary>
public sealed class FrontMatter
{
    private sealed class Entry
    {
        public string? Key;
        public object? Value;      // string, bool, List<string> ou null
        public List<string>? Raw;  // linhas originais não interpretadas
    }

    private readonly List<Entry> _entries = new();

    public IEnumerable<string> Keys => _entries.Where(e => e.Key is not null).Select(e => e.Key!);

    public bool Contains(string key) => Find(key) is not null;

    public string? GetString(string key) => Find(key)?.Value switch
    {
        null => null,
        string s => s,
        bool b => b ? "true" : "false",
        List<string> l => string.Join(", ", l),
        var o => o.ToString()
    };

    public bool GetBool(string key) => Find(key)?.Value switch
    {
        bool b => b,
        string s => s.Equals("true", StringComparison.OrdinalIgnoreCase) || s == "yes" || s == "sim",
        _ => false
    };

    public List<string> GetList(string key) => Find(key)?.Value switch
    {
        List<string> l => new List<string>(l),
        string s when !string.IsNullOrWhiteSpace(s) => new List<string> { s },
        _ => new List<string>()
    };

    /// <summary>Define ou cria a chave, preservando a posição se já existir.</summary>
    public FrontMatter Set(string key, object? value)
    {
        value = value switch
        {
            null => null,
            string or bool => value,
            IEnumerable<string> seq => seq.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().ToList(),
            DateTimeOffset dto => dto.ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture),
            _ => Convert.ToString(value, CultureInfo.InvariantCulture)
        };

        var existing = Find(key);
        if (existing is not null)
        {
            existing.Value = value;
            existing.Raw = null;
        }
        else
        {
            _entries.Add(new Entry { Key = key, Value = value });
        }
        return this;
    }

    public FrontMatter Remove(string key)
    {
        _entries.RemoveAll(e => e.Key == key);
        return this;
    }

    private Entry? Find(string key) => _entries.FirstOrDefault(e => e.Key == key);

    public static FrontMatter Parse(IReadOnlyList<string> lines)
    {
        var fm = new FrontMatter();
        Entry? current = null;

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line))
                continue;

            var trimmed = line.TrimStart();

            // Item de lista em bloco pertencente à última chave.
            if (trimmed.StartsWith("- ", StringComparison.Ordinal) || trimmed == "-")
            {
                if (current is { Raw: null } && (current.Value is null || current.Value is List<string>))
                {
                    var list = current.Value as List<string> ?? new List<string>();
                    var item = Unquote(StripComment(trimmed.Length > 1 ? trimmed[2..] : ""));
                    if (item.Length > 0) list.Add(item);
                    current.Value = list;
                    continue;
                }
                AppendRaw(fm, ref current, line);
                continue;
            }

            // Continuação de algo que não interpretamos (bloco | ou >, mapa aninhado...).
            if (line.StartsWith(' ') || line.StartsWith('\t'))
            {
                AppendRaw(fm, ref current, line);
                continue;
            }

            var colon = line.IndexOf(':');
            if (colon <= 0)
            {
                AppendRaw(fm, ref current, line);
                continue;
            }

            var key = line[..colon].Trim();
            var rest = StripComment(line[(colon + 1)..]).Trim();

            if (rest is "|" or ">" or "|-" or ">-")
            {
                current = new Entry { Key = key, Raw = new List<string> { line } };
                fm._entries.Add(current);
                continue;
            }

            current = new Entry { Key = key, Value = ParseScalarOrInlineList(rest) };
            fm._entries.Add(current);
        }

        return fm;
    }

    private static void AppendRaw(FrontMatter fm, ref Entry? current, string line)
    {
        if (current is not null)
        {
            if (current.Raw is null)
            {
                // Converte a entrada atual para "crua" preservando a forma original.
                current.Raw = new List<string>();
                var sb = new StringBuilder();
                WriteEntry(sb, current.Key!, current.Value);
                current.Raw.AddRange(sb.ToString().TrimEnd('\n').Split('\n'));
            }
            current.Raw.Add(line);
            return;
        }
        current = new Entry { Raw = new List<string> { line } };
        fm._entries.Add(current);
    }

    private static object? ParseScalarOrInlineList(string value)
    {
        if (value.Length == 0) return null;
        if (value.StartsWith('[') && value.EndsWith(']') && !value.StartsWith("[[", StringComparison.Ordinal))
        {
            var inner = value[1..^1];
            return SplitInlineList(inner).Select(Unquote).Where(s => s.Length > 0).ToList();
        }
        if (value is "true" or "True") return true;
        if (value is "false" or "False") return false;
        return Unquote(value);
    }

    private static IEnumerable<string> SplitInlineList(string inner)
    {
        var sb = new StringBuilder();
        char? quote = null;
        foreach (var ch in inner)
        {
            if (quote is null && (ch == '"' || ch == '\'')) quote = ch;
            else if (quote == ch) quote = null;

            if (ch == ',' && quote is null)
            {
                yield return sb.ToString().Trim();
                sb.Clear();
            }
            else sb.Append(ch);
        }
        if (sb.Length > 0) yield return sb.ToString().Trim();
    }

    private static string StripComment(string value)
    {
        // Remove " # comentário" fora de aspas.
        char? quote = null;
        for (var i = 0; i < value.Length; i++)
        {
            var ch = value[i];
            if (quote is null && (ch == '"' || ch == '\'')) quote = ch;
            else if (quote == ch) quote = null;
            else if (quote is null && ch == '#' && (i == 0 || char.IsWhiteSpace(value[i - 1])))
                return value[..i].TrimEnd();
        }
        return value;
    }

    internal static string Unquote(string value)
    {
        value = value.Trim();
        if (value.Length >= 2 && value[0] == '"' && value[^1] == '"')
        {
            try { return JsonSerializer.Deserialize<string>(value) ?? ""; }
            catch (JsonException) { return value[1..^1]; }
        }
        if (value.Length >= 2 && value[0] == '\'' && value[^1] == '\'')
            return value[1..^1].Replace("''", "'");
        return value;
    }

    public void WriteTo(StringBuilder sb)
    {
        foreach (var e in _entries)
        {
            if (e.Raw is not null)
            {
                foreach (var raw in e.Raw) sb.Append(raw).Append('\n');
                continue;
            }
            WriteEntry(sb, e.Key!, e.Value);
        }
    }

    private static void WriteEntry(StringBuilder sb, string key, object? value)
    {
        switch (value)
        {
            case null:
                sb.Append(key).Append(":\n");
                break;
            case bool b:
                sb.Append(key).Append(": ").Append(b ? "true" : "false").Append('\n');
                break;
            case List<string> { Count: 0 }:
                sb.Append(key).Append(": []\n");
                break;
            case List<string> list:
                sb.Append(key).Append(":\n");
                foreach (var item in list) sb.Append("  - ").Append(Quote(item)).Append('\n');
                break;
            default:
                sb.Append(key).Append(": ").Append(Quote(value.ToString() ?? "")).Append('\n');
                break;
        }
    }

    /// <summary>Coloca aspas só quando o YAML precisa (inclui [[wikilinks]]).</summary>
    internal static string Quote(string value)
    {
        if (value.Length == 0) return "\"\"";
        var needs =
            value != value.Trim() ||
            value.Contains(": ") || value.EndsWith(':') ||
            value.Contains(" #") || value.Contains('\n') || value.Contains('"') ||
            "[]{}#&*!|>'%@`,?-".Contains(value[0]) ||
            value is "true" or "false" or "null" or "~" or "yes" or "no";
        return needs ? JsonSerializer.Serialize(value, JsonOpts) : value;
    }

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };
}
