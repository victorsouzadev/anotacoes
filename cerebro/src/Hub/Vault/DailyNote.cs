using System.Globalization;
using Hub.Core;

namespace Hub.Vault;

/// <summary>Nota diária (01-Diario/AAAA-MM-DD.md). O hub só anexa linhas ao fim.</summary>
public static class DailyNote
{
    public static NoteDocument Create(DateOnly date)
    {
        var fm = new FrontMatter()
            .Set("type", "daily")
            .Set("date", date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture))
            .Set("tags", new List<string> { "diario" });
        var title = date.ToString("dddd, dd 'de' MMMM 'de' yyyy", new CultureInfo("pt-BR"));
        return new NoteDocument(fm, $"# {char.ToUpper(title[0])}{title[1..]}\n\n");
    }

    public static string Entry(HubClock clock, string text, string? source = null)
    {
        var clean = text.Replace("\r\n", "\n").Trim().Replace("\n", "\n  ");
        var tag = string.IsNullOrWhiteSpace(source) ? "" : $" ({source})";
        return $"- {clock.Now:HH:mm}{tag} {clean}";
    }

    public static Task AppendAsync(VaultStore vault, HubClock clock, string text, DateOnly? date, string? source, CancellationToken ct)
    {
        var day = date ?? clock.Today;
        return vault.AppendAsync(VaultLayout.DailyPath(day), Entry(clock, text, source), () => Create(day), "diário", ct);
    }
}
