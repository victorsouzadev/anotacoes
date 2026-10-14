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
        web.MapPost("/inbox/approve", Approve);
        web.MapPost("/inbox/reject", Reject);
        web.MapGet("/search", Search);
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

    private static IResult Me(HttpContext http, ClaudeClassifier classifier) => Results.Ok(new
    {
        email = http.User.FindFirst("email")?.Value,
        classificacao = classifier.Enabled,
        pastas = VaultLayout.PermanentFolders,
    });

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

    private static async Task<IResult> Approve(WebDecisionDto dto, ApprovalService approval, CancellationToken ct) =>
        Results.Ok(await approval.ApproveAsync(dto.Path, dto.Folder, ct));

    private static async Task<IResult> Reject(WebDecisionDto dto, ApprovalService approval, CancellationToken ct) =>
        Results.Ok(await approval.RejectAsync(dto.Path, ct));

    private static IResult Search(string? q, NoteIndex index) =>
        string.IsNullOrWhiteSpace(q)
            ? Results.Ok(index.List(limit: 30).Select(n => new { n.Path, n.Title, snippet = "", n.Folder }))
            : Results.Ok(index.Search(q, limit: 30).Select(h => new { h.Path, h.Title, h.Snippet, folder = VaultLayout.FolderOf(h.Path) }));
}
