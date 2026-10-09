using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;

namespace Notas.Api.Services.Moldes;

/// <summary>
/// Baixa a imagem de um link colado no gerador de Moldes (o navegador não pode:
/// outro site bloqueia por CORS). Aceita link direto de imagem ou de página —
/// num pin do Pinterest, por exemplo, pega a imagem principal (og:image), na
/// maior resolução que o Pinterest servir.
///
/// É um servidor buscando URL que o usuário digita, então se protege de virar
/// ponte para a rede interna: só http/https nas portas padrão, e todo endereço
/// (inclusive os de redirecionamento) tem de resolver para IP público — a
/// conferência é repetida na hora de abrir a conexão (<see cref="ConectarSeguro"/>),
/// o que fecha a brecha de DNS que muda entre a checagem e o uso.
/// </summary>
public record ImagemBaixada(bool Ok, string? DataUrl, string? Motivo);

public interface IBaixadorDeImagem
{
    Task<ImagemBaixada> BaixarAsync(string url, CancellationToken ct = default);
}

/// <summary>Resolve nomes — separado pra os testes não dependerem de DNS.</summary>
public interface IResolvedorDeHost
{
    Task<IPAddress[]> ResolverAsync(string host, CancellationToken ct);
}

public class ResolvedorDns : IResolvedorDeHost
{
    public Task<IPAddress[]> ResolverAsync(string host, CancellationToken ct) => Dns.GetHostAddressesAsync(host, ct);
}

public partial class BaixadorDeImagem : IBaixadorDeImagem
{
    public const int MaxBytes = 12 * 1024 * 1024;
    private const int MaxRedirecionamentos = 4;
    private const int MaxHtmlBytes = 2 * 1024 * 1024;

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IResolvedorDeHost _resolvedor;
    private readonly ILogger<BaixadorDeImagem> _logger;

    public BaixadorDeImagem(IHttpClientFactory httpClientFactory, IResolvedorDeHost resolvedor, ILogger<BaixadorDeImagem> logger)
    {
        _httpClientFactory = httpClientFactory;
        _resolvedor = resolvedor;
        _logger = logger;
    }

    private static ImagemBaixada Falha(string motivo) => new(false, null, motivo);

    public async Task<ImagemBaixada> BaixarAsync(string url, CancellationToken ct = default)
    {
        if (!Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri)) return Falha("Isso não parece um link.");
        try
        {
            var primeira = await BuscarAsync(uri, aceitaPagina: true, ct);
            if (primeira.Falha is not null) return Falha(primeira.Falha);
            if (primeira.Imagem is not null) return primeira.Imagem;

            // página: a imagem principal dela
            var candidatas = ImagensDaPagina(primeira.Html!, primeira.UriFinal!);
            if (candidatas.Count == 0) return Falha("Não achei uma imagem nessa página. Abra a imagem e copie o link dela.");
            foreach (var candidata in candidatas)
            {
                var r = await BuscarAsync(candidata, aceitaPagina: false, ct);
                if (r.Imagem is not null) return r.Imagem;
            }
            return Falha("A página aponta para uma imagem que não consegui baixar.");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            return Falha("O site demorou demais para responder.");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Falha ao baixar imagem de {Host}", uri.Host);
            return Falha("Não consegui baixar a imagem desse link.");
        }
    }

    private sealed record Resposta(ImagemBaixada? Imagem, string? Html, Uri? UriFinal, string? Falha);

    private async Task<Resposta> BuscarAsync(Uri uri, bool aceitaPagina, CancellationToken ct)
    {
        var atual = uri;
        for (var salto = 0; salto <= MaxRedirecionamentos; salto++)
        {
            var problema = await ConferirAsync(atual, ct);
            if (problema is not null) return new Resposta(null, null, null, problema);

            using var request = new HttpRequestMessage(HttpMethod.Get, atual);
            // sites de imagem costumam recusar quem não se apresenta como navegador
            request.Headers.TryAddWithoutValidation("User-Agent",
                "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36");
            request.Headers.TryAddWithoutValidation("Accept", "image/avif,image/webp,image/png,image/jpeg,text/html;q=0.8,*/*;q=0.5");

            var http = _httpClientFactory.CreateClient(nameof(BaixadorDeImagem));
            using var resposta = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);

            if ((int)resposta.StatusCode is >= 300 and < 400 && resposta.Headers.Location is { } destino)
            {
                atual = destino.IsAbsoluteUri ? destino : new Uri(atual, destino);
                continue;
            }
            if (!resposta.IsSuccessStatusCode)
            {
                return new Resposta(null, null, null, $"O site respondeu {(int)resposta.StatusCode} para esse link.");
            }

            var bytes = await LerComLimiteAsync(resposta.Content, MaxBytes, ct);
            if (bytes is null) return new Resposta(null, null, null, "A imagem passa de 12 MB.");

            var tipo = TipoDaImagem(bytes);
            if (tipo is not null)
            {
                return new Resposta(new ImagemBaixada(true, $"data:{tipo};base64,{Convert.ToBase64String(bytes)}", null), null, atual, null);
            }
            var mime = resposta.Content.Headers.ContentType?.MediaType ?? "";
            if (aceitaPagina && mime.Contains("html", StringComparison.OrdinalIgnoreCase) && bytes.Length <= MaxHtmlBytes)
            {
                return new Resposta(null, System.Text.Encoding.UTF8.GetString(bytes), atual, null);
            }
            return new Resposta(null, null, null, "Esse link não é de uma imagem (PNG, JPG, WEBP ou GIF).");
        }
        return new Resposta(null, null, null, "O link redireciona vezes demais.");
    }

    /// <summary>Só http/https nas portas padrão, e o nome tem de resolver para IP público.</summary>
    private async Task<string?> ConferirAsync(Uri uri, CancellationToken ct)
    {
        if (uri.Scheme is not ("http" or "https")) return "Use um link que comece com http:// ou https://.";
        if (!uri.IsDefaultPort) return "Link com porta diferente da padrão não é aceito.";
        IPAddress[] enderecos;
        if (IPAddress.TryParse(uri.Host.Trim('[', ']'), out var ip)) enderecos = new[] { ip };
        else
        {
            try { enderecos = await _resolvedor.ResolverAsync(uri.IdnHost, ct); }
            catch (SocketException) { return "Não encontrei esse site."; }
        }
        if (enderecos.Length == 0) return "Não encontrei esse site.";
        return enderecos.All(EnderecoPublico) ? null : "Esse link aponta para um endereço interno e não é aceito.";
    }

    /// <summary>IP de internet de verdade: nada de loopback, rede privada,
    /// link-local (metadados de nuvem), multicast ou faixas reservadas.</summary>
    public static bool EnderecoPublico(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip) || ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any) || ip.Equals(IPAddress.None)) return false;
        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            return !(b[0] == 0 || b[0] == 10 || b[0] == 127
                || (b[0] == 100 && b[1] >= 64 && b[1] <= 127)      // CGNAT
                || (b[0] == 169 && b[1] == 254)                     // link-local / metadados
                || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
                || (b[0] == 192 && b[1] == 168)
                || (b[0] == 192 && b[1] == 0 && (b[2] == 0 || b[2] == 2))
                || (b[0] == 198 && (b[1] == 18 || b[1] == 19))
                || (b[0] == 198 && b[1] == 51 && b[2] == 100)
                || (b[0] == 203 && b[1] == 0 && b[2] == 113)
                || b[0] >= 224);                                    // multicast e reservados
        }
        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6Multicast) return false;
            var b = ip.GetAddressBytes();
            if ((b[0] & 0xfe) == 0xfc) return false;                // fc00::/7 (privado)
            return true;
        }
        return false;
    }

    /// <summary>Conexão que confere o IP de verdade, na hora de conectar.</summary>
    public static async ValueTask<Stream> ConectarSeguro(SocketsHttpConnectionContext ctx, CancellationToken ct)
    {
        var enderecos = await Dns.GetHostAddressesAsync(ctx.DnsEndPoint.Host, ct);
        var publico = enderecos.FirstOrDefault(EnderecoPublico)
            ?? throw new HttpRequestException("Endereço interno bloqueado.");
        if (enderecos.Any(e => !EnderecoPublico(e))) throw new HttpRequestException("Endereço interno bloqueado.");
        var socket = new Socket(publico.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(new IPEndPoint(publico, ctx.DnsEndPoint.Port), ct);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }

    private static async Task<byte[]?> LerComLimiteAsync(HttpContent conteudo, int limite, CancellationToken ct)
    {
        if (conteudo.Headers.ContentLength > limite) return null;
        await using var stream = await conteudo.ReadAsStreamAsync(ct);
        using var ms = new MemoryStream();
        var buffer = new byte[81920];
        int lido;
        while ((lido = await stream.ReadAsync(buffer, ct)) > 0)
        {
            if (ms.Length + lido > limite) return null;
            ms.Write(buffer, 0, lido);
        }
        return ms.ToArray();
    }

    /// <summary>Tipo pela assinatura do arquivo — o Content-Type do site não é confiável.</summary>
    public static string? TipoDaImagem(byte[] b)
    {
        if (b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return "image/png";
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return "image/jpeg";
        if (b.Length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') return "image/webp";
        if (b.Length >= 6 && b[0] == 'G' && b[1] == 'I' && b[2] == 'F' && b[3] == '8') return "image/gif";
        return null;
    }

    [GeneratedRegex("<meta\\s[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex MetaTag();

    [GeneratedRegex("(property|name|itemprop)\\s*=\\s*[\"']([^\"']+)[\"']", RegexOptions.IgnoreCase)]
    private static partial Regex MetaNome();

    [GeneratedRegex("content\\s*=\\s*[\"']([^\"']+)[\"']", RegexOptions.IgnoreCase)]
    private static partial Regex MetaConteudo();

    [GeneratedRegex("/(\\d+x\\d*|\\d+x)/", RegexOptions.IgnoreCase)]
    private static partial Regex TamanhoPinimg();

    /// <summary>Imagens anunciadas pela página (og:image, twitter:image), em
    /// ordem de preferência. No Pinterest, tenta antes a versão "originals".</summary>
    public static List<Uri> ImagensDaPagina(string html, Uri baseUri)
    {
        var achadas = new List<Uri>();
        foreach (Match tag in MetaTag().Matches(html))
        {
            var nome = MetaNome().Match(tag.Value);
            var conteudo = MetaConteudo().Match(tag.Value);
            if (!nome.Success || !conteudo.Success) continue;
            var chave = nome.Groups[2].Value.ToLowerInvariant();
            if (chave is not ("og:image" or "og:image:url" or "og:image:secure_url" or "twitter:image" or "twitter:image:src" or "image")) continue;
            var valor = WebUtility.HtmlDecode(conteudo.Groups[1].Value);
            if (Uri.TryCreate(baseUri, valor, out var u) && u.Scheme is "http" or "https" && !achadas.Contains(u)) achadas.Add(u);
        }
        var saida = new List<Uri>();
        foreach (var u in achadas)
        {
            if (u.Host.EndsWith("pinimg.com", StringComparison.OrdinalIgnoreCase) && TamanhoPinimg().IsMatch(u.AbsolutePath))
            {
                var original = new UriBuilder(u) { Path = TamanhoPinimg().Replace(u.AbsolutePath, "/originals/", 1) }.Uri;
                if (!saida.Contains(original)) saida.Add(original);
            }
            if (!saida.Contains(u)) saida.Add(u);
        }
        return saida;
    }
}
