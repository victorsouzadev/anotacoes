using System.Text;
using Hub.Core;
using Hub.Data;
using Hub.Index;
using Hub.Pipeline;
using Hub.Vault;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Hub.Api;

public sealed record WebCaptureDto(string? Content, string? Url, List<string>? Tags);

public sealed record WebDecisionDto(string Path, string? Folder);

public sealed record WebPathDto(string Path);

public sealed record WebRevealDto(string Item);

public sealed record WebWebdavDto(string Usuario, string? Senha);

public sealed record WebNameDto(string Nome);

public sealed record WebNewNoteDto(string? Pasta, string Titulo, string? Conteudo);

public sealed record WebSaveNoteDto(string Path, string Conteudo, string Versao);

public sealed record WebMoveNoteDto(string Path, string? Pasta, string? Nome);

public sealed record WebRestoreDto(string Versao, string? Path);

public sealed record WebAppsDto(bool Ativo, List<string>? Horarios, List<string>? Apps);

/// <param name="ChaveApi">null mantém a chave salva; "" apaga; texto substitui.</param>
public sealed record WebTranscricaoDto(string? Servico, string? Modelo, string? ChaveApi);

public sealed record WebResumoDto(int? Dias, bool? Salvar);

public sealed record WebAiDto(string? Provedor, string? Modelo, string? ChaveApi);

/// <summary>
/// API da tela "Segundo Cérebro" do hub. Usa o login único do notas-api (JWT com
/// issuer/audience "notas-vps"), e não as API keys: quem chama é o navegador.
/// </summary>
public static class WebEndpoints
{
    public const string Policy = "cerebro-dono";
    private const int ExcerptChars = 600;

    public static void AddHubWebAuth(this IServiceCollection services, WebOptions web)
    {
        // Sem segredo não há como validar o token: a tela fica desligada (503), o resto do hub segue.
        var secret = string.IsNullOrWhiteSpace(web.JwtSecret) ? new string('x', 64) : web.JwtSecret;
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(o =>
            {
                o.MapInboundClaims = false;
                o.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidIssuer = "notas-vps",
                    ValidAudience = "notas-vps",
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),
                    ValidateIssuer = true,
                    ValidateAudience = true,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    ClockSkew = TimeSpan.FromSeconds(30),
                };
            });

        var allowed = web.AllowedEmails;
        services.AddAuthorizationBuilder().AddPolicy(Policy, p => p
            .RequireAuthenticatedUser()
            .RequireAssertion(ctx => ctx.User.FindFirst("email")?.Value is { } email && allowed.Contains(email)));
    }

    public static void MapHubWeb(this WebApplication app)
    {
        var web = app.MapGroup("/api/v1/web")
            .AddEndpointFilter(RequireEnabledAndHandleErrors)
            .RequireAuthorization(Policy);

        web.MapGet("/me", Me);
        web.MapGet("/inbox", Inbox);
        web.MapPost("/captures", Capture);
        web.MapPost("/captures/arquivo", CaptureFile);
        web.MapPost("/inbox/approve", Approve);
        web.MapPost("/inbox/reject", Reject);
        web.MapGet("/search", Search);
        web.MapGet("/notas", ListNotes);
        web.MapGet("/nota", ReadNote);
        web.MapGet("/decisoes", RecentDecisions);
        web.MapGet("/grafo", (NoteIndex index) =>
        {
            var (nodes, edges) = index.Graph();
            return Results.Ok(new
            {
                nos = nodes.Select(n => new { path = n.Path, title = n.Title, pasta = n.Folder.Split('/')[0], tags = n.Tags }),
                links = edges.Select(e => new { de = e.Source, para = e.Target }),
            });
        });

        // Edição pela tela (você). Tudo entra no histórico git, que é o log e a fonte de restauração.
        web.MapGet("/pastas", (VaultStore vault) => Results.Ok(vault.UserFolders()));
        web.MapPost("/notas", CreateNote);
        web.MapPut("/nota", SaveNote);
        web.MapPost("/nota/mover", MoveNote);
        web.MapPost("/nota/excluir", TrashNote);
        web.MapGet("/historico", History);
        web.MapGet("/historico/versao", VersionContent);
        web.MapPost("/historico/restaurar-nota", RestoreNote);
        web.MapPost("/historico/restaurar-cerebro", RestoreVault);
        web.MapPost("/inbox/reclassify", Reclassify);
        web.MapGet("/ia", GetAi);
        web.MapPut("/ia", SaveAi);
        web.MapPost("/ia/testar", TestAi);
        web.MapGet("/transcricao", (TranscriptionSettings t) => Results.Ok(DescribeTranscription(t)));
        web.MapPut("/transcricao", SaveTranscription);

        web.MapGet("/acessos", GetAccess);
        web.MapPost("/acessos/revelar", RevealAccess);
        web.MapPost("/acessos/mcp/gerar", (AccessStore a, ILogger<AccessStore> log) => Rotate("mcp", a.RegenerateMcpToken, a, log));
        web.MapPost("/acessos/ops/gerar", (AccessStore a, ILogger<AccessStore> log) => Rotate("ops", a.RegenerateOpsToken, a, log));
        web.MapPost("/acessos/apps/gerar", (AccessStore a, ILogger<AccessStore> log) => Rotate("apps", a.RegenerateAppsToken, a, log));

        // Rotina dos apps do hub (MCPs de Tarefas, Finanças e Criativo).
        web.MapGet("/apps", (AppsSyncService sync, AccessStore a) => Results.Ok(DescribeApps(sync.Load(), a)));
        web.MapPut("/apps", (WebAppsDto dto, AppsSyncService sync, AccessStore a) =>
            Results.Ok(DescribeApps(sync.Configure(dto.Ativo, dto.Horarios ?? [], dto.Apps ?? []), a)));
        web.MapPost("/apps/sincronizar", async (AppsSyncService sync, AccessStore a, CancellationToken ct) =>
        {
            await sync.RunAsync("manual, pela tela", ct);
            return Results.Ok(DescribeApps(sync.Load(), a));
        });
        // Resumo analítico: uma chamada de IA só quando você pede; a última fica guardada.
        web.MapGet("/resumo", (DigestService d) => Results.Ok(new { resumo = d.Last(), limite_caracteres = DigestService.Budget }));
        web.MapPost("/resumo/gerar", async (WebResumoDto dto, DigestService d, CancellationToken ct) =>
            Results.Ok(new { resumo = await d.GenerateAsync(dto.Dias ?? 14, dto.Salvar ?? false, ct), limite_caracteres = DigestService.Budget }));
        web.MapPut("/acessos/webdav", SetWebdav);
        web.MapPost("/acessos/api-keys", CreateApiKey);
        web.MapDelete("/acessos/api-keys/{nome}", DeleteApiKey);
    }

    private static async ValueTask<object?> RequireEnabledAndHandleErrors(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var http = ctx.HttpContext;
        var options = http.RequestServices.GetRequiredService<IOptions<HubOptions>>().Value;
        if (!options.Web.Enabled)
            return Results.Problem("Tela web desativada: defina Hub__Web__JwtSecret e Hub__Web__Usuarios.", statusCode: 503);
        try
        {
            return await next(ctx);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Endpoints.MapError(ex, http);
        }
    }

    private static IResult Me(HttpContext http, AiSettings ai, IOptions<HubOptions> options, ApiKeyAuth auth, Transcriber transcriber)
    {
        var effective = ai.Resolve();
        return Results.Ok(new
        {
            email = http.User.FindFirst("email")?.Value,
            classificacao = effective.Enabled,
            provedor = effective.Provider,
            modelo = effective.Model,
            transcricao = transcriber.Enabled,
            mcp = auth.McpEnabled,
            api_keys = options.Value.ApiKeys.Where(kv => !string.IsNullOrWhiteSpace(kv.Value)).Select(kv => kv.Key).Order().ToList(),
            webdav_pasta = Path.GetFileName(options.Value.VaultPath.TrimEnd('/')),
            pastas = VaultLayout.PermanentFolders,
        });
    }

    private static IResult GetAi(AiSettings ai, IOptions<HubOptions> options) => Results.Ok(DescribeAi(ai, options.Value));

    private static object DescribeAi(AiSettings ai, HubOptions options)
    {
        var (stored, updatedAt) = ai.Load();
        var key = ai.StoredKey();
        var effective = ai.Resolve();
        return new
        {
            provedor = stored.Provider,
            modelo = stored.Model,
            chave_configurada = key is not null,
            chave_mascarada = key is null ? null : AiSettings.Mask(key),
            // A chave cifrada existe mas não abre: JWT_SECRET mudou desde que foi salva.
            chave_invalida = stored.EncryptedKey is not null && key is null,
            servidor = new
            {
                anthropic = options.Anthropic.Enabled,
                openrouter = options.OpenRouter.Enabled,
                modelo_anthropic = options.Anthropic.Model,
                modelo_openrouter = options.OpenRouter.Model,
            },
            efetivo = new
            {
                provedor = effective.Provider,
                modelo = effective.Model,
                ativo = effective.Enabled,
                origem_da_chave = effective.KeySource,
            },
            modelos = new
            {
                openrouter = AiSettings.OpenRouterModels,
                anthropic = AiSettings.AnthropicModels,
            },
            atualizado_em = updatedAt,
        };
    }

    private static object DescribeTranscription(TranscriptionSettings t)
    {
        var stored = t.Load();
        var key = t.StoredKey();
        var e = t.Resolve();
        return new
        {
            servico = stored.Preset ?? TranscriptionSettings.Presets[0].Id,
            modelo = stored.Model,
            chave_configurada = key is not null,
            chave_mascarada = key is null ? null : SecretBox.Mask(key),
            chave_invalida = stored.EncryptedKey is not null && key is null,
            efetivo = new { ligado = e.Enabled, origem = e.KeySource, modelo = e.Model, url = e.BaseUrl },
            servicos = TranscriptionSettings.Presets.Select(p => new { id = p.Id, nome = p.Name, modelo = p.Model, descricao = p.Description }),
        };
    }

    private static IResult SaveTranscription(WebTranscricaoDto dto, TranscriptionSettings t)
    {
        if (dto.Modelo?.Length > 200 || dto.ChaveApi?.Length > 500)
            return Results.BadRequest(new { error = "Modelo ou chave longos demais." });
        if (!string.IsNullOrWhiteSpace(dto.ChaveApi) && !t.CanStoreKeys)
            return Results.BadRequest(new { error = "Sem JWT_SECRET no servidor não dá para guardar a chave." });
        if (dto.Servico is not null && TranscriptionSettings.Presets.All(p => p.Id != dto.Servico))
            return Results.BadRequest(new { error = "Serviço deve ser openai ou groq." });
        t.Save(dto.Servico, dto.Modelo, dto.ChaveApi);
        return Results.Ok(DescribeTranscription(t));
    }

    private static IResult SaveAi(WebAiDto dto, AiSettings ai, IOptions<HubOptions> options)
    {
        var provider = dto.Provedor ?? AiProvider.Default;
        if (!AiProvider.IsValid(provider))
            return Results.BadRequest(new { error = "Provedor deve ser openrouter, anthropic, off ou vazio." });
        if (dto.Modelo?.Length > 200 || dto.ChaveApi?.Length > 500)
            return Results.BadRequest(new { error = "Modelo ou chave longos demais." });
        if (!string.IsNullOrWhiteSpace(dto.ChaveApi) && !ai.CanStoreKeys)
            return Results.BadRequest(new { error = "Sem JWT_SECRET no servidor não dá para guardar a chave." });
        ai.Save(provider, dto.Modelo, dto.ChaveApi);
        return Results.Ok(DescribeAi(ai, options.Value));
    }

    /// <summary>Classifica um texto de exemplo com a configuração da tela (salva ou ainda não), sem gravar nada no vault.</summary>
    private static async Task<IResult> TestAi(WebAiDto dto, AiSettings ai, ClaudeClassifier classifier, CancellationToken ct)
    {
        if (dto.Provedor is not null && !AiProvider.IsValid(dto.Provedor))
            return Results.BadRequest(new { error = "Provedor inválido." });
        var effective = ai.Resolve(dto.Provedor, dto.Modelo, dto.ChaveApi);
        if (!effective.Enabled)
            return Results.Ok(new { ok = false, mensagem = "Sem chave para este provedor: cole uma chave ou configure no servidor.", exemplo = (object?)null });
        try
        {
            var r = await classifier.ClassifyAsync(
                "Teste", "Ideia: usar o Obsidian na VPS para guardar resumos de reuniões e ligar com projetos.",
                "teste", VaultLayout.PermanentFolders, [], ct, effective);
            return Results.Ok(new
            {
                ok = true,
                mensagem = $"Funcionou com {(effective.Provider == AiProvider.Anthropic ? "Anthropic" : "OpenRouter")} · {effective.Model}.",
                exemplo = (object?)new { titulo = r.Title, resumo = r.Summary, tags = r.Tags, pasta = r.Folder },
            });
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            return Results.Ok(new { ok = false, mensagem = ex.Message, exemplo = (object?)null });
        }
    }

    private static IResult GetAccess(AccessStore access, IOptions<HubOptions> options)
    {
        var webdav = access.Webdav;
        return Results.Ok(new
        {
            pode_guardar = access.Available,
            mcp = new { configurado = access.McpToken is not null, origem = access.McpTokenSource, mascarado = SecretBox.Mask(access.McpToken) },
            // O token do .env do ops não é conhecido aqui: só o gerado pela tela pode ser mostrado.
            ops = new { configurado = access.OpsToken is not null, mascarado = SecretBox.Mask(access.OpsToken) },
            apps = new { configurado = access.AppsToken is not null, mascarado = SecretBox.Mask(access.AppsToken) },
            webdav = new
            {
                configurado = webdav is not null,
                origem = access.WebdavSource,
                usuario = webdav?.User,
                pasta = Path.GetFileName(options.Value.VaultPath.TrimEnd('/')),
            },
            api_keys = access.ApiKeys().Select(k => new { nome = k.Name, origem = k.Source, mascarada = SecretBox.Mask(k.Value) }),
        });
    }

    private static object DescribeApps(AppsSyncService.Settings s, AccessStore access) => new
    {
        ativo = s.Enabled,
        horarios = s.EffectiveTimes,
        token_configurado = access.AppsToken is not null,
        apps = AppsSyncService.Apps.Select(a => new
        {
            id = a.Id,
            nome = a.Name,
            descricao = a.Description,
            nota = $"{VaultLayout.Apps}/{a.Note}.md",
            ativo = s.AppEnabled(a.Id),
        }),
        ultima = s.Last is null ? null : new
        {
            em = s.Last.At,
            gatilho = s.Last.Trigger,
            resultados = s.Last.Results.Select(r => new { app = r.App, ok = r.Ok, erro = r.Error, nota = r.Note }),
        },
    };

    private static IResult RevealAccess(WebRevealDto dto, AccessStore access, HttpContext http, ILogger<AccessStore> log)
    {
        string? value = dto.Item switch
        {
            "mcp" => access.McpToken,
            "ops" => access.OpsToken,
            "apps" => access.AppsToken,
            "webdav" => access.Webdav?.Pass,
            _ when dto.Item.StartsWith("api:", StringComparison.Ordinal) =>
                access.ApiKeys().FirstOrDefault(k => k.Name == dto.Item[4..]).Value,
            _ => null,
        };
        if (value is null) return Results.NotFound(new { error = "Acesso não configurado." });
        log.LogWarning("Acesso revelado na tela: {Item} por {Email}", dto.Item, http.User.FindFirst("email")?.Value);
        return Results.Ok(new { valor = value });
    }

    private static IResult Rotate(string item, Func<string> regenerate, AccessStore access, ILogger<AccessStore> log)
    {
        if (!access.Available) return Results.BadRequest(new { error = "Sem JWT_SECRET no servidor não dá para guardar tokens." });
        var value = regenerate();
        log.LogWarning("Token regenerado na tela: {Item}", item);
        return Results.Ok(new { valor = value });
    }

    private static IResult SetWebdav(WebWebdavDto dto, AccessStore access, ILogger<AccessStore> log)
    {
        if (!access.Available) return Results.BadRequest(new { error = "Sem JWT_SECRET no servidor não dá para guardar a senha." });
        var (user, pass) = access.SetWebdav(dto.Usuario ?? "", dto.Senha);
        log.LogWarning("Login do WebDAV alterado na tela: {User}", user);
        return Results.Ok(new { usuario = user, senha = pass });
    }

    private static IResult CreateApiKey(WebNameDto dto, AccessStore access)
    {
        if (!access.Available) return Results.BadRequest(new { error = "Sem JWT_SECRET no servidor não dá para guardar chaves." });
        var value = access.CreateApiKey(dto.Nome ?? "");
        return Results.Ok(new { nome = dto.Nome!.Trim().ToLowerInvariant(), valor = value });
    }

    private static IResult DeleteApiKey(string nome, AccessStore access) =>
        access.DeleteApiKey(nome)
            ? Results.NoContent()
            : Results.NotFound(new { error = "Só dá para apagar pela tela as chaves criadas pela tela; as do .env saem editando o .env." });

    /// <summary>Volta a captura para a fila (ex.: chegou antes de haver chave). A extração não se repete.</summary>
    private static IResult Reclassify(WebPathDto dto, HubDb db, ProcessingQueue queue, AiSettings ai)
    {
        if (!ai.Resolve().Enabled)
            return Results.BadRequest(new { error = "Configure um provedor de IA antes (aba Configurações)." });
        var capture = db.FindByPath(VaultLayout.NormalizeRelative(dto.Path));
        if (capture is null || !VaultLayout.IsUnder(capture.Path, VaultLayout.Inbox))
            return Results.NotFound(new { error = "Item da Inbox não encontrado." });
        db.Update(capture.Id, status: CaptureStatus.Queued, clearError: true);
        queue.Enqueue(capture.Id);
        return Results.Ok(new { id = capture.Id, status = CaptureStatus.Queued });
    }

    private static async Task<IResult> Inbox(VaultStore vault, HubDb db, CancellationToken ct)
    {
        var items = new List<object>();
        foreach (var rel in vault.EnumerateNotes(VaultLayout.Inbox).OrderByDescending(p => p))
        {
            var doc = await vault.ReadAsync(rel, ct);
            var fm = doc.FrontMatter;
            var body = doc.Body.Trim();
            var capture = db.FindByPath(rel);
            items.Add(new
            {
                path = rel,
                id = capture?.Id,
                title = VaultLayout.StripCapturePrefix(doc.ResolveTitle(rel)),
                status = fm.GetString("status"),
                capture_status = capture?.Status,
                erro = capture?.Error,
                source = fm.GetString("source") ?? capture?.Source,
                trust = fm.GetString("trust"),
                summary = fm.GetString("summary"),
                tags = fm.GetList("tags"),
                suggested_folder = fm.GetString("suggested_folder"),
                suggested_links = fm.GetList("suggested_links"),
                excerpt = body.Length > ExcerptChars ? body[..ExcerptChars] + "…" : body,
                created_at = capture?.CreatedAt,
            });
        }
        return Results.Ok(items);
    }

    private static async Task<IResult> Capture(WebCaptureDto dto, IngestService ingest, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Content) && string.IsNullOrWhiteSpace(dto.Url))
            return Results.BadRequest(new { error = "Escreva algo ou cole um link." });
        if (dto.Content?.Length > 200_000)
            return Results.BadRequest(new { error = "Texto muito longo." });
        var url = dto.Url?.Trim();
        if (!string.IsNullOrEmpty(url) && !(Uri.TryCreate(url, UriKind.Absolute, out var u) && (u.Scheme == "http" || u.Scheme == "https")))
            return Results.BadRequest(new { error = "O link precisa começar com http:// ou https://." });

        var result = await ingest.CaptureAsync(new CaptureRequest(
            "manual", null, string.IsNullOrEmpty(url) ? CaptureKind.Text : CaptureKind.Link,
            dto.Content, string.IsNullOrEmpty(url) ? null : url, null, dto.Tags, null), ct);
        return Results.Ok(result);
    }

    /// <summary>
    /// Captura com arquivo (app do celular): áudio gravado ou recebido do WhatsApp, foto, PDF. Áudio é
    /// transcrito pelo pipeline; o texto opcional vai junto. Vai para a Inbox como as outras capturas.
    /// </summary>
    private static async Task<IResult> CaptureFile(HttpRequest request, IngestService ingest, VaultStore vault, HubClock clock, CancellationToken ct)
    {
        if (!request.HasFormContentType)
            return Results.BadRequest(new { error = "Envie multipart/form-data com o campo arquivo." });
        var form = await request.ReadFormAsync(ct);
        var file = form.Files.GetFile("arquivo") ?? form.Files.FirstOrDefault();
        if (file is null || file.Length == 0)
            return Results.BadRequest(new { error = "Arquivo vazio." });
        if (file.Length > 25 * 1024 * 1024)
            return Results.BadRequest(new { error = "Arquivo maior que 25 MB." });

        var origem = form["origem"].FirstOrDefault() is "compartilhado" ? "compartilhado" : "celular";
        string attachment;
        await using (var stream = file.OpenReadStream())
            attachment = await vault.SaveAttachmentAsync(stream, file.FileName, clock.Now, $"anexo {origem}", ct);

        var tags = form["tags"].FirstOrDefault()?
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToList();
        var texto = form["texto"].FirstOrDefault();
        if (texto?.Length > 200_000) return Results.BadRequest(new { error = "Texto muito longo." });

        var result = await ingest.CaptureAsync(new CaptureRequest(
            origem, null, CaptureKind.File, texto, null, null, tags, null, AttachmentPath: attachment), ct);
        return Results.Ok(result);
    }

    private static async Task<IResult> Approve(WebDecisionDto dto, ApprovalService approval, NoteIndex index, CancellationToken ct)
    {
        var from = approval.ResolvePath(dto.Path);
        var r = await approval.ApproveAsync(dto.Path, dto.Folder, ct);
        await Reindex(index, from, r.Path, ct);
        return Results.Ok(r);
    }

    private static async Task<IResult> Reject(WebDecisionDto dto, ApprovalService approval, NoteIndex index, CancellationToken ct)
    {
        var from = approval.ResolvePath(dto.Path);
        var r = await approval.RejectAsync(dto.Path, ct);
        await Reindex(index, from, r.Path, ct);
        return Results.Ok(r);
    }

    /// <summary>
    /// Atualiza o índice na hora (o watcher faria o mesmo segundos depois): quem aprova e abre a aba
    /// Notas logo em seguida já vê a nota no lugar novo.
    /// </summary>
    private static async Task Reindex(NoteIndex index, string from, string to, CancellationToken ct)
    {
        if (from != to) await index.RemoveAsync(from, ct);
        await index.UpsertAsync(to, ct);
    }

    /// <summary>Pastas do vault com contagem e as notas de uma pasta (ou de todas), mais recentes primeiro.</summary>
    private static IResult ListNotes(string? pasta, int? limite, NoteIndex index)
    {
        var counts = index.TopFolderCounts();
        string? folder = string.IsNullOrWhiteSpace(pasta) ? null : VaultLayout.NormalizeRelative(pasta);
        var notes = index.List(folder, limit: Math.Clamp(limite ?? 200, 1, 500));
        return Results.Ok(new
        {
            pastas = counts.OrderBy(kv => kv.Key, StringComparer.Ordinal)
                .Select(kv => new { pasta = kv.Key, total = kv.Value }),
            notas = notes.Select(n => new
            {
                path = n.Path,
                title = n.Title,
                folder = n.Folder,
                tags = n.Tags,
                status = n.Status,
                modified = n.Modified,
            }),
        });
    }

    /// <summary>Uma nota inteira para leitura na tela, com as ligações já resolvidas para caminhos.</summary>
    private static async Task<IResult> ReadNote(string path, VaultStore vault, NoteIndex index, CancellationToken ct)
    {
        var rel = VaultLayout.NormalizeRelative(path);
        if (!rel.EndsWith(".md", StringComparison.OrdinalIgnoreCase) || !vault.Exists(rel))
            return Results.NotFound(new { error = "Nota não encontrada." });

        var doc = await vault.ReadAsync(rel, ct);
        var fm = doc.FrontMatter;
        var body = doc.Body.Length > 200_000 ? doc.Body[..200_000] + "\n\n… (nota cortada na tela; abra no Obsidian para ver tudo)" : doc.Body;
        var links = doc.ResolveLinks().Distinct(StringComparer.OrdinalIgnoreCase)
            .ToDictionary(l => l, l => index.ResolveLink(l), StringComparer.OrdinalIgnoreCase);

        return Results.Ok(new
        {
            path = rel,
            title = VaultLayout.StripCapturePrefix(doc.ResolveTitle(rel)),
            folder = VaultLayout.FolderOf(rel),
            tags = doc.ResolveTags(),
            summary = fm.GetString("summary"),
            source = fm.GetString("source"),
            url = fm.GetString("url"),
            trust = fm.GetString("trust"),
            modified = File.GetLastWriteTimeUtc(vault.FullPath(rel)),
            body,
            // Texto completo (com frontmatter) e versão, para o editor salvar sem atropelar o Obsidian.
            raw = await vault.ReadRawAsync(rel, ct),
            versao = vault.Version(rel),
            editavel = VaultLayout.UserCanEdit(rel),
            na_lixeira = VaultLayout.IsUnder(rel, VaultLayout.Trash),
            links,
            backlinks = index.Backlinks(rel).Select(b => new { path = b, title = Path.GetFileNameWithoutExtension(b) }),
        });
    }

    private static async Task<IResult> CreateNote(WebNewNoteDto dto, VaultStore vault, NoteIndex index, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Titulo)) return Results.BadRequest(new { error = "Dê um título para a nota." });
        if (dto.Conteudo?.Length > 1_000_000) return Results.BadRequest(new { error = "Nota grande demais para a tela (1 MB)." });
        var rel = await vault.UserCreateAsync(dto.Pasta ?? "", dto.Titulo, dto.Conteudo, ct: ct);
        await index.UpsertAsync(rel, ct);
        return Results.Ok(new { path = rel, versao = vault.Version(rel) });
    }

    private static async Task<IResult> SaveNote(WebSaveNoteDto dto, VaultStore vault, NoteIndex index, CancellationToken ct)
    {
        if (dto.Conteudo is null || dto.Conteudo.Length > 1_000_000) return Results.BadRequest(new { error = "Conteúdo vazio ou grande demais (1 MB)." });
        try
        {
            var versao = await vault.UserSaveAsync(dto.Path, dto.Conteudo, dto.Versao ?? "", ct: ct);
            var rel = VaultLayout.NormalizeRelative(dto.Path);
            await index.UpsertAsync(rel, ct);
            return Results.Ok(new { path = rel, versao });
        }
        catch (NoteConflictException ex)
        {
            return Results.Conflict(new { error = ex.Message, versao_atual = ex.CurrentVersion, conteudo_atual = await vault.ReadRawAsync(ex.Path, ct) });
        }
    }

    private static async Task<IResult> MoveNote(WebMoveNoteDto dto, VaultStore vault, NoteIndex index, CancellationToken ct)
    {
        var from = VaultLayout.NormalizeRelative(dto.Path);
        var to = await vault.UserMoveAsync(from, dto.Pasta ?? VaultLayout.FolderOf(from), dto.Nome, ct: ct);
        if (to != from) await index.RemoveAsync(from, ct);
        await index.UpsertAsync(to, ct);
        return Results.Ok(new { path = to });
    }

    private static async Task<IResult> TrashNote(WebPathDto dto, VaultStore vault, NoteIndex index, CancellationToken ct)
    {
        var from = VaultLayout.NormalizeRelative(dto.Path);
        var to = await vault.UserTrashAsync(from, ct: ct);
        await index.RemoveAsync(from, ct);
        await index.UpsertAsync(to, ct);
        return Results.Ok(new { path = to });
    }

    /// <summary>O log do Cérebro: versões com data, quem mudou (tela, MCP, sync do Obsidian) e arquivos.</summary>
    private static async Task<IResult> History(string? path, int? limite, int? pular, GitSnapshotter git, CancellationToken ct)
    {
        var rel = string.IsNullOrWhiteSpace(path) ? null : VaultLayout.NormalizeRelative(path);
        var entries = await git.HistoryAsync(rel, limite ?? 50, pular ?? 0, ct);
        return Results.Ok(new
        {
            disponivel = git.Ready,
            versoes = entries.Select(e => new
            {
                versao = e.Commit,
                curta = e.Commit[..7],
                data = e.Date,
                mensagem = e.Message,
                origem = Origin(e.Message),
                arquivos = e.Changes.Where(c => !c.Path.Split('/').Any(p => p.StartsWith('.')))
                    .Select(c => new { status = c.Status, path = c.Path }),
            }),
        });
    }

    /// <summary>Quem fez a mudança, a partir da mensagem do commit.</summary>
    private static string Origin(string message) =>
        message.StartsWith("sync:", StringComparison.Ordinal) ? "obsidian"
        : message.Contains("(MCP)") || message.Contains("pelo Claude") || message.Contains("captura mcp") ? "claude"
        : message.Contains("pela tela") ? "tela"
        : "cerebro";

    private static async Task<IResult> VersionContent(string versao, string path, GitSnapshotter git, CancellationToken ct)
    {
        var content = await git.ShowAsync(versao, VaultLayout.NormalizeRelative(path), ct);
        return content is null ? Results.NotFound(new { error = "A nota não existia nessa versão." }) : Results.Ok(new { conteudo = content });
    }

    private static async Task<IResult> RestoreNote(WebRestoreDto dto, VersionService versions, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Path)) return Results.BadRequest(new { error = "Informe a nota." });
        var rel = await versions.RestoreNoteAsync(dto.Versao, dto.Path, "pela tela", ct);
        return Results.Ok(new { path = rel });
    }

    private static async Task<IResult> RestoreVault(WebRestoreDto dto, VersionService versions, CancellationToken ct) =>
        Results.Ok(await versions.RestoreVaultAsync(dto.Versao, "pela tela", ct));

    /// <summary>O que saiu da Inbox (aprovado ou rejeitado), mais recente primeiro.</summary>
    private static IResult RecentDecisions(HubDb db, VaultStore vault) =>
        Results.Ok(db.ListByStatus(CaptureStatus.Filed, CaptureStatus.Rejected)
            .OrderByDescending(c => c.UpdatedAt)
            .Take(50)
            .Select(c => new
            {
                path = c.Path,
                title = VaultLayout.StripCapturePrefix(Path.GetFileNameWithoutExtension(c.Path)),
                status = c.Status == CaptureStatus.Filed ? "aprovada" : "rejeitada",
                folder = VaultLayout.FolderOf(c.Path),
                source = c.Source,
                decided_at = c.UpdatedAt,
                exists = vault.Exists(c.Path),
            }));

    private static IResult Search(string? q, NoteIndex index) =>
        string.IsNullOrWhiteSpace(q)
            ? Results.Ok(index.List(limit: 30).Select(n => new { n.Path, n.Title, snippet = "", n.Folder }))
            : Results.Ok(index.Search(q, limit: 30).Select(h => new { h.Path, h.Title, h.Snippet, folder = VaultLayout.FolderOf(h.Path) }));
}
