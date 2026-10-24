using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Notas.Api.Services.Estudio;

public sealed record Sondagem(int? Largura, int? Altura, double? DuracaoSeg, bool TemAudio, bool TemVideo);

/// <summary>
/// O ffmpeg do servidor (ou o que o desktop leva junto): miniaturas, medidas de vídeo, quadros,
/// troca de fundo e a montagem do editor de vídeo. Sem ffmpeg, só as miniaturas e as montagens
/// deixam de existir; as gerações continuam.
/// </summary>
public sealed class Ffmpeg(IOptions<EstudioOptions> options, ILogger<Ffmpeg> log)
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    private bool? _disponivel;

    public bool Disponivel
    {
        get
        {
            if (_disponivel is { } d) return d;
            try
            {
                var (codigo, _) = Rodar(options.Value.Ffmpeg, ["-hide_banner", "-version"], TimeSpan.FromSeconds(10), CancellationToken.None).GetAwaiter().GetResult();
                _disponivel = codigo == 0;
            }
            catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException or FileNotFoundException)
            {
                _disponivel = false;
            }
            if (_disponivel == false) log.LogWarning("Estúdio: ffmpeg não encontrado em '{Ffmpeg}'; sem miniaturas nem montagem de vídeo", options.Value.Ffmpeg);
            return _disponivel.Value;
        }
    }

    public async Task<Sondagem?> Sondar(string arquivo, CancellationToken ct)
    {
        if (!Disponivel) return null;
        try
        {
            var (codigo, saida) = await Rodar(options.Value.Ffprobe,
                ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", arquivo], TimeSpan.FromSeconds(30), ct);
            if (codigo != 0) return null;
            using var doc = JsonDocument.Parse(saida);
            int? w = null, h = null;
            bool audio = false, video = false;
            double? dur = null;
            foreach (var s in doc.RootElement.TryGetProperty("streams", out var ss) ? ss.EnumerateArray() : default)
            {
                var tipo = s.TryGetProperty("codec_type", out var t) ? t.GetString() : null;
                if (tipo == "video" && !video)
                {
                    video = true;
                    if (s.TryGetProperty("width", out var wi)) w = wi.GetInt32();
                    if (s.TryGetProperty("height", out var he)) h = he.GetInt32();
                }
                if (tipo == "audio") audio = true;
            }
            if (doc.RootElement.TryGetProperty("format", out var f) && f.TryGetProperty("duration", out var d) &&
                double.TryParse(d.GetString(), NumberStyles.Float, Inv, out var dd))
                dur = dd;
            return new Sondagem(w, h, dur, audio, video);
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            log.LogDebug(e, "ffprobe falhou em {Arquivo}", arquivo);
            return null;
        }
    }

    /// <summary>Miniatura JPEG de 320 px de largura (imagem ou primeiro segundo do vídeo), em data URL.</summary>
    public async Task<string?> Miniatura(string arquivo, bool video, CancellationToken ct)
    {
        if (!Disponivel) return null;
        var saida = Path.Combine(Path.GetTempPath(), $"thumb-{Guid.NewGuid():N}.jpg");
        try
        {
            var args = new List<string> { "-hide_banner", "-loglevel", "error", "-y" };
            if (video) args.AddRange(["-ss", "0.5"]);
            args.AddRange(["-i", arquivo, "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "5", saida]);
            var (codigo, _) = await Rodar(options.Value.Ffmpeg, args, TimeSpan.FromSeconds(60), ct);
            if ((codigo != 0 || !File.Exists(saida)) && video)
            {
                // Vídeo com menos de meio segundo: tenta o primeiro quadro.
                args.Remove("-ss"); args.Remove("0.5");
                (codigo, _) = await Rodar(options.Value.Ffmpeg, args, TimeSpan.FromSeconds(60), ct);
            }
            if (codigo != 0 || !File.Exists(saida)) return null;
            return "data:image/jpeg;base64," + Convert.ToBase64String(await File.ReadAllBytesAsync(saida, ct));
        }
        finally
        {
            if (File.Exists(saida)) File.Delete(saida);
        }
    }

    /// <summary>Quadros PNG do vídeo nos instantes pedidos (segundos).</summary>
    public async Task<List<string>> ExtrairQuadros(string video, IReadOnlyList<double> tempos, string pasta, CancellationToken ct)
    {
        Exigir();
        var arquivos = new List<string>();
        foreach (var (t, i) in tempos.Select((t, i) => (t, i)))
        {
            var saida = Path.Combine(pasta, $"quadro-{i:000}.png");
            var (codigo, erro) = await Rodar(options.Value.Ffmpeg,
                ["-hide_banner", "-loglevel", "error", "-y", "-ss", t.ToString("0.###", Inv), "-i", video, "-frames:v", "1", saida],
                TimeSpan.FromMinutes(2), ct);
            if (codigo != 0 || !File.Exists(saida)) throw new ErroDoEstudio($"Não consegui tirar o quadro de {t:0.##} s: {Resumo(erro)}");
            arquivos.Add(saida);
        }
        return arquivos;
    }

    /// <summary>
    /// Põe o vídeo sem fundo (com transparência) sobre a imagem nova, mantendo o áudio do vídeo
    /// original quando houver.
    /// </summary>
    public async Task SobreporFundo(string videoSemFundo, string imagemFundo, string? videoOriginal, string saida, CancellationToken ct)
    {
        Exigir();
        var s = await Sondar(videoSemFundo, ct);
        var w = Par(s?.Largura ?? 1280);
        var h = Par(s?.Altura ?? 720);
        var origemAudio = videoOriginal is not null && (await Sondar(videoOriginal, ct))?.TemAudio == true;
        var args = new List<string> { "-hide_banner", "-loglevel", "error", "-y" };
        // O decodificador nativo do VP9 descarta o canal alfa; o libvpx o preserva.
        if (videoSemFundo.EndsWith(".webm", StringComparison.OrdinalIgnoreCase)) args.AddRange(["-c:v", "libvpx-vp9"]);
        args.AddRange(["-i", videoSemFundo, "-loop", "1", "-i", imagemFundo]);
        if (origemAudio) args.AddRange(["-i", videoOriginal!]);
        args.AddRange([
            "-filter_complex",
            $"[1:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1[bg];[0:v]scale={w}:{h},format=rgba[fg];[bg][fg]overlay=shortest=1,format=yuv420p[v]",
            "-map", "[v]",
        ]);
        if (origemAudio) args.AddRange(["-map", "2:a:0", "-c:a", "aac", "-b:a", "192k", "-shortest"]);
        args.AddRange(["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", saida]);
        var (codigo, erro) = await Rodar(options.Value.Ffmpeg, args, TimeSpan.FromMinutes(20), ct);
        if (codigo != 0) throw new ErroDoEstudio("O ffmpeg não conseguiu juntar o vídeo ao fundo: " + Resumo(erro));
    }

    /// <summary>Monta o vídeo da linha do tempo num MP4 H.264.</summary>
    public async Task Montar(Montagem montagem, string saida, CancellationToken ct)
    {
        Exigir();
        var args = new List<string> { "-hide_banner", "-loglevel", "error", "-y" };
        args.AddRange(ArgumentosDeMontagem(montagem));
        args.Add(saida);
        var limite = TimeSpan.FromMinutes(Math.Clamp(montagem.Clipes.Sum(c => c.Duracao) / 10 + 5, 5, 60));
        var (codigo, erro) = await Rodar(options.Value.Ffmpeg, args, limite, ct);
        if (codigo != 0) throw new ErroDoEstudio("O ffmpeg não conseguiu montar o vídeo: " + Resumo(erro));
    }

    /// <summary>Entradas e filtros do ffmpeg para a montagem — separado para ser testado sem rodar o ffmpeg.</summary>
    public static List<string> ArgumentosDeMontagem(Montagem m)
    {
        if (m.Clipes.Count == 0) throw new ErroDoEstudio("A linha do tempo está vazia.");
        var w = Par(m.Largura);
        var h = Par(m.Altura);
        var fps = Math.Clamp(m.Fps, 12, 60);
        var args = new List<string>();
        var filtros = new StringBuilder();
        var concat = new StringBuilder();
        var entrada = 0;

        foreach (var (c, i) in m.Clipes.Select((c, i) => (c, i)))
        {
            var dur = Math.Max(0.1, c.Duracao);
            if (c.Imagem)
            {
                args.AddRange(["-loop", "1", "-t", F(dur), "-i", c.Arquivo]);
                filtros.Append($"[{entrada}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps={fps},format=yuv420p,trim=duration={F(dur)},setpts=PTS-STARTPTS");
            }
            else
            {
                args.AddRange(["-i", c.Arquivo]);
                filtros.Append($"[{entrada}:v]trim=start={F(c.Inicio)}:duration={F(dur)},setpts=PTS-STARTPTS,scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps={fps},format=yuv420p");
            }
            if (c.FadeIn > 0) filtros.Append($",fade=t=in:st=0:d={F(Math.Min(c.FadeIn, dur))}");
            if (c.FadeOut > 0) filtros.Append($",fade=t=out:st={F(Math.Max(0, dur - c.FadeOut))}:d={F(Math.Min(c.FadeOut, dur))}");
            filtros.Append($"[v{i}];");

            if (!c.Imagem && c.TemAudio && c.Volume > 0)
            {
                filtros.Append($"[{entrada}:a]atrim=start={F(c.Inicio)}:duration={F(dur)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume={F(c.Volume)}");
                if (c.FadeIn > 0) filtros.Append($",afade=t=in:st=0:d={F(Math.Min(c.FadeIn, dur))}");
                if (c.FadeOut > 0) filtros.Append($",afade=t=out:st={F(Math.Max(0, dur - c.FadeOut))}:d={F(Math.Min(c.FadeOut, dur))}");
                filtros.Append($"[a{i}];");
            }
            else
            {
                filtros.Append($"anullsrc=r=48000:cl=stereo,atrim=duration={F(dur)}[a{i}];");
            }
            concat.Append($"[v{i}][a{i}]");
            entrada++;
        }
        filtros.Append($"{concat}concat=n={m.Clipes.Count}:v=1:a=1[vcat][acat]");

        var trilhas = new List<string>();
        foreach (var (a, j) in m.Audios.Select((a, j) => (a, j)))
        {
            args.AddRange(["-i", a.Arquivo]);
            var atraso = (long)Math.Round(Math.Max(0, a.Posicao) * 1000);
            filtros.Append($";[{entrada}:a]atrim=start={F(a.Inicio)}:duration={F(Math.Max(0.1, a.Duracao))},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume={F(a.Volume)}");
            if (a.FadeIn > 0) filtros.Append($",afade=t=in:st=0:d={F(a.FadeIn)}");
            if (a.FadeOut > 0) filtros.Append($",afade=t=out:st={F(Math.Max(0, a.Duracao - a.FadeOut))}:d={F(a.FadeOut)}");
            filtros.Append($",adelay={atraso}|{atraso}[m{j}]");
            trilhas.Add($"[m{j}]");
            entrada++;
        }
        var audioFinal = "[acat]";
        if (trilhas.Count > 0)
        {
            filtros.Append($";[acat]{string.Concat(trilhas)}amix=inputs={trilhas.Count + 1}:duration=first:normalize=0[aout]");
            audioFinal = "[aout]";
        }

        args.AddRange(["-filter_complex", filtros.ToString(), "-map", "[vcat]", "-map", audioFinal,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", fps.ToString(Inv),
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]);
        return args;
    }

    private void Exigir()
    {
        if (!Disponivel) throw new ErroDoEstudio("O ffmpeg não está instalado neste servidor.");
    }

    private static int Par(int v) => Math.Clamp(v - v % 2, 16, 4096);
    private static string F(double v) => v.ToString("0.###", Inv);
    private static string Resumo(string erro) => erro.Length > 400 ? erro[^400..] : erro;

    private static async Task<(int Codigo, string Saida)> Rodar(string exe, IEnumerable<string> argumentos, TimeSpan limite, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(exe)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var a in argumentos) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi) ?? throw new InvalidOperationException($"Não consegui iniciar {exe}.");
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(limite);
        var saida = p.StandardOutput.ReadToEndAsync(cts.Token);
        var erro = p.StandardError.ReadToEndAsync(cts.Token);
        try
        {
            await p.WaitForExitAsync(cts.Token);
        }
        catch (OperationCanceledException)
        {
            try { p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            if (ct.IsCancellationRequested) throw;
            throw new ErroDoEstudio($"O ffmpeg passou de {limite.TotalMinutes:0} minutos e foi interrompido.");
        }
        var textoSaida = await saida;
        var textoErro = await erro;
        return (p.ExitCode, p.ExitCode == 0 ? textoSaida : textoErro + textoSaida);
    }
}

/// <summary>Linha do tempo já resolvida para arquivos em disco.</summary>
public sealed record Montagem(int Largura, int Altura, int Fps, List<ClipeMontagem> Clipes, List<AudioMontagem> Audios);

public sealed record ClipeMontagem(string Arquivo, bool Imagem, double Inicio, double Duracao, double Volume, bool TemAudio, double FadeIn, double FadeOut);

public sealed record AudioMontagem(string Arquivo, double Inicio, double Duracao, double Posicao, double Volume, double FadeIn, double FadeOut);
