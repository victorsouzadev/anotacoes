using System.Text;
using System.Text.RegularExpressions;

namespace Hub.Core;

/// <summary>Uma nota markdown: frontmatter + corpo.</summary>
public sealed partial class NoteDocument
{
    public FrontMatter FrontMatter { get; }
    public string Body { get; set; }

    public NoteDocument(FrontMatter? frontMatter = null, string body = "")
    {
        FrontMatter = frontMatter ?? new FrontMatter();
        Body = body;
    }

    public static NoteDocument Parse(string text)
    {
        text = text.Replace("\r\n", "\n");
        if (text.Length > 0 && text[0] == '\uFEFF') text = text[1..];

        if (!text.StartsWith("---\n", StringComparison.Ordinal))
            return new NoteDocument(new FrontMatter(), text);

        var end = text.IndexOf("\n---", 3, StringComparison.Ordinal);
        while (end >= 0)
        {
            var after = end + 4;
            if (after == text.Length || text[after] == '\n')
            {
                var yaml = text[4..(end + 1)];
                var lines = yaml.Split('\n');
                var body = after >= text.Length ? "" : text[(after + 1)..];
                return new NoteDocument(FrontMatter.Parse(lines), body);
            }
            end = text.IndexOf("\n---", after, StringComparison.Ordinal);
        }

        return new NoteDocument(new FrontMatter(), text);
    }

    public override string ToString()
    {
        var sb = new StringBuilder();
        if (FrontMatter.Keys.Any())
        {
            sb.Append("---\n");
            FrontMatter.WriteTo(sb);
            sb.Append("---\n");
        }
        sb.Append(Body);
        if (!Body.EndsWith('\n')) sb.Append('\n');
        return sb.ToString();
    }

    /// <summary>Título: propriedade title, primeiro H1 ou nome do arquivo.</summary>
    public string ResolveTitle(string relativePath)
    {
        var title = FrontMatter.GetString("title");
        if (!string.IsNullOrWhiteSpace(title)) return title;

        var h1 = H1Regex().Match(Body);
        if (h1.Success) return h1.Groups[1].Value.Trim();

        return Path.GetFileNameWithoutExtension(relativePath);
    }

    /// <summary>Tags do frontmatter e #tags do corpo, sem o #.</summary>
    public List<string> ResolveTags()
    {
        var tags = FrontMatter.GetList("tags").Select(t => t.TrimStart('#'));
        var inline = InlineTagRegex().Matches(Body).Select(m => m.Groups[1].Value);
        return tags.Concat(inline).Where(t => t.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>Destinos de [[wikilinks]] no corpo e no frontmatter, sem alias nem âncora.</summary>
    public List<string> ResolveLinks()
    {
        var all = new List<string> { Body };
        foreach (var key in FrontMatter.Keys) all.AddRange(FrontMatter.GetList(key));

        return all
            .SelectMany(text => WikiLinkRegex().Matches(text).Select(m => m.Groups[1].Value.Trim()))
            .Where(l => l.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>Trecho de uma seção (pelo texto do heading), até o próximo heading de mesmo nível ou maior.</summary>
    public string? ExtractSection(string heading)
    {
        var lines = Body.Split('\n');
        var start = -1;
        var level = 0;
        for (var i = 0; i < lines.Length; i++)
        {
            var m = HeadingRegex().Match(lines[i]);
            if (!m.Success) continue;
            var lv = m.Groups[1].Value.Length;
            if (start < 0)
            {
                if (m.Groups[2].Value.Trim().Equals(heading.Trim(), StringComparison.OrdinalIgnoreCase))
                {
                    start = i;
                    level = lv;
                }
            }
            else if (lv <= level)
            {
                return string.Join('\n', lines[start..i]).TrimEnd();
            }
        }
        return start < 0 ? null : string.Join('\n', lines[start..]).TrimEnd();
    }

    [GeneratedRegex(@"^#\s+(.+)$", RegexOptions.Multiline)]
    private static partial Regex H1Regex();

    [GeneratedRegex(@"^(#{1,6})\s+(.+)$")]
    private static partial Regex HeadingRegex();

    [GeneratedRegex(@"(?<![\w&/#])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)")]
    private static partial Regex InlineTagRegex();

    [GeneratedRegex(@"!?\[\[([^\]\|#\^]+)(?:[#\^][^\]\|]*)?(?:\|[^\]]*)?\]\]")]
    private static partial Regex WikiLinkRegex();
}
