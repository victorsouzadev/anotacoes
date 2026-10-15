using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Hub.Core;
using Hub.Data;
using Hub.Index;
using Hub.Pipeline;
using Hub.Vault;

namespace Hub.Api;

public sealed record CaptureDto(
    string? Source,
    string? ExternalId,
    string? Kind,
    string? Content,
    string? Url,
    string? Title,
    List<string>? Tags,
    DateTimeOffset? OccurredAt);

public sealed record DailyDto(string Text, DateOnly? Date, string? Source);

public sealed record DecisionDto(string? Folder);

public static class Endpoints
{
    private const int MaxContentChars = 200_000;
    private const int MaxWebhookBytes = 1024 * 1024;

    public static void MapHubApi(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1")
            .AddEndpointFilter(RequireApiKeyAndHandleErrors)
            .RequireRateLimiting("api");

        api.MapPost("/captures", CreateCapture);
        api.MapPost("/captures/file", UploadFile);
        api.MapGet("/captures/{id}", GetCapture);
        api.MapPost("/captures/{id}/approve", Approve);
        api.MapPost("/captures/{id}/reject", Reject);
        api.MapPost("/daily", AppendDaily);
        api.MapPost("/webhooks/{source}", Webhook);

        // Bookmarklet: o navegador só consegue mandar a chave na URL.
        app.MapGet("/api/v1/quick", Quick).RequireRateLimiting("api");

        app.MapGet("/health", Health);
    }

    private static async ValueTask<object?> RequireApiKeyAndHandleErrors(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var http = ctx.HttpContext;
        var auth = http.RequestServices.GetRequiredService<ApiKeyAuth>();
        var keyName = auth.Authenticate(http);
        if (keyName is null) return Results.Unauthorized();
        http.Items["api_key_name"] = keyName;

        try
        {
            return await next(ctx);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return MapError(ex, http);
        }
    }

    internal static IResult MapError(Exception ex, HttpContext http)
    {
        var log = http.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Hub.Api");
        switch (ex)
        {
            case VaultAccessException or ArgumentException or JsonException:
                return Results.BadRequest(new { error = ex.Message });
            case FileNotFoundException:
                return Results.NotFound(new { error = ex.Message });
            case InvalidOperationException:
                return Results.UnprocessableEntity(new { error = ex.Message });
            default:
                log.LogError(ex, "Erro na API");
                return Results.Problem("Erro interno.");
        }
    }

    private static string KeyName(HttpContext http) => http.Items["api_key_name"] as string ?? "api";

    private static IResult ToResult(CaptureResult r) =>
        r.Duplicate ? Results.Ok(r) : Results.Accepted($"/api/v1/captures/{r.Id}", r);

    private static async Task<IResult> CreateCapture(CaptureDto dto, HttpContext http, IngestService ingest, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Content) && string.IsNullOrWhiteSpace(dto.Url))
            return Results.BadRequest(new { error = "Informe content ou url." });
        if (dto.Content?.Length > MaxContentChars)
            return Results.BadRequest(new { error = $"content acima de {MaxContentChars} caracteres." });
        if (!string.IsNullOrWhiteSpace(dto.Url) && !IsHttpUrl(dto.Url))
            return Results.BadRequest(new { error = "url precisa ser http ou https." });

        var kind = dto.Kind ?? (string.IsNullOrWhiteSpace(dto.Url) ? CaptureKind.Text : CaptureKind.Link);
        if (kind is not (CaptureKind.Text or CaptureKind.Link))
            return Results.BadRequest(new { error = "kind deve ser text ou link (arquivos: /captures/file)." });

        var result = await ingest.CaptureAsync(new CaptureRequest(
            dto.Source ?? KeyName(http), dto.ExternalId, kind, dto.Content, dto.Url, dto.Title, dto.Tags, dto.OccurredAt), ct);
        return ToResult(result);
    }

    private static async Task<IResult> UploadFile(HttpRequest request, IngestService ingest, VaultStore vault, HubClock clock, CancellationToken ct)
    {
        if (!request.HasFormContentType)
            return Results.BadRequest(new { error = "Envie multipart/form-data com o campo file." });

        var form = await request.ReadFormAsync(ct);
        var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
        if (file is null || file.Length == 0)
            return Results.BadRequest(new { error = "Campo file vazio." });

        var source = form["source"].FirstOrDefault() ?? KeyName(request.HttpContext);
        var externalId = form["external_id"].FirstOrDefault();
        if (ingest.FindDuplicate(source, externalId) is { } dup) return Results.Ok(dup);

        string attachment;
        await using (var stream = file.OpenReadStream())
            attachment = await vault.SaveAttachmentAsync(stream, file.FileName, clock.Now, $"anexo {source}", ct);

        var tags = form["tags"].FirstOrDefault()?
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToList();

        var result = await ingest.CaptureAsync(new CaptureRequest(
            source, externalId, CaptureKind.File,
            form["content"].FirstOrDefault(), null, form["title"].FirstOrDefault(),
            tags, null, AttachmentPath: attachment), ct);
        return ToResult(result);
    }

    private static IResult GetCapture(string id, HubDb db) =>
        db.Get(id) is { } c
            ? Results.Ok(new { c.Id, c.Source, c.ExternalId, c.Kind, c.Path, c.Status, c.Attempts, c.Error, c.CreatedAt, c.UpdatedAt })
            : Results.NotFound(new { error = "Captura não encontrada." });

    private static async Task<IResult> Approve(string id, DecisionDto? dto, ApprovalService approval, CancellationToken ct) =>
        Results.Ok(await approval.ApproveAsync(id, dto?.Folder, ct));

    private static async Task<IResult> Reject(string id, ApprovalService approval, CancellationToken ct) =>
        Results.Ok(await approval.RejectAsync(id, ct));

    private static async Task<IResult> AppendDaily(DailyDto dto, HttpContext http, VaultStore vault, HubClock clock, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Text)) return Results.BadRequest(new { error = "text vazio." });
        if (dto.Text.Length > 10_000) return Results.BadRequest(new { error = "text muito longo." });

        var date = dto.Date ?? clock.Today;
        await DailyNote.AppendAsync(vault, clock, dto.Text, date, dto.Source ?? KeyName(http), ct);
        return Results.Ok(new { path = VaultLayout.DailyPath(date) });
    }

    private static async Task<IResult> Webhook(string source, HttpRequest request, IngestService ingest, CancellationToken ct)
    {
        if (request.ContentLength > MaxWebhookBytes)
            return Results.StatusCode((int)HttpStatusCode.RequestEntityTooLarge);

        using var reader = new StreamReader(request.Body);
        var raw = await reader.ReadToEndAsync(ct);
        if (raw.Length > MaxWebhookBytes)
            return Results.StatusCode((int)HttpStatusCode.RequestEntityTooLarge);

        JsonNode? json = null;
        try { json = JsonNode.Parse(raw); } catch (JsonException) { /* texto puro */ }

        string? content, externalId, url, title;
        if (json is null)
        {
            content = raw;
            externalId = url = title = null;
        }
        else
        {
            content = FirstString(json, "text", "content", "message.text", "message.body", "body", "data.text", "data.message.text", "caption", "message");
            externalId = FirstString(json, "external_id", "id", "message_id", "messageId", "message.id", "data.id", "data.key.id", "key.id");
            url = FirstString(json, "url", "link", "data.url");
            title = FirstString(json, "title", "subject");
        }

        if (url is not null && !IsHttpUrl(url)) url = null;
        var keepRaw = string.IsNullOrWhiteSpace(content) && json is not null;

        var result = await ingest.CaptureAsync(new CaptureRequest(
            source, externalId, url is null ? CaptureKind.Webhook : CaptureKind.Link,
            content, url, title, null, null,
            RawPayload: keepRaw ? json!.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) : null), ct);
        return ToResult(result);
    }

    private static async Task<IResult> Quick(string? key, string? url, string? title, string? text,
        ApiKeyAuth auth, IngestService ingest, CancellationToken ct)
    {
        var keyName = auth.AuthenticateQuery(key);
        if (keyName is null) return Results.Unauthorized();
        if (string.IsNullOrWhiteSpace(url) && string.IsNullOrWhiteSpace(text))
            return Results.BadRequest(new { error = "Informe url ou text." });
        if (!string.IsNullOrWhiteSpace(url) && !IsHttpUrl(url)) url = null;

        CaptureResult result;
        try
        {
            result = await ingest.CaptureAsync(new CaptureRequest(
                keyName, null, url is null ? CaptureKind.Text : CaptureKind.Link,
                text, url, title, null, null), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Results.Content(Page("Não salvou", WebUtility.HtmlEncode(ex.Message)), "text/html; charset=utf-8", statusCode: 500);
        }

        var name = WebUtility.HtmlEncode(Path.GetFileNameWithoutExtension(result.Path));
        return Results.Content(Page("Salvo na Inbox", name), "text/html; charset=utf-8");
    }

    private static string Page(string heading, string detail) => $$"""
        <!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
        <title>{{heading}}</title>
        <body style="font:16px system-ui;padding:24px;max-width:480px;margin:auto">
        <h1 style="font-size:20px">{{heading}}</h1><p style="color:#555">{{detail}}</p>
        <script>setTimeout(function(){window.close()},1500)</script>
        </body></html>
        """;

    private static IResult Health(NoteIndex index, HubDb db, GitSnapshotter git, IndexWatcher watcher,
        AiSettings ai, Transcriber transcriber, ApiKeyAuth auth) =>
        Results.Ok(new
        {
            status = "ok",
            notas_indexadas = index.Count(),
            capturas_pendentes = db.CountByStatus(CaptureStatus.Queued, CaptureStatus.Processing),
            capturas_com_erro = db.CountByStatus(CaptureStatus.Error),
            ultimo_commit = git.LastCommitAt,
            ultima_mudanca_no_vault = watcher.LastExternalChange,
            classificacao = ai.Resolve().Enabled,
            transcricao = transcriber.Enabled,
            mcp = auth.McpEnabled,
            api_keys = auth.HasKeys
        });

    private static bool IsHttpUrl(string url) =>
        Uri.TryCreate(url.Trim(), UriKind.Absolute, out var u) && (u.Scheme == "http" || u.Scheme == "https");

    /// <summary>Primeiro valor string encontrado entre caminhos "a.b.c" de um JSON.</summary>
    internal static string? FirstString(JsonNode root, params string[] paths)
    {
        foreach (var path in paths)
        {
            JsonNode? node = root;
            foreach (var part in path.Split('.'))
            {
                node = node is JsonObject obj && obj.TryGetPropertyValue(part, out var child) ? child : null;
                if (node is null) break;
            }
            if (node is JsonValue v)
            {
                if (v.TryGetValue<string>(out var s) && !string.IsNullOrWhiteSpace(s)) return s;
                if (v.TryGetValue<long>(out var n)) return n.ToString(System.Globalization.CultureInfo.InvariantCulture);
            }
        }
        return null;
    }
}
