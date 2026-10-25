using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Notas.Api.Data;

namespace Notas.Api.Services.Estudio;

/// <summary>
/// Leva uma geração da fila ao resultado: sobe as entradas, envia ao provedor, consulta,
/// baixa o que voltou para a biblioteca e roda as etapas locais (ffmpeg). Um por escopo.
/// </summary>
public sealed class EstudioProcessador(
    AppDbContext db, Catalogo catalogo, EstudioGeracoes geracoes, EstudioMidias midias, EstudioArmazenamento arm,
    FalCliente fal, WorldLabsCliente worldLabs, Ffmpeg ff, IOptions<EstudioOptions> options, ILogger<EstudioProcessador> log)
{
    private static readonly TimeSpan PrazoMaximo = TimeSpan.FromHours(3);
    private const int MaxTentativas = 6;

    // ---------- envio ----------

    public async Task Submeter(EstudioJob job, CancellationToken ct)
    {
        try
        {
            var (modelo, op) = catalogo.Resolver(job.ModeloId, job.Operacao);
            var chaves = await geracoes.Chaves(job.UserId, ct);
            var entradas = await Entradas(job, ct);
            job.Mensagem = "Enviando ao provedor";
            job.AtualizadoEm = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);

            if (modelo.Provedor == "worldlabs")
            {
                var chave = chaves.WorldLabs ?? throw new ErroDoEstudio("Sem chave da World Labs.");
                (byte[], string)? imagem = null;
                if (entradas.TryGetValue("imagem", out var img) && img.Count > 0)
                    imagem = (await File.ReadAllBytesAsync(arm.Absoluto(img[0].Arquivo), ct), Path.GetExtension(img[0].Arquivo));
                var parametros = JsonNode.Parse(job.Parametros)?.AsObject() ?? [];
                job.RequestId = await worldLabs.Gerar(chave, op.Endpoint, (string?)parametros["prompt"], imagem, ct);
            }
            else
            {
                var chave = chaves.Fal ?? throw new ErroDoEstudio("Sem chave do fal.ai.");
                var urls = new Dictionary<string, List<string>>();
                foreach (var (k, lista) in entradas.Where(kv => Catalogo.ChavesDeMidia.Contains(kv.Key)))
                {
                    var l = new List<string>();
                    foreach (var m in lista) l.Add(await midias.UrlParaFal(m, chave, ct));
                    urls[k] = l;
                }
                var corpo = Catalogo.MontarEntrada(op, JsonNode.Parse(job.Parametros)?.AsObject() ?? [], urls);
                var fila = await fal.Enfileirar(chave, op.Endpoint, corpo, ct);
                job.RequestId = fila.RequestId;
                job.StatusUrl = fila.StatusUrl;
                job.ResponseUrl = fila.ResponseUrl;
                job.CancelUrl = fila.CancelUrl;
                job.PosicaoFila = fila.Posicao;
            }
            job.Status = "rodando";
            job.Mensagem = "Na fila do provedor";
            job.Tentativas = 0;
            job.ProximaConsulta = DateTime.UtcNow.AddSeconds(options.Value.ConsultaSegundos);
            job.AtualizadoEm = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
        }
        catch (Exception e) when (e is ErroDoEstudio or ErroDoProvedor)
        {
            await Reagendar(job, e, ct);
        }
    }

    // ---------- consulta ----------

    public async Task Consultar(EstudioJob job, CancellationToken ct)
    {
        if (DateTime.UtcNow - job.CriadoEm > PrazoMaximo)
        {
            await Falhar(job, "O provedor não terminou em 3 horas; dei a geração por perdida.", ct);
            return;
        }
        try
        {
            var chaves = await geracoes.Chaves(job.UserId, ct);
            if (job.Provedor == "worldlabs")
            {
                var pronto = await worldLabs.Consultar(chaves.WorldLabs ?? throw new ErroDoEstudio("Sem chave da World Labs."), job.RequestId!, ct);
                if (pronto is null)
                {
                    await Aguardar(job, "Gerando o mundo", null, ct);
                    return;
                }
                await ConcluirMundo(job, pronto, ct);
                return;
            }

            var chave = chaves.Fal ?? throw new ErroDoEstudio("Sem chave do fal.ai.");
            var status = await fal.Status(chave, job.StatusUrl!, ct);
            if (status.Status != "COMPLETED")
            {
                var msg = status.Status == "IN_PROGRESS" ? "Gerando" : status.Posicao is { } p ? $"Na fila do provedor (posição {p + 1})" : "Na fila do provedor";
                await Aguardar(job, string.IsNullOrWhiteSpace(status.UltimoLog) ? msg : $"{msg} — {Curto(status.UltimoLog)}", status.Posicao, ct);
                return;
            }

            job.Mensagem = "Baixando o resultado";
            await db.SaveChangesAsync(ct);
            var resultado = await fal.Resultado(chave, job.ResponseUrl!, ct);
            var modelo = catalogo.Modelo(job.ModeloId);
            var urls = UrlsDoResultado(resultado, modelo?.Tipo ?? "");
            if (urls.Count == 0) throw new ErroDoProvedor("O provedor terminou sem devolver arquivo.", true);

            var prompt = (string?)JsonNode.Parse(job.Parametros)?["prompt"];
            var ids = new List<string>();
            foreach (var (url, i) in urls.Select((u, i) => (u, i)))
            {
                var m = await midias.ImportarDeUrl(job.UserId, url, NomeDoResultado(modelo, prompt, i, urls.Count), "geracao",
                    x => { x.JobId = job.Id; x.ModeloId = job.ModeloId; x.Prompt = Curto(prompt, 2000); }, ct);
                ids.Add(m.Id);
            }

            if (job.Pipeline == "trocar-fundo") ids = await TrocarFundo(job, ids, ct);
            await Concluir(job, ids, ct);
        }
        catch (Exception e) when (e is ErroDoEstudio or ErroDoProvedor)
        {
            await Reagendar(job, e, ct);
        }
    }

    // ---------- operações locais ----------

    public async Task ExecutarLocal(EstudioJob job, CancellationToken ct)
    {
        job.Status = "rodando";
        job.Mensagem = job.Operacao == "montar" ? "Montando o vídeo" : "Tirando os quadros";
        job.AtualizadoEm = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        var temp = arm.PastaTemporaria();
        try
        {
            var entradas = await Entradas(job, ct);
            var parametros = JsonNode.Parse(job.Parametros)?.AsObject() ?? [];
            var ids = new List<string>();
            if (job.Operacao == "quadros")
            {
                var video = entradas.GetValueOrDefault("video")?.FirstOrDefault() ?? throw new ErroDoEstudio("Falta o vídeo.");
                var tempos = Tempos(parametros, video.DuracaoSeg ?? 0);
                var arquivos = await ff.ExtrairQuadros(arm.Absoluto(video.Arquivo), tempos, temp, ct);
                var baseNome = Path.GetFileNameWithoutExtension(video.Nome);
                foreach (var (arquivo, i) in arquivos.Select((a, i) => (a, i)))
                {
                    await using var f = File.OpenRead(arquivo);
                    var m = await midias.Importar(job.UserId, f, "image/png", $"{baseNome}-{tempos[i].ToString("0.00", CultureInfo.InvariantCulture)}s.png", "quadro",
                        x => { x.JobId = job.Id; x.ModeloId = "ffmpeg"; }, ct);
                    ids.Add(m.Id);
                }
            }
            else
            {
                var montagem = MontagemDe(parametros, entradas.Values.SelectMany(v => v).DistinctBy(m => m.Id).ToDictionary(m => m.Id));
                var saida = Path.Combine(temp, "montagem.mp4");
                await ff.Montar(montagem, saida, ct);
                await using var f = File.OpenRead(saida);
                var nome = ((string?)parametros["nome"])?.Trim() is { Length: > 0 } n ? n : "Montagem";
                var m = await midias.Importar(job.UserId, f, "video/mp4", nome + ".mp4", "montagem", x => { x.JobId = job.Id; x.ModeloId = "ffmpeg"; }, ct);
                ids.Add(m.Id);
            }
            await Concluir(job, ids, ct);
        }
        catch (Exception e) when (e is ErroDoEstudio or ErroDoProvedor or IOException)
        {
            await Falhar(job, e.Message, ct);
        }
        finally
        {
            try { Directory.Delete(temp, recursive: true); } catch (IOException) { }
        }
    }

    public async Task Cancelar(EstudioJob job, CancellationToken ct)
    {
        if (job.Status is "concluido" or "falhou" or "cancelado") return;
        if (job.Provedor == "fal" && job.CancelUrl is { Length: > 0 } url && (await geracoes.Chaves(job.UserId, ct)).Fal is { } chave)
            await fal.Cancelar(chave, url, ct);
        job.Status = "cancelado";
        job.Mensagem = "Cancelada";
        job.ConcluidoEm = DateTime.UtcNow;
        job.AtualizadoEm = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    // ---------- resultado ----------

    /// <summary>
    /// Arquivos que interessam na resposta do provedor. Cada modelo devolve num formato
    /// (images[], video, audio_file, model_glb, model_urls.glb…); em vez de um leitor por modelo,
    /// procura todo objeto com "url" e todo campo *_url, e fica com os do tipo que o modelo gera.
    /// </summary>
    public static List<string> UrlsDoResultado(JsonNode resultado, string tipoEsperado)
    {
        var achados = new List<(string Url, string? ContentType)>();
        void Visitar(JsonNode? n, string? campo)
        {
            switch (n)
            {
                case JsonObject o:
                    if (o["url"] is JsonValue v && v.TryGetValue<string>(out var u) && u.StartsWith("https://"))
                        achados.Add((u, (string?)o["content_type"]));
                    foreach (var (k, filho) in o) if (k != "url") Visitar(filho, k);
                    break;
                case JsonArray a:
                    foreach (var filho in a) Visitar(filho, campo);
                    break;
                case JsonValue s when campo is not null && (campo.EndsWith("_url") || campo == "url") && s.TryGetValue<string>(out var t) && t.StartsWith("https://"):
                    achados.Add((t, null));
                    break;
            }
        }
        Visitar(resultado, null);
        var unicos = achados.DistinctBy(a => a.Url).ToList();

        string TipoDoAchado((string Url, string? ContentType) a)
        {
            var ext = EstudioMidias.ExtensaoDe(a.ContentType, a.Url);
            return EstudioMidias.TipoDe(a.ContentType ?? EstudioMidias.ContentTypeDe(ext), ext);
        }

        var doTipo = unicos.Where(a => TipoDoAchado(a) == tipoEsperado).ToList();
        if (tipoEsperado == "modelo3d" && doTipo.Count > 1)
        {
            // Vários formatos do mesmo modelo: o GLB abre no navegador e no palco; os outros são redundantes.
            var glb = doTipo.FirstOrDefault(a => EstudioMidias.ExtensaoDe(a.ContentType, a.Url) == ".glb");
            if (glb.Url is not null) doTipo = [glb];
        }
        return (doTipo.Count > 0 ? doTipo : unicos).Select(a => a.Url).ToList();
    }

    private async Task ConcluirMundo(EstudioJob job, MundoPronto pronto, CancellationToken ct)
    {
        var prompt = (string?)JsonNode.Parse(job.Parametros)?["prompt"];
        var ids = new List<string>();
        string? thumb = null;
        if (pronto.Miniatura is { } t)
        {
            try
            {
                var mt = await midias.ImportarDeUrl(job.UserId, t, "Mundo — miniatura", "geracao", x => { x.JobId = job.Id; x.ModeloId = job.ModeloId; }, ct);
                thumb = mt.Thumb;
                db.EstudioMidias.Remove(mt);
                midias.ApagarArquivo(mt);
            }
            catch (Exception e) when (e is ErroDoEstudio or ErroDoProvedor) { }
        }
        foreach (var (url, nome) in new[] { (pronto.Splat, "Mundo (splat)"), (pronto.Panorama, "Mundo (panorama 360)"), (pronto.Colisao, "Mundo (malha de colisão)") })
        {
            if (url is null) continue;
            var m = await midias.ImportarDeUrl(job.UserId, url, nome, "geracao",
                x => { x.JobId = job.Id; x.ModeloId = job.ModeloId; x.Prompt = Curto(prompt ?? pronto.Legenda, 2000); x.Thumb ??= thumb; }, ct);
            ids.Add(m.Id);
        }
        job.LinkExterno = pronto.LinkMarble;
        await Concluir(job, ids, ct);
    }

    private async Task<List<string>> TrocarFundo(EstudioJob job, List<string> ids, CancellationToken ct)
    {
        job.Mensagem = "Juntando ao novo fundo";
        await db.SaveChangesAsync(ct);
        var entradas = await Entradas(job, ct);
        var semFundo = await db.EstudioMidias.FirstAsync(m => m.Id == ids[0], ct);
        var fundo = entradas["fundo"][0];
        var original = entradas.GetValueOrDefault("video")?.FirstOrDefault();
        var temp = arm.PastaTemporaria();
        try
        {
            var saida = Path.Combine(temp, "fundo-novo.mp4");
            await ff.SobreporFundo(arm.Absoluto(semFundo.Arquivo), arm.Absoluto(fundo.Arquivo),
                original is null ? null : arm.Absoluto(original.Arquivo), saida, ct);
            await using var f = File.OpenRead(saida);
            var nome = original is null ? "Vídeo com fundo novo.mp4" : Path.GetFileNameWithoutExtension(original.Nome) + " — fundo novo.mp4";
            var final = await midias.Importar(job.UserId, f, "video/mp4", nome, "geracao", x => { x.JobId = job.Id; x.ModeloId = job.ModeloId; }, ct);
            return [final.Id, .. ids];
        }
        finally
        {
            try { Directory.Delete(temp, recursive: true); } catch (IOException) { }
        }
    }

    private async Task Concluir(EstudioJob job, List<string> ids, CancellationToken ct)
    {
        job.Resultado = JsonSerializer.Serialize(ids);
        job.Status = "concluido";
        job.Mensagem = ids.Count == 1 ? "Pronto" : $"Pronto: {ids.Count} arquivos";
        job.Erro = null;
        job.ConcluidoEm = DateTime.UtcNow;
        job.AtualizadoEm = DateTime.UtcNow;
        job.ProximaConsulta = null;
        await db.SaveChangesAsync(ct);
    }

    private async Task Aguardar(EstudioJob job, string mensagem, int? posicao, CancellationToken ct)
    {
        job.Mensagem = mensagem;
        job.PosicaoFila = posicao;
        job.Tentativas = 0;
        var idade = DateTime.UtcNow - job.CriadoEm;
        var espera = idade < TimeSpan.FromMinutes(2) ? options.Value.ConsultaSegundos : idade < TimeSpan.FromMinutes(10) ? 8 : 20;
        job.ProximaConsulta = DateTime.UtcNow.AddSeconds(espera);
        job.AtualizadoEm = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Erro definitivo encerra; passageiro tenta de novo com espera crescente, até um limite.</summary>
    private async Task Reagendar(EstudioJob job, Exception e, CancellationToken ct)
    {
        var definitivo = e is ErroDoEstudio || (e is ErroDoProvedor p && p.Definitivo);
        job.Tentativas++;
        if (definitivo || job.Tentativas >= MaxTentativas)
        {
            await Falhar(job, e.Message, ct);
            return;
        }
        log.LogInformation("Estúdio: {Job} tentativa {N} falhou ({Erro})", job.Id, job.Tentativas, e.Message);
        job.Mensagem = $"Tentando de novo ({e.Message})";
        job.ProximaConsulta = DateTime.UtcNow.AddSeconds(Math.Min(120, 5 * Math.Pow(2, job.Tentativas)));
        job.AtualizadoEm = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    private async Task Falhar(EstudioJob job, string erro, CancellationToken ct)
    {
        job.Status = "falhou";
        job.Erro = Curto(erro, 2000);
        job.Mensagem = "Falhou";
        job.ConcluidoEm = DateTime.UtcNow;
        job.AtualizadoEm = DateTime.UtcNow;
        job.ProximaConsulta = null;
        await db.SaveChangesAsync(ct);
    }

    private async Task<Dictionary<string, List<EstudioMidia>>> Entradas(EstudioJob job, CancellationToken ct)
    {
        var ids = JsonSerializer.Deserialize<Dictionary<string, List<string>>>(job.Entradas) ?? [];
        return await geracoes.CarregarEntradas(job.UserId, ids, ct);
    }

    private static List<double> Tempos(JsonObject p, double duracao)
    {
        if (p["tempos"] is JsonArray lista && lista.Count > 0)
            return lista.Select(t => Math.Max(0, (double?)t ?? 0)).Take(120).ToList();
        var intervalo = Math.Max(0.1, (double?)p["intervalo"] ?? 1);
        if (duracao <= 0) return [0];
        var n = Math.Min(120, (int)Math.Floor(duracao / intervalo) + 1);
        return Enumerable.Range(0, n).Select(i => Math.Min(duracao - 0.05, i * intervalo)).ToList();
    }

    /// <summary>Linha do tempo (JSON da tela ou do MCP) → montagem com os arquivos em disco.</summary>
    private Montagem MontagemDe(JsonObject p, Dictionary<string, EstudioMidia> porId)
    {
        EstudioMidia Midia(JsonNode? n) => porId.GetValueOrDefault((string?)n?["midia"] ?? "") ?? throw new ErroDoEstudio("Clipe sem arquivo válido.");
        var clipes = new List<ClipeMontagem>();
        foreach (var c in p["clipes"] as JsonArray ?? [])
        {
            var m = Midia(c);
            var imagem = m.Tipo == "imagem";
            var inicio = Math.Max(0, (double?)c?["inicio"] ?? 0);
            var fim = (double?)c?["fim"] ?? m.DuracaoSeg ?? (imagem ? inicio + ((double?)c?["duracao"] ?? 3) : inicio + 5);
            if (imagem) fim = inicio + ((double?)c?["duracao"] ?? (fim - inicio));
            clipes.Add(new ClipeMontagem(arm.Absoluto(m.Arquivo), imagem, imagem ? 0 : inicio, Math.Max(0.1, fim - inicio),
                (double?)c?["volume"] ?? 1, !imagem && m.Tipo == "video", (double?)c?["fadeIn"] ?? 0, (double?)c?["fadeOut"] ?? 0));
        }
        var audios = new List<AudioMontagem>();
        foreach (var a in p["audios"] as JsonArray ?? [])
        {
            var m = Midia(a);
            var inicio = Math.Max(0, (double?)a?["inicio"] ?? 0);
            var fim = (double?)a?["fim"] ?? m.DuracaoSeg ?? inicio + 30;
            audios.Add(new AudioMontagem(arm.Absoluto(m.Arquivo), inicio, Math.Max(0.1, fim - inicio), (double?)a?["posicao"] ?? 0,
                (double?)a?["volume"] ?? 1, (double?)a?["fadeIn"] ?? 0, (double?)a?["fadeOut"] ?? 0));
        }
        return new Montagem((int?)p["largura"] ?? 1920, (int?)p["altura"] ?? 1080, (int?)p["fps"] ?? 30, clipes, audios);
    }

    private static string NomeDoResultado(ModeloSpec? modelo, string? prompt, int i, int total)
    {
        var baseNome = string.IsNullOrWhiteSpace(prompt) ? modelo?.Nome ?? "Geração" : Curto(prompt.Trim(), 60)!;
        return total > 1 ? $"{baseNome} ({i + 1})" : baseNome;
    }

    private static string? Curto(string? s, int max = 140) => s is null ? null : s.Length > max ? s[..max] + "…" : s;
}
