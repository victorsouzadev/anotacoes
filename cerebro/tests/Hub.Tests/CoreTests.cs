using Hub.Api;
using Hub.Core;
using Hub.Index;
using Hub.Pipeline;
using System.Text.Json.Nodes;

namespace Hub.Tests;

public class FrontMatterTests
{
    [Fact]
    public void Parses_scalars_inline_and_block_lists()
    {
        var doc = NoteDocument.Parse("""
            ---
            title: "Reunião: GPPv2"
            status: inbox   # comentário
            approve: true
            tags: [ideia, "trabalho"]
            aliases:
              - gpp
              - "gpp v2"
            ---
            # Corpo
            """);

        Assert.Equal("Reunião: GPPv2", doc.FrontMatter.GetString("title"));
        Assert.Equal("inbox", doc.FrontMatter.GetString("status"));
        Assert.True(doc.FrontMatter.GetBool("approve"));
        Assert.Equal(new[] { "ideia", "trabalho" }, doc.FrontMatter.GetList("tags"));
        Assert.Equal(new[] { "gpp", "gpp v2" }, doc.FrontMatter.GetList("aliases"));
        Assert.Equal("# Corpo", doc.Body.Trim());
    }

    [Fact]
    public void Round_trip_quotes_wikilinks_and_keeps_unknown_blocks()
    {
        var text = """
            ---
            descricao: |
              linha 1
              linha 2
            suggested_links: []
            ---
            texto
            """;
        var doc = NoteDocument.Parse(text);
        doc.FrontMatter.Set("suggested_links", new List<string> { "[[GPPv2]]" });

        var output = doc.ToString();
        Assert.Contains("descricao: |\n  linha 1\n  linha 2\n", output);
        Assert.Contains("  - \"[[GPPv2]]\"", output);

        var again = NoteDocument.Parse(output);
        Assert.Equal(new[] { "[[GPPv2]]" }, again.FrontMatter.GetList("suggested_links"));
    }

    [Fact]
    public void Note_without_frontmatter_is_all_body()
    {
        var doc = NoteDocument.Parse("só texto\n");
        Assert.Empty(doc.FrontMatter.Keys);
        Assert.Equal("só texto\n", doc.ToString());
    }

    [Fact]
    public void Resolves_title_tags_and_links()
    {
        var doc = NoteDocument.Parse("""
            ---
            tags: [projeto]
            ---
            # Plano do hub

            Ver [[GPPv2|o sistema]] e [[Pessoas/Pedro#Contato]]. #ideia #2026 #ia/llm
            """);

        Assert.Equal("Plano do hub", doc.ResolveTitle("10-Projetos/x.md"));
        Assert.Equal(new[] { "projeto", "ideia", "ia/llm" }, doc.ResolveTags());
        Assert.Equal(new[] { "GPPv2", "Pessoas/Pedro" }, doc.ResolveLinks());
    }

    [Fact]
    public void Extracts_section_until_next_heading_of_same_level()
    {
        var doc = NoteDocument.Parse("# T\n\n## A\nx\n### A1\ny\n## B\nz\n");
        Assert.Equal("## A\nx\n### A1\ny", doc.ExtractSection("A"));
        Assert.Null(doc.ExtractSection("C"));
    }
}

public class VaultLayoutTests
{
    [Theory]
    [InlineData("../etc/passwd")]
    [InlineData("10-Projetos/../../x.md")]
    [InlineData(".obsidian/app.json")]
    [InlineData("00-Inbox/.hidden.md")]
    [InlineData("")]
    public void Rejects_paths_outside_or_hidden(string path) =>
        Assert.Throws<VaultAccessException>(() => VaultLayout.NormalizeRelative(path));

    [Fact]
    public void Normalizes_separators() =>
        Assert.Equal("10-Projetos/GPP/nota.md", VaultLayout.NormalizeRelative("\\10-Projetos\\GPP\\nota.md/"));

    [Fact]
    public void Write_rules()
    {
        Assert.True(VaultLayout.CanCreate("00-Inbox/a.md"));
        Assert.True(VaultLayout.CanCreate("_sistema/ai/a.md"));
        Assert.False(VaultLayout.CanCreate("10-Projetos/a.md"));
        Assert.True(VaultLayout.CanAppend("01-Diario/2026-10-13.md"));
        Assert.False(VaultLayout.CanReplace("20-Areas/a.md"));
        Assert.True(VaultLayout.IsPermanentTarget("20-Areas/Saude"));
        Assert.False(VaultLayout.IsPermanentTarget("00-Inbox"));
    }

    [Fact]
    public void Safe_names_and_slugs()
    {
        Assert.Equal("Reunião GPP v2 notas", VaultLayout.SafeFileName("Reunião: GPP/v2 [notas]"));
        Assert.Equal("reuniao-gpp-v2", VaultLayout.Slug("Reunião GPP v2!"));
    }
}

public class SearchExpressionTests
{
    [Fact]
    public void Builds_safe_prefix_query()
    {
        Assert.Equal("\"reuni\"* \"gpp\"*", NoteIndex.BuildMatchExpression("reuni \"gpp\" OR"[..^3]));
        Assert.Null(NoteIndex.BuildMatchExpression("  ** ( ) "));
    }

    [Fact]
    public void Link_targets_are_normalized() =>
        Assert.Equal("pessoas/pedro", NoteIndex.NormalizeLinkTarget("Pessoas/Pedro.md"));
}

public class ExtractionTests
{
    [Fact]
    public void Html_to_text_drops_scripts_and_tags()
    {
        var text = LinkExtractor.HtmlToText("<html><script>x()</script><h1>Título</h1><p>Olá &amp; mundo</p></html>");
        Assert.Equal("Título\nOlá & mundo", text);
    }

    [Fact]
    public void Webhook_fields_are_found_by_path()
    {
        var json = JsonNode.Parse("""{"data":{"key":{"id":"ABC"},"message":{"text":"oi"}}}""")!;
        Assert.Equal("oi", Endpoints.FirstString(json, "text", "data.message.text"));
        Assert.Equal("ABC", Endpoints.FirstString(json, "id", "data.key.id"));
    }
}
