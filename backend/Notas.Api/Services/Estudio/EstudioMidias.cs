using Microsoft.Extensions.Options;
using Notas.Api.Data;

namespace Notas.Api.Services.Estudio;

/// <summary>Entrada e saída de arquivos do Estúdio: gravar, medir, miniatura e enviar ao provedor.</summary>
public sealed class EstudioMidias(
    AppDbContext db, EstudioArmazenamento arm, Ffmpeg ff, FalCliente fal, IOptions<EstudioOptions> options, ILogger<EstudioMidias> log)
{
    private static readonly Dictionary<string, string> TiposPorExtensao = new(StringComparer.OrdinalIgnoreCase)
    {
        [".png"] = "image/png", [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".webp"] = "image/webp", [".gif"] = "image/gif",
        [".avif"] = "image/avif", [".heic"] = "image/heic", [".bmp"] = "image/bmp", [".svg"] = "image/svg+xml",
        [".mp4"] = "video/mp4", [".webm"] = "video/webm", [".mov"] = "video/quicktime", [".mkv"] = "video/x-matroska", [".m4v"] = "video/mp4",
        [".mp3"] = "audio/mpeg", [".wav"] = "audio/wav", [".ogg"] = "audio/ogg", [".m4a"] = "audio/mp4", [".flac"] = "audio/flac", [".aac"] = "audio/aac", [".opus"] = "audio/opus",
        [".glb"] = "model/gltf-binary", [".gltf"] = "model/gltf+json", [".obj"] = "model/obj", [".fbx"] = "application/octet-stream",
        [".usdz"] = "model/vnd.usdz+zip", [".stl"] = "model/stl",
        [".ply"] = "application/octet-stream", [".spz"] = "application/octet-stream", [".splat"] = "application/octet-stream", [".ksplat"] = "application/octet-stream",
        [".zip"] = "application/zip",
        // Documentos dos craft apps.
        [".pdf"] = "application/pdf",
        [".xlsx"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        [".docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        [".pptx"] = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        [".odt"] = "application/vnd.oasis.opendocument.text", [".rtf"] = "application/rtf",
        [".md"] = "text/markdown", [".txt"] = "text/plain", [".csv"] = "text/csv", [".html"] = "text/html", [".json"] = "application/json",
        [".dxf"] = "image/vnd.dxf", [".dwg"] = "image/vnd.dwg",
        [".psd"] = "image/vnd.adobe.photoshop", [".psb"] = "image/vnd.adobe.photoshop",
        [".tif"] = "image/tiff", [".tiff"] = "image/tiff", [".exr"] = "image/x-exr",
        [".dng"] = "image/x-adobe-dng", [".cr2"] = "image/x-canon-cr2", [".nef"] = "image/x-nikon-nef", [".arw"] = "image/x-sony-arw",
        [".raf"] = "image/x-fuji-raf", [".rw2"] = "image/x-panasonic-rw2", [".pef"] = "image/x-pentax-pef", [".orf"] = "image/x-olympus-orf",
        [".mid"] = "audio/midi", [".midi"] = "audio/midi", [".lottie"] = "application/zip", [".srt"] = "text/plain", [".vtt"] = "text/vtt",
    };

    /// <summary>Arquivos que os navegadores (e o ffmpeg) não mostram como imagem: ficam como documento do app que os abre.</summary>
    private static readonly HashSet<string> ImagensDocumento =
        [".psd", ".psb", ".dxf", ".dwg", ".exr", ".dng", ".cr2", ".nef", ".arw", ".raf", ".rw2", ".pef", ".orf", ".tif", ".tiff"];

    private static readonly HashSet<string> Extensoes3d = [".glb", ".gltf", ".obj", ".fbx", ".usdz", ".stl"];
    private static readonly HashSet<string> ExtensoesSplat = [".ply", ".spz", ".splat", ".ksplat"];

    public static string TipoDe(string contentType, string extensao)
    {
        var ext = extensao.ToLowerInvariant();
        if (Extensoes3d.Contains(ext)) return "modelo3d";
        if (ExtensoesSplat.Contains(ext)) return "mundo";
        if (ImagensDocumento.Contains(ext)) return "documento";
        if (contentType.StartsWith("image/")) return "imagem";
        if (contentType.StartsWith("video/")) return "video";
        if (contentType.StartsWith("audio/")) return "audio";
        if (contentType.StartsWith("model/")) return "modelo3d";
        return "documento";
    }

    public static string ExtensaoDe(string? contentType, string? nomeOuUrl)
    {
        if (!string.IsNullOrEmpty(nomeOuUrl))
        {
            var caminho = Uri.TryCreate(nomeOuUrl, UriKind.Absolute, out var u) ? u.AbsolutePath : nomeOuUrl;
            var ext = Path.GetExtension(caminho);
            if (ext.Length is > 1 and <= 7 && TiposPorExtensao.ContainsKey(ext)) return ext.ToLowerInvariant();
            // Formato próprio de um craft app (projeto do FilmCraft, documento do VectorCraft…): mantém a extensão.
            if (ext.Length is > 1 and <= 10 && ext.Skip(1).All(char.IsAsciiLetterOrDigit)) return ext.ToLowerInvariant();
        }
        if (!string.IsNullOrEmpty(contentType))
        {
            var porTipo = TiposPorExtensao.FirstOrDefault(kv => string.Equals(kv.Value, contentType, StringComparison.OrdinalIgnoreCase)).Key;
            if (porTipo is not null) return porTipo;
        }
        return ".bin";
    }

    public static string ContentTypeDe(string extensao) =>
        TiposPorExtensao.GetValueOrDefault(extensao, "application/octet-stream");

    /// <summary>Grava o arquivo, mede (ffprobe), faz a miniatura e registra a mídia.</summary>
    public async Task<EstudioMidia> Importar(string userId, Stream conteudo, string? contentType, string nome, string origem,
        Action<EstudioMidia>? preencher, CancellationToken ct)
    {
        var ext = ExtensaoDe(contentType, nome);
        var tipoConteudo = ext == ".bin" ? contentType ?? "application/octet-stream" : ContentTypeDe(ext);
        if (tipoConteudo == "application/octet-stream" && !string.IsNullOrEmpty(contentType)) tipoConteudo = contentType;
        var id = Guid.NewGuid().ToString("N");
        var rel = arm.NovoCaminho(userId, id, ext);
        var tamanho = await arm.Gravar(rel, conteudo, options.Value.MaxUploadBytes, ct);

        var midia = new EstudioMidia
        {
            Id = id,
            UserId = userId,
            Tipo = TipoDe(tipoConteudo, ext),
            Nome = NomeLimpo(nome, ext),
            ContentType = tipoConteudo,
            Arquivo = rel,
            Tamanho = tamanho,
            Origem = origem,
        };
        preencher?.Invoke(midia);
        await Medir(midia, ct);
        db.EstudioMidias.Add(midia);
        await db.SaveChangesAsync(ct);
        return midia;
    }

    /// <summary>Baixa um arquivo público (resultado do provedor) e registra como mídia.</summary>
    public async Task<EstudioMidia> ImportarDeUrl(string userId, string url, string? nome, string origem,
        Action<EstudioMidia>? preencher, CancellationToken ct)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            throw new ErroDoEstudio("Só baixo arquivos de endereços https.");
        var (conteudo, contentType, resposta) = await fal.Baixar(url, ct);
        using (resposta)
        await using (conteudo)
        {
            var ext = ExtensaoDe(contentType, url);
            var nomeFinal = string.IsNullOrWhiteSpace(nome) ? Path.GetFileName(uri.AbsolutePath) : nome + ext;
            return await Importar(userId, conteudo, contentType, nomeFinal, origem, preencher, ct);
        }
    }

    /// <summary>Medidas e miniatura (quando o ffmpeg existe). Falhas aqui não impedem a mídia de existir.</summary>
    public async Task Medir(EstudioMidia m, CancellationToken ct)
    {
        if (m.Tipo is not ("imagem" or "video" or "audio")) return;
        var abs = arm.Absoluto(m.Arquivo);
        try
        {
            if (await ff.Sondar(abs, ct) is { } s)
            {
                m.Largura = s.Largura;
                m.Altura = s.Altura;
                if (m.Tipo != "imagem") m.DuracaoSeg = s.DuracaoSeg;
            }
            if (m.Tipo is "imagem" or "video" && m.Thumb is null && m.ContentType != "image/svg+xml")
                m.Thumb = await ff.Miniatura(abs, m.Tipo == "video", ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogWarning(e, "Estúdio: não consegui medir {Arquivo}", m.Arquivo);
        }
    }

    /// <summary>
    /// URL que o fal consegue baixar. Sobe para o armazenamento do fal uma vez e guarda o endereço;
    /// se o upload falhar, imagens pequenas vão como data URL (o fal aceita nos campos de arquivo).
    /// </summary>
    public async Task<string> UrlParaFal(EstudioMidia m, string chave, CancellationToken ct)
    {
        if (m.FalUrl is { } cache && m.FalUrlEm > DateTime.UtcNow.AddHours(-20)) return cache;
        var abs = arm.Absoluto(m.Arquivo);
        try
        {
            await using var arquivo = File.OpenRead(abs);
            m.FalUrl = await fal.SubirArquivo(chave, arquivo, m.ContentType, Path.GetFileName(abs), ct);
            m.FalUrlEm = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return m.FalUrl;
        }
        catch (ErroDoProvedor e) when (m.Tamanho <= 12 * 1024 * 1024)
        {
            log.LogWarning("Estúdio: upload ao fal falhou ({Erro}); indo como data URL", e.Message);
            return $"data:{m.ContentType};base64,{Convert.ToBase64String(await File.ReadAllBytesAsync(abs, ct))}";
        }
    }

    public void ApagarArquivo(EstudioMidia m) => arm.Apagar(m.Arquivo);

    private static string NomeLimpo(string nome, string ext)
    {
        var n = Path.GetFileName(string.IsNullOrWhiteSpace(nome) ? "arquivo" + ext : nome.Trim());
        n = string.Concat(n.Where(c => !char.IsControl(c) && c is not ('/' or '\\')));
        if (n.Length > 200) n = n[..200];
        return n.Length == 0 ? "arquivo" + ext : n;
    }
}
