using System.ComponentModel;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;
using Notas.Api.Data;
using Notas.Api.Endpoints;
using Notas.Api.Services.Estudio;

namespace Notas.Api.Mcp;

/// <summary>
/// MCP do Estúdio (/api/mcp/estudio): tudo o que a tela faz — catálogo de modelos de IA, gerações
/// no fal.ai e na World Labs (com estimativa de custo e confirmação acima do limite do usuário),
/// biblioteca de arquivos, montagem de vídeo e quadros (ffmpeg), documentos das ferramentas
/// (storyboard, moodboard, cena do palco 3D, linha do tempo) e links para abrir nos craft apps.
/// </summary>
[McpServerToolType]
public sealed class EstudioMcpTools(
    AppDbContext db, McpUser user, Catalogo catalogo, EstudioGeracoes geracoes, EstudioMidias midias,
    EstudioArmazenamento arm, EstudioProcessador processador, Ffmpeg ff, IHttpContextAccessor http)
{
    private static readonly CultureInfo Br = Services.CulturaBr.Cultura;
    private static readonly string[] Crafts =
        ["photocraft", "vectorcraft", "lightcraft", "filmcraft", "effectcraft", "soundcraft", "designcraft", "figcraft", "deckcraft", "wordcraft", "gridcraft", "pdfcraft", "cadcraft"];

    // ---------- catálogo e custo ----------

    [McpServerTool(Name = "estudio_modelos", ReadOnly = true, OpenWorld = false)]
    [Description("Modelos de IA do Estúdio (fal.ai e World Labs) com as operações de cada um, as entradas de arquivo, os parâmetros, " +
                 "os valores aceitos e o custo por unidade. Use antes de estudio_gerar para escolher modelo, operação e parâmetros. " +
                 "Tipos: imagem, video, audio, modelo3d, mundo. Operações comuns: texto, editar, inpaint, angulo, remover-fundo, ampliar, " +
                 "imagem, quadros, referencias, estender, musica, efeito, fala, video-para-audio, multivistas, esboco, topologia, partes.")]
    public string Modelos(
        [Description("Filtra pelo tipo de saída (imagem, video, audio, modelo3d, mundo).")] string? tipo = null,
        [Description("Filtra pelos modelos que fazem esta operação.")] string? operacao = null,
        [Description("Detalhar opções e custo de cada operação (mais longo). Padrão: falso.")] bool detalhes = false)
    {
        var lista = catalogo.Modelos.Where(m => (tipo is null || m.Tipo == tipo) && (operacao is null || m.Ops.ContainsKey(operacao))).ToList();
        if (lista.Count == 0) return "Nenhum modelo com esse filtro.";
        var sb = new StringBuilder();
        foreach (var g in lista.GroupBy(m => m.Tipo))
        {
            sb.Append($"## {g.Key}\n");
            foreach (var m in g)
            {
                sb.Append($"- **{m.Id}** — {m.Nome} ({m.Familia}{(m.Provedor == "worldlabs" ? ", World Labs" : "")})");
                if (m.Descricao is not null) sb.Append($": {m.Descricao}");
                sb.Append($"\n  operações: {string.Join(", ", m.Ops.Keys)}\n");
                if (!detalhes) continue;
                foreach (var (nome, op) in m.Ops)
                {
                    var entradas = op.Mapa.Keys.Where(k => Catalogo.ChavesDeMidia.Contains(k)).ToList();
                    var parametros = op.Mapa.Keys.Where(k => !Catalogo.ChavesDeMidia.Contains(k)).ToList();
                    sb.Append($"  - `{nome}`: entradas [{string.Join(", ", entradas)}] · parâmetros [{string.Join(", ", parametros)}]");
                    if (op.Obrigatorios.Count > 0) sb.Append($" · obrigatórios [{string.Join(", ", op.Obrigatorios)}]");
                    foreach (var (k, v) in op.Opcoes) sb.Append($" · {k} ∈ {{{string.Join(", ", v.Select(x => x.ToString()))}}}");
                    foreach (var (k, v) in op.Padroes) sb.Append($" · {k}={v}");
                    if (op.MaxImagens is { } max) sb.Append($" · até {max} imagens");
                    sb.Append($" · custo: {CustoTexto(op.Custo)}\n");
                }
            }
        }
        return sb.ToString().TrimEnd();
    }

    [McpServerTool(Name = "estudio_estimar", ReadOnly = true, OpenWorld = false)]
    [Description("Custo estimado (US$) de uma geração, sem gerar. Mesmos argumentos de estudio_gerar.")]
    public async Task<string> Estimar(
        [Description("Id do modelo (ver estudio_modelos).")] string modelo,
        [Description("Operação (texto, editar, imagem…).")] string operacao,
        [Description("Parâmetros genéricos: prompt, proporcao, resolucao, duracao, quantidade, audio, qualidade…")] Dictionary<string, JsonElement>? parametros = null,
        [Description("Arquivos da biblioteca por entrada, ex.: {\"imagens\": [\"id1\", \"id2\"], \"imagem\": [\"id\"]}.")] Dictionary<string, string[]>? entradas = null,
        CancellationToken ct = default)
    {
        try
        {
            var custo = await geracoes.Estimar(user.Id, Pedido(modelo, operacao, parametros, entradas, null, null), ct);
            var uso = await geracoes.Uso(user.Id, ct);
            return $"Custo estimado: {Dolar(custo)}. Gasto do mês: {Dolar(uso.GastoMesCentavos)}" +
                   (uso.LimiteMensalCentavos is { } l ? $" de {Dolar(l)} (teto)." : " (sem teto).");
        }
        catch (ErroDoEstudio e) { return "Erro: " + e.Message; }
    }

    // ---------- gerações ----------

    [McpServerTool(Name = "estudio_gerar", ReadOnly = false, Destructive = false, OpenWorld = true)]
    [Description("Gera com IA (custa dinheiro na conta do fal.ai do usuário). Acima do limite de confirmação do usuário, a primeira chamada " +
                 "só devolve o custo: repita com confirmar=true depois que o usuário aprovar. Os arquivos de entrada são ids da biblioteca " +
                 "(estudio_midias, estudio_enviar_url, estudio_enviar_arquivo). Com aguardar_segundos, espera o resultado (até 110 s); " +
                 "senão, acompanhe com estudio_status. O resultado entra na biblioteca.")]
    public async Task<string> Gerar(
        [Description("Id do modelo (ver estudio_modelos).")] string modelo,
        [Description("Operação do modelo.")] string operacao,
        [Description("Parâmetros genéricos: prompt (obrigatório na maioria), negativo, proporcao, resolucao, duracao, quantidade, audio, qualidade, voz, anguloH, anguloV, zoom…")] Dictionary<string, JsonElement>? parametros = null,
        [Description("Ids da biblioteca por entrada: imagens, imagem, imagemFinal, mascara, video, videos, audios, arquivo3d, imagemCostas…")] Dictionary<string, string[]>? entradas = null,
        [Description("true depois que o usuário aprovar o custo mostrado.")] bool confirmar = false,
        [Description("Segundos para esperar o resultado nesta chamada (0 a 110).")] int aguardar_segundos = 0,
        CancellationToken ct = default)
    {
        try
        {
            var pedido = Pedido(modelo, operacao, parametros, entradas, "mcp", null);
            var custo = await geracoes.Estimar(user.Id, pedido, ct);
            var uso = await geracoes.Uso(user.Id, ct);
            if (!confirmar && custo > uso.ConfirmarAcimaCentavos)
                return $"Esta geração custa ~{Dolar(custo)} (acima do limite de confirmação de {Dolar(uso.ConfirmarAcimaCentavos)}). " +
                       "Pergunte ao usuário e, se ele aprovar, chame de novo com confirmar=true.";
            var job = await geracoes.Criar(user.Id, pedido, ct);
            return await Esperar(job.Id, aguardar_segundos, ct);
        }
        catch (ErroDoEstudio e) { return "Erro: " + e.Message; }
    }

    [McpServerTool(Name = "estudio_trocar_fundo_video", ReadOnly = false, Destructive = false, OpenWorld = true)]
    [Description("Troca o fundo de um vídeo por uma imagem: tira o fundo (fal.ai) e junta ao novo fundo mantendo o áudio (ffmpeg). Custa pelo tempo do vídeo.")]
    public async Task<string> TrocarFundo(
        [Description("Id do vídeo na biblioteca.")] string video,
        [Description("Id da imagem do novo fundo.")] string fundo,
        [Description("true depois que o usuário aprovar o custo.")] bool confirmar = false,
        [Description("Segundos para esperar (0 a 110).")] int aguardar_segundos = 0,
        CancellationToken ct = default)
    {
        try
        {
            var pedido = new PedidoGeracao("bria-video-fundo", "remover-fundo", [],
                new() { ["video"] = [video], ["fundo"] = [fundo] }, "mcp", "trocar-fundo");
            var custo = await geracoes.Estimar(user.Id, pedido, ct);
            var uso = await geracoes.Uso(user.Id, ct);
            if (!confirmar && custo > uso.ConfirmarAcimaCentavos)
                return $"Custa ~{Dolar(custo)}. Confirme com o usuário e chame de novo com confirmar=true.";
            var job = await geracoes.Criar(user.Id, pedido, ct);
            return await Esperar(job.Id, aguardar_segundos, ct);
        }
        catch (ErroDoEstudio e) { return "Erro: " + e.Message; }
    }

    [McpServerTool(Name = "estudio_status", ReadOnly = true, OpenWorld = false)]
    [Description("Andamento de uma geração (ou montagem): status, mensagem, erro e os arquivos prontos com links.")]
    public Task<string> Status(
        [Description("Id da geração.")] string id,
        [Description("Segundos para esperar terminar (0 a 110).")] int aguardar_segundos = 0,
        CancellationToken ct = default) => Esperar(id, aguardar_segundos, ct);

    [McpServerTool(Name = "estudio_cancelar", ReadOnly = false, Destructive = false, OpenWorld = true)]
    [Description("Cancela uma geração na fila ou rodando.")]
    public async Task<string> Cancelar([Description("Id da geração.")] string id, CancellationToken ct = default)
    {
        var job = await db.EstudioJobs.FirstOrDefaultAsync(j => j.Id == id && j.UserId == user.Id, ct);
        if (job is null) return "Geração não encontrada.";
        await processador.Cancelar(job, ct);
        return $"Geração {id}: {job.Status}.";
    }

    [McpServerTool(Name = "estudio_geracoes", ReadOnly = true, OpenWorld = false)]
    [Description("Últimas gerações (de todas as telas ou de uma ferramenta), com status e resultados.")]
    public async Task<string> Geracoes(
        [Description("Ferramenta (criar-imagem, criar-video, palco, storyboard, mcp…). Vazio = todas.")] string? app = null,
        [Description("Máximo (1 a 50). Padrão 10.")] int limite = 10,
        CancellationToken ct = default)
    {
        var q = db.EstudioJobs.AsNoTracking().Where(j => j.UserId == user.Id && !j.Oculto);
        if (!string.IsNullOrWhiteSpace(app)) q = q.Where(j => j.App == app);
        var jobs = await q.OrderByDescending(j => j.CriadoEm).Take(Math.Clamp(limite, 1, 50)).ToListAsync(ct);
        if (jobs.Count == 0) return "Nenhuma geração.";
        var dtos = await EstudioEndpoints.JobDtos(jobs, db, catalogo, arm, ct);
        return string.Join("\n\n", dtos.Select(TextoDoJob));
    }

    [McpServerTool(Name = "estudio_uso", ReadOnly = true, OpenWorld = false)]
    [Description("Gasto estimado do mês, teto mensal e limite de confirmação, e se as chaves do fal.ai e da World Labs estão cadastradas.")]
    public async Task<string> Uso(CancellationToken ct = default)
    {
        var uso = await geracoes.Uso(user.Id, ct);
        var chaves = await geracoes.Chaves(user.Id, ct);
        return $"Gasto estimado em {DateTime.UtcNow.ToString("MMMM/yyyy", Br)}: {Dolar(uso.GastoMesCentavos)} em {uso.GeracoesNoMes} gerações.\n" +
               $"Teto mensal: {(uso.LimiteMensalCentavos is { } l ? Dolar(l) : "sem teto")}. Pede confirmação acima de {Dolar(uso.ConfirmarAcimaCentavos)}.\n" +
               $"fal.ai: {(chaves.Fal is null ? "sem chave (cadastre em Estúdio › Configurações)" : chaves.FalDoServidor ? "chave do servidor" : "chave do usuário")}. " +
               $"World Labs: {(chaves.WorldLabs is null ? "sem chave" : "ok")}. ffmpeg: {(ff.Disponivel ? "ok" : "não instalado")}.";
    }

    // ---------- biblioteca ----------

    [McpServerTool(Name = "estudio_midias", ReadOnly = true, OpenWorld = false)]
    [Description("Arquivos da biblioteca do Estúdio (imagens, vídeos, áudios, modelos 3D, mundos e documentos dos craft apps), mais recentes primeiro, com id e link.")]
    public async Task<string> Midias(
        [Description("Tipo: imagem, video, audio, modelo3d, mundo ou documento. Vários separados por vírgula.")] string? tipo = null,
        [Description("Busca no nome e no prompt.")] string? busca = null,
        [Description("Só desta pasta.")] string? pasta = null,
        [Description("Máximo (1 a 100). Padrão 30.")] int limite = 30,
        CancellationToken ct = default)
    {
        var q = db.EstudioMidias.AsNoTracking().Where(m => m.UserId == user.Id && m.DeletedAt == null);
        if (!string.IsNullOrWhiteSpace(tipo))
        {
            var tipos = tipo.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            q = q.Where(m => tipos.Contains(m.Tipo));
        }
        if (!string.IsNullOrWhiteSpace(pasta)) q = q.Where(m => m.Pasta == pasta);
        if (!string.IsNullOrWhiteSpace(busca))
        {
            var t = busca.Trim().ToLower();
            q = q.Where(m => m.Nome.ToLower().Contains(t) || (m.Prompt != null && m.Prompt.ToLower().Contains(t)));
        }
        var lista = await q.OrderByDescending(m => m.CriadoEm).Take(Math.Clamp(limite, 1, 100)).ToListAsync(ct);
        return lista.Count == 0 ? "Nada na biblioteca com esse filtro." : string.Join('\n', lista.Select(LinhaDaMidia));
    }

    [McpServerTool(Name = "estudio_midia", ReadOnly = true, OpenWorld = false)]
    [Description("Detalhes de um arquivo da biblioteca: tipo, tamanho, duração, prompt, link para baixar e em que craft app abre.")]
    public async Task<string> Midia([Description("Id do arquivo.")] string id, CancellationToken ct = default)
    {
        var m = await db.EstudioMidias.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.UserId == user.Id && x.DeletedAt == null, ct);
        if (m is null) return "Arquivo não encontrado.";
        var sb = new StringBuilder(LinhaDaMidia(m)).Append('\n');
        if (m.Largura is not null) sb.Append($"Tamanho: {m.Largura}×{m.Altura} px\n");
        if (m.DuracaoSeg is not null) sb.Append($"Duração: {m.DuracaoSeg:0.0} s\n");
        if (m.Prompt is not null) sb.Append($"Prompt: {m.Prompt}\n");
        if (m.Pasta is not null) sb.Append($"Pasta: {m.Pasta}\n");
        sb.Append($"Abrir no Estúdio: {Base()}/estudio/biblioteca?m={m.Id}");
        return sb.ToString();
    }

    [McpServerTool(Name = "estudio_enviar_url", ReadOnly = false, Destructive = false, OpenWorld = true)]
    [Description("Põe na biblioteca um arquivo de um endereço https (foto, vídeo, áudio, GLB, documento). Devolve o id para usar nas gerações.")]
    public async Task<string> EnviarUrl(
        [Description("Endereço https do arquivo.")] string url,
        [Description("Nome (opcional).")] string? nome = null,
        [Description("Pasta (opcional).")] string? pasta = null,
        CancellationToken ct = default)
    {
        try
        {
            var m = await midias.ImportarDeUrl(user.Id, url, nome, "mcp", x => x.Pasta = pasta, ct);
            return "Na biblioteca: " + LinhaDaMidia(m);
        }
        catch (Exception e) when (e is ErroDoEstudio or ErroDoProvedor) { return "Erro: " + e.Message; }
    }

    [McpServerTool(Name = "estudio_enviar_arquivo", ReadOnly = false, Destructive = false, OpenWorld = false)]
    [Description("Põe na biblioteca um arquivo pequeno enviado em base64 (até ~15 MB). Para arquivos grandes, use estudio_enviar_url ou o MCP local.")]
    public async Task<string> EnviarArquivo(
        [Description("Nome com extensão (ex.: logo.png, orcamento.xlsx).")] string nome,
        [Description("Conteúdo em base64 (sem o prefixo data:).")] string conteudo_base64,
        [Description("Pasta (opcional).")] string? pasta = null,
        CancellationToken ct = default)
    {
        byte[] bytes;
        try { bytes = Convert.FromBase64String(conteudo_base64.Contains(',') ? conteudo_base64[(conteudo_base64.IndexOf(',') + 1)..] : conteudo_base64); }
        catch (FormatException) { return "Erro: o conteúdo não é base64 válido."; }
        if (bytes.Length > 15 * 1024 * 1024) return "Erro: arquivo grande demais para mandar em base64.";
        using var ms = new MemoryStream(bytes);
        var m = await midias.Importar(user.Id, ms, EstudioMidias.ContentTypeDe(EstudioMidias.ExtensaoDe(null, nome)), nome, "mcp", x => x.Pasta = pasta, ct);
        return "Na biblioteca: " + LinhaDaMidia(m);
    }

    [McpServerTool(Name = "estudio_organizar_midia", ReadOnly = false, Destructive = false, OpenWorld = false)]
    [Description("Renomeia, muda de pasta ou (des)favorita um arquivo da biblioteca.")]
    public async Task<string> Organizar(
        [Description("Id do arquivo.")] string id,
        [Description("Novo nome (opcional).")] string? nome = null,
        [Description("Pasta (opcional; vazio tira da pasta).")] string? pasta = null,
        [Description("Favorito (opcional).")] bool? favorito = null,
        CancellationToken ct = default)
    {
        var m = await db.EstudioMidias.FirstOrDefaultAsync(x => x.Id == id && x.UserId == user.Id && x.DeletedAt == null, ct);
        if (m is null) return "Arquivo não encontrado.";
        if (!string.IsNullOrWhiteSpace(nome)) m.Nome = nome.Trim()[..Math.Min(nome.Trim().Length, 200)];
        if (pasta is not null) m.Pasta = pasta.Trim().Length == 0 ? null : pasta.Trim()[..Math.Min(pasta.Trim().Length, 120)];
        if (favorito is { } f) m.Favorito = f;
        await db.SaveChangesAsync(ct);
        return "Ok: " + LinhaDaMidia(m);
    }

    [McpServerTool(Name = "estudio_apagar_midia", ReadOnly = false, Destructive = true, OpenWorld = false)]
    [Description("Apaga um arquivo da biblioteca (e do disco). Só com confirmar=true, depois de o usuário pedir.")]
    public async Task<string> Apagar([Description("Id do arquivo.")] string id, [Description("true para apagar de verdade.")] bool confirmar = false, CancellationToken ct = default)
    {
        var m = await db.EstudioMidias.FirstOrDefaultAsync(x => x.Id == id && x.UserId == user.Id && x.DeletedAt == null, ct);
        if (m is null) return "Arquivo não encontrado.";
        if (!confirmar) return $"Vai apagar \"{m.Nome}\" de vez. Confirme com o usuário e chame de novo com confirmar=true.";
        m.DeletedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        midias.ApagarArquivo(m);
        return $"\"{m.Nome}\" apagado.";
    }

    [McpServerTool(Name = "estudio_para_editor", ReadOnly = false, Destructive = false, OpenWorld = false)]
    [Description("Manda uma imagem da biblioteca para a biblioteca do Editor de Imagens (Print & Cut, Moldes SVG, Redes sociais, Ilustração).")]
    public async Task<string> ParaEditor([Description("Id da imagem.")] string id, CancellationToken ct = default)
    {
        var m = await db.EstudioMidias.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.UserId == user.Id && x.DeletedAt == null, ct);
        if (m is null) return "Arquivo não encontrado.";
        if (m.Tipo != "imagem") return "Só imagens vão para o Editor.";
        if (m.Tamanho > 9 * 1024 * 1024) return "Imagem grande demais para o Editor (máximo 9 MB).";
        var dados = $"data:{m.ContentType};base64,{Convert.ToBase64String(await File.ReadAllBytesAsync(arm.Absoluto(m.Arquivo), ct))}";
        db.ImageLibrary.Add(new ImageLibraryItem
        {
            Id = Guid.NewGuid().ToString(), UserId = user.Id, Name = Path.GetFileNameWithoutExtension(m.Nome), Origin = "estudio",
            Data = dados, Thumb = m.Thumb ?? dados, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync(ct);
        return $"Está na biblioteca do Editor de Imagens: {Base()}/estudio/editor";
    }

    [McpServerTool(Name = "estudio_abrir_no_app", ReadOnly = true, OpenWorld = false)]
    [Description("Link para abrir um arquivo da biblioteca num craft app do ArtCraft dentro do hub (PhotoCraft, VectorCraft, LightCraft, FilmCraft, " +
                 "EffectCraft, SoundCraft, DesignCraft, FigCraft, DeckCraft, WordCraft, GridCraft, PdfCraft, CADCraft). O que o usuário salvar no app volta para a biblioteca.")]
    public string AbrirNoApp(
        [Description("Id do arquivo.")] string midia,
        [Description("App: photocraft, vectorcraft, lightcraft, filmcraft, effectcraft, soundcraft, designcraft, figcraft, deckcraft, wordcraft, gridcraft, pdfcraft ou cadcraft.")] string app)
    {
        var id = app.Trim().ToLowerInvariant();
        if (!Crafts.Contains(id)) return $"App desconhecido. Use um destes: {string.Join(", ", Crafts)}.";
        return $"{Base()}/estudio/apps/{id}?abrir={Uri.EscapeDataString(midia)}";
    }

    // ---------- ffmpeg ----------

    [McpServerTool(Name = "estudio_montar_video", ReadOnly = false, Destructive = false, OpenWorld = false)]
    [Description("Monta um MP4 (ffmpeg, sem custo de IA) a partir de clipes e imagens em sequência e trilhas de áudio. " +
                 "clipes: [{midia, inicio?, fim?, duracao? (imagem), volume?, fadeIn?, fadeOut?}], audios: [{midia, inicio?, fim?, posicao?, volume?, fadeIn?, fadeOut?}] (segundos).")]
    public async Task<string> MontarVideo(
        [Description("Clipes de vídeo/imagem na ordem.")] JsonElement clipes,
        [Description("Trilhas de áudio (opcional).")] JsonElement? audios = null,
        [Description("Largura (padrão 1920).")] int largura = 1920,
        [Description("Altura (padrão 1080).")] int altura = 1080,
        [Description("Nome do arquivo final.")] string? nome = null,
        [Description("Segundos para esperar (0 a 110).")] int aguardar_segundos = 0,
        CancellationToken ct = default)
    {
        try
        {
            var p = new JsonObject
            {
                ["clipes"] = JsonNode.Parse(clipes.GetRawText()),
                ["audios"] = audios is { ValueKind: JsonValueKind.Array } a ? JsonNode.Parse(a.GetRawText()) : new JsonArray(),
                ["largura"] = largura, ["altura"] = altura, ["fps"] = 30, ["nome"] = nome ?? "Montagem",
            };
            var ids = Ids(p["clipes"]).Concat(Ids(p["audios"])).Distinct().ToList();
            var job = await geracoes.CriarLocal(user.Id, "montagem", "montar", p, new() { ["clipes"] = ids }, ct);
            return await Esperar(job.Id, aguardar_segundos, ct);
        }
        catch (Exception e) when (e is ErroDoEstudio or JsonException) { return "Erro: " + e.Message; }
    }

    [McpServerTool(Name = "estudio_extrair_quadros", ReadOnly = false, Destructive = false, OpenWorld = false)]
    [Description("Tira quadros (PNG) de um vídeo da biblioteca, em instantes escolhidos ou a cada N segundos (ffmpeg, sem custo de IA).")]
    public async Task<string> ExtrairQuadros(
        [Description("Id do vídeo.")] string video,
        [Description("Instantes em segundos (opcional).")] double[]? tempos = null,
        [Description("Ou um quadro a cada N segundos (padrão 1).")] double intervalo = 1,
        [Description("Segundos para esperar (0 a 110).")] int aguardar_segundos = 30,
        CancellationToken ct = default)
    {
        try
        {
            var p = new JsonObject { ["intervalo"] = intervalo };
            if (tempos is { Length: > 0 }) p["tempos"] = new JsonArray(tempos.Select(t => (JsonNode)JsonValue.Create(t)!).ToArray());
            var job = await geracoes.CriarLocal(user.Id, "quadros", "quadros", p, new() { ["video"] = [video] }, ct);
            return await Esperar(job.Id, aguardar_segundos, ct);
        }
        catch (ErroDoEstudio e) { return "Erro: " + e.Message; }
    }

    // ---------- documentos das ferramentas ----------

    [McpServerTool(Name = "estudio_documentos", ReadOnly = true, OpenWorld = false)]
    [Description("Documentos das ferramentas do Estúdio: storyboard, moodboard, cena (palco 3D) ou timeline (montagem).")]
    public async Task<string> Documentos([Description("storyboard, moodboard, cena ou timeline.")] string tipo, CancellationToken ct = default)
    {
        var lista = await db.EstudioQuadros.AsNoTracking().Where(q => q.UserId == user.Id && q.Tipo == tipo && q.DeletedAt == null)
            .OrderByDescending(q => q.UpdatedAt).Take(50).Select(q => new { q.Id, q.Nome, q.UpdatedAt }).ToListAsync(ct);
        return lista.Count == 0 ? "Nenhum documento desse tipo." :
            string.Join('\n', lista.Select(q => $"- {q.Nome} (id {q.Id}) · {q.UpdatedAt.ToLocalTime().ToString("dd/MM HH:mm", Br)} · {Base()}{Rota(tipo)}?quadro={q.Id}"));
    }

    [McpServerTool(Name = "estudio_documento", ReadOnly = true, OpenWorld = false)]
    [Description("Conteúdo JSON de um documento (para ler ou editar e salvar com estudio_salvar_documento).")]
    public async Task<string> Documento([Description("Id do documento.")] string id, CancellationToken ct = default)
    {
        var q = await db.EstudioQuadros.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.UserId == user.Id && x.DeletedAt == null, ct);
        return q is null ? "Documento não encontrado." : $"{q.Tipo} \"{q.Nome}\":\n{q.Data}";
    }

    [McpServerTool(Name = "estudio_salvar_documento", ReadOnly = false, Destructive = false, OpenWorld = false)]
    [Description("Cria ou substitui um documento: storyboard {estilo, proporcao, planos:[{id,titulo,descricao,camera,duracao,imagem,video,notas}]}, " +
                 "moodboard {itens:[{id,tipo:'imagem'|'nota',midia?,texto?,x,y,w}]}, cena do palco 3D {objetos:[{id,tipo:'boneco'|'modelo'|'forma'|'imagem',nome," +
                 "posicao:[x,y,z],rotacao:[graus],escala:[x,y,z],cor?,forma?,midia?,pose?:{junta:[x,y,z]}}],fundo,camera,luz,chao,proporcao} ou timeline " +
                 "{largura,altura,fps,clipes:[{id,midia,inicio,fim,volume,fadeIn,fadeOut}],audios:[…,posicao]}. Devolve o link para abrir.")]
    public async Task<string> SalvarDocumento(
        [Description("storyboard, moodboard, cena ou timeline.")] string tipo,
        [Description("Nome.")] string nome,
        [Description("Conteúdo (objeto JSON no formato do tipo).")] JsonElement conteudo,
        [Description("Id para substituir um existente (vazio = novo).")] string? id = null,
        CancellationToken ct = default)
    {
        if (tipo is not ("storyboard" or "moodboard" or "cena" or "timeline")) return "Tipo inválido.";
        if (conteudo.ValueKind != JsonValueKind.Object) return "O conteúdo precisa ser um objeto JSON.";
        var docId = string.IsNullOrWhiteSpace(id) ? Guid.NewGuid().ToString() : id.Trim();
        var q = await db.EstudioQuadros.FirstOrDefaultAsync(x => x.Id == docId, ct);
        if (q is not null && q.UserId != user.Id) return "Documento não encontrado.";
        if (q is null) db.EstudioQuadros.Add(q = new EstudioQuadro { Id = docId, UserId = user.Id, CreatedAt = DateTime.UtcNow });
        q.Tipo = tipo;
        q.Nome = string.IsNullOrWhiteSpace(nome) ? "Sem nome" : nome.Trim()[..Math.Min(nome.Trim().Length, 300)];
        q.Data = conteudo.GetRawText();
        q.UpdatedAt = DateTime.UtcNow;
        q.DeletedAt = null;
        await db.SaveChangesAsync(ct);
        return $"Salvo. Abrir: {Base()}{Rota(tipo)}?quadro={docId}";
    }

    // ---------- apoio ----------

    private async Task<string> Esperar(string id, int segundos, CancellationToken ct)
    {
        var limite = DateTime.UtcNow.AddSeconds(Math.Clamp(segundos, 0, 110));
        for (;;)
        {
            var job = await db.EstudioJobs.AsNoTracking().FirstOrDefaultAsync(j => j.Id == id && j.UserId == user.Id, ct);
            if (job is null) return "Geração não encontrada.";
            var terminou = job.Status is "concluido" or "falhou" or "cancelado";
            if (terminou || DateTime.UtcNow >= limite)
            {
                var dto = (await EstudioEndpoints.JobDtos([job], db, catalogo, arm, ct))[0];
                return TextoDoJob(dto) + (terminou ? "" : "\n(ainda não terminou: chame estudio_status com este id mais tarde)");
            }
            await Task.Delay(2000, ct);
        }
    }

    private string TextoDoJob(Dtos.JobDto j)
    {
        var sb = new StringBuilder($"Geração {j.Id} · {j.ModeloNome ?? j.ModeloId} · {j.Operacao} · **{j.Status}**");
        if (j.Provedor != "local") sb.Append($" · ~{Dolar(j.CustoEstimadoCentavos)}");
        if (!string.IsNullOrEmpty(j.Mensagem) && j.Status is "fila" or "rodando") sb.Append($" · {j.Mensagem}");
        if (!string.IsNullOrEmpty(j.Erro)) sb.Append($"\nErro: {j.Erro}");
        foreach (var m in j.Resultado) sb.Append($"\n- {m.Nome} ({m.Tipo}, id {m.Id}): {Base()}{m.Url}");
        if (j.LinkExterno is not null) sb.Append($"\nNo site do provedor: {j.LinkExterno}");
        return sb.ToString();
    }

    private string LinhaDaMidia(EstudioMidia m) =>
        $"- {m.Nome} · {m.Tipo} · id {m.Id} · {m.CriadoEm.ToLocalTime().ToString("dd/MM HH:mm", Br)} · {Base()}{arm.Link(m.Id, TimeSpan.FromDays(2))}";

    private string Base()
    {
        var r = http.HttpContext?.Request;
        return r is null ? "" : $"{r.Scheme}://{r.Host}";
    }

    private static string Rota(string tipo) => tipo switch
    {
        "storyboard" => "/estudio/ferramentas/storyboard",
        "moodboard" => "/estudio/ferramentas/moodboard",
        "cena" => "/estudio/ferramentas/palco",
        _ => "/estudio/ferramentas/montagem",
    };

    private static IEnumerable<string> Ids(JsonNode? lista) =>
        (lista as JsonArray ?? []).Select(n => (string?)n?["midia"]).Where(s => !string.IsNullOrWhiteSpace(s))!;

    private static PedidoGeracao Pedido(string modelo, string operacao, Dictionary<string, JsonElement>? parametros, Dictionary<string, string[]>? entradas, string? app, string? pipeline)
    {
        var p = new JsonObject();
        foreach (var (k, v) in parametros ?? []) p[k] = JsonNode.Parse(v.GetRawText());
        return new PedidoGeracao(modelo, operacao, p, entradas?.ToDictionary(kv => kv.Key, kv => kv.Value.ToList()), app, pipeline);
    }

    private static string Dolar(double centavos) => "US$ " + (centavos / 100).ToString("0.00", CultureInfo.InvariantCulture);

    private static string CustoTexto(CustoSpec c)
    {
        var partes = new List<string>();
        if (c.Fixo > 0) partes.Add($"{Dolar(c.Fixo)} por geração");
        if (c.PorUnidade > 0) partes.Add($"{Dolar(c.PorUnidade)} por imagem");
        if (c.PorSegundo > 0) partes.Add($"{Dolar(c.PorSegundo)} por segundo");
        if (c.PorCaractere > 0) partes.Add($"{Dolar(c.PorCaractere * 1000)} por mil caracteres");
        foreach (var (k, t) in c.Mult) partes.Add($"×{string.Join("/", t.Select(x => $"{x.Value} se {k}={x.Key}"))}");
        return partes.Count == 0 ? "–" : string.Join(", ", partes);
    }
}
