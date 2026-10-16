using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Hub.Core;
using Microsoft.Extensions.Options;

namespace Hub.Pipeline;

public sealed record ExtractedPage(string? Title, string Text);

/// <summary>Baixa uma página e extrai o texto legível. Bloqueia endereços internos (SSRF).</summary>
public sealed partial class LinkExtractor
{
    private const int MaxBytes = 2 * 1024 * 1024;
    private const int MaxChars = 20_000;
    private readonly IHttpClientFactory _http;

    public LinkExtractor(IHttpClientFactory http) => _http = http;

    public async Task<ExtractedPage?> ExtractAsync(string url, CancellationToken ct)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https"))
            return null;
        // O cliente "fetch" não segue redirects sozinho: cada salto é validado aqui.
        var client = _http.CreateClient("fetch");
        HttpResponseMessage? response = null;
        for (var hop = 0; ; hop++)
        {
            if (!await IsPublicHostAsync(uri, ct))
                throw new InvalidOperationException($"Endereço não permitido: {uri.Host}");

            response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, ct);
            var code = (int)response.StatusCode;
            if (code is >= 300 and < 400 && response.Headers.Location is { } location && hop < 5)
            {
                uri = location.IsAbsoluteUri ? location : new Uri(uri, location);
                response.Dispose();
                if (uri.Scheme != "http" && uri.Scheme != "https") return null;
                continue;
            }
            break;
        }

        using var _ = response;
        response.EnsureSuccessStatusCode();

        var mediaType = response.Content.Headers.ContentType?.MediaType ?? "";
        if (!mediaType.Contains("html") && !mediaType.StartsWith("text/", StringComparison.Ordinal))
            return new ExtractedPage(null, $"(conteúdo {mediaType} não extraído)");

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(chunk, ct)) > 0 && buffer.Length < MaxBytes)
            buffer.Write(chunk, 0, read);

        var charset = response.Content.Headers.ContentType?.CharSet;
        Encoding encoding;
        try { encoding = charset is null ? Encoding.UTF8 : Encoding.GetEncoding(charset.Trim('"')); }
        catch (ArgumentException) { encoding = Encoding.UTF8; }

        var html = encoding.GetString(buffer.ToArray());
        if (!mediaType.Contains("html")) return new ExtractedPage(null, Truncate(html));

        var title = TitleRegex().Match(html) is { Success: true } m ? WebUtility.HtmlDecode(m.Groups[1].Value).Trim() : null;
        return new ExtractedPage(title, Truncate(HtmlToText(html)));
    }

    internal static string HtmlToText(string html)
    {
        var s = DropBlocksRegex().Replace(html, " ");
        s = BlockTagRegex().Replace(s, "\n");
        s = TagRegex().Replace(s, " ");
        s = WebUtility.HtmlDecode(s);
        s = SpacesRegex().Replace(s, " ");
        s = BlankLinesRegex().Replace(s, "\n\n");
        return string.Join('\n', s.Split('\n').Select(l => l.Trim())).Trim();
    }

    private static string Truncate(string text) =>
        text.Length <= MaxChars ? text : text[..MaxChars] + "\n\n(… texto cortado)";

    private static async Task<bool> IsPublicHostAsync(Uri uri, CancellationToken ct)
    {
        IPAddress[] addresses;
        try { addresses = await Dns.GetHostAddressesAsync(uri.DnsSafeHost, ct); }
        catch (SocketException) { return false; }

        return addresses.Length > 0 && addresses.All(IsPublic);
    }

    private static bool IsPublic(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip) || ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6UniqueLocal) return false;
        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            return !(b[0] == 10 || b[0] == 127 || b[0] == 0 ||
                     (b[0] == 172 && b[1] >= 16 && b[1] <= 31) ||
                     (b[0] == 192 && b[1] == 168) ||
                     (b[0] == 169 && b[1] == 254) ||
                     (b[0] == 100 && b[1] >= 64 && b[1] <= 127));
        }
        return true;
    }

    [GeneratedRegex(@"<title[^>]*>(.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex TitleRegex();

    [GeneratedRegex(@"<(script|style|noscript|svg|nav|footer|header|form)\b[^>]*>.*?</\1>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex DropBlocksRegex();

    [GeneratedRegex(@"<(br|/p|/div|/h[1-6]|/li|/tr|/section|/article)\b[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex BlockTagRegex();

    [GeneratedRegex(@"<[^>]+>")]
    private static partial Regex TagRegex();

    [GeneratedRegex(@"[ \t\r\f\v]+")]
    private static partial Regex SpacesRegex();

    [GeneratedRegex(@"\n\s*\n+")]
    private static partial Regex BlankLinesRegex();
}

/// <summary>Transcreve áudio por uma API compatível com OpenAI (/audio/transcriptions).</summary>
public sealed class Transcriber
{
    private static readonly HashSet<string> AudioExtensions =
        new(StringComparer.OrdinalIgnoreCase) { ".ogg", ".oga", ".opus", ".mp3", ".m4a", ".wav", ".webm", ".mp4", ".mpeg", ".mpga", ".flac" };

    private readonly IHttpClientFactory _http;
    private readonly TranscriptionSettings _settings;

    public Transcriber(IHttpClientFactory http, TranscriptionSettings settings)
    {
        _http = http;
        _settings = settings;
    }

    /// <summary>Lido a cada uso: a chave pode mudar pela tela sem reiniciar.</summary>
    public bool Enabled => _settings.Resolve().Enabled;

    public static bool IsAudio(string path) => AudioExtensions.Contains(Path.GetExtension(path));

    public async Task<string> TranscribeAsync(string fullPath, CancellationToken ct)
    {
        var o = _settings.Resolve();
        var client = _http.CreateClient("transcribe");
        using var form = new MultipartFormDataContent();
        await using var file = File.OpenRead(fullPath);
        var fileContent = new StreamContent(file);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(fileContent, "file", Path.GetFileName(fullPath));
        form.Add(new StringContent(o.Model), "model");
        form.Add(new StringContent(o.Language), "language");
        form.Add(new StringContent("json"), "response_format");

        using var request = new HttpRequestMessage(HttpMethod.Post, o.BaseUrl.TrimEnd('/') + "/audio/transcriptions")
        {
            Content = form
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", o.ApiKey);

        using var response = await client.SendAsync(request, ct);
        var json = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Transcrição falhou ({(int)response.StatusCode}): {json}");

        return JsonNode.Parse(json)?["text"]?.GetValue<string>()?.Trim() ?? "";
    }
}
