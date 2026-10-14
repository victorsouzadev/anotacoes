using Microsoft.Extensions.Options;

namespace Hub.Core;

/// <summary>Hora local do usuário (o diário e os nomes de arquivo usam o fuso dele, não UTC).</summary>
public sealed class HubClock
{
    private readonly TimeZoneInfo _zone;

    public HubClock(IOptions<HubOptions> options)
    {
        try { _zone = TimeZoneInfo.FindSystemTimeZoneById(options.Value.TimeZone); }
        catch (Exception) { _zone = TimeZoneInfo.Utc; }
    }

    public DateTimeOffset Now => TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, _zone);

    public DateTimeOffset ToLocal(DateTimeOffset value) => TimeZoneInfo.ConvertTime(value, _zone);

    public DateOnly Today => DateOnly.FromDateTime(Now.DateTime);
}
