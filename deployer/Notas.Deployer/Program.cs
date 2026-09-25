using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using Notas.Deployer;

// Deployer: o único serviço com o docker.sock. Escuta só na rede interna do compose e
// só obedece à API do notas (token compartilhado). Ver docs/poc-multi-app/DISCOVERY.md.
var builder = WebApplication.CreateBuilder(args);
var token = builder.Configuration["DEPLOYER_TOKEN"];
if (string.IsNullOrWhiteSpace(token) || token.Length < 32)
    throw new InvalidOperationException("Defina DEPLOYER_TOKEN (pelo menos 32 caracteres).");
var cfg = new Configuracao
{
    RaizSitesNoHost = builder.Configuration["SITES_HOST_DIR"]
        ?? throw new InvalidOperationException("Defina SITES_HOST_DIR (caminho de data/sites no host)."),
    Rede = builder.Configuration["DEPLOYER_REDE"] ?? "notas-sites",
};
var docker = builder.Configuration["DOCKER_BIN"] ?? "docker";

var app = builder.Build();
var tokenBytes = Encoding.UTF8.GetBytes("Bearer " + token);

app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path == "/health") { await next(ctx); return; }
    var recebido = Encoding.UTF8.GetBytes(ctx.Request.Headers.Authorization.ToString());
    if (!CryptographicOperations.FixedTimeEquals(recebido, tokenBytes))
    {
        ctx.Response.StatusCode = 401;
        return;
    }
    await next(ctx);
});

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/apps", async (CancellationToken ct) =>
{
    var r = await Docker(ComandosDocker.Listar(), TimeSpan.FromSeconds(30), ct);
    if (r.Codigo != 0) return Erro(r);
    var slugs = r.Saida.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct().ToList();
    return Results.Ok(slugs);
});

app.MapPost("/apps/{slug}/iniciar", async (string slug, IniciarApp req, ILogger<Program> log, CancellationToken ct) =>
{
    if (ComandosDocker.Validar(slug, req) is { } invalido) return Results.BadRequest(invalido);
    await Docker(ComandosDocker.Remover(slug), TimeSpan.FromSeconds(60), ct);
    log.LogInformation("Iniciando {Slug} ({DeployId}, .NET {Runtime})", slug, req.DeployId, req.Runtime);
    // Na primeira vez de cada runtime o docker baixa a imagem aspnet: pode demorar.
    var r = await Docker(ComandosDocker.Run(slug, req, cfg), TimeSpan.FromMinutes(5), ct);
    return r.Codigo == 0 ? Results.Ok() : Erro(r);
});

app.MapPost("/apps/{slug}/remover", async (string slug, CancellationToken ct) =>
{
    if (ComandosDocker.ValidarSlug(slug) is { } invalido) return Results.BadRequest(invalido);
    var r = await Docker(ComandosDocker.Remover(slug), TimeSpan.FromSeconds(60), ct);
    // "No such container" não é erro: remover é idempotente.
    return r.Codigo == 0 || r.Erro.Contains("No such container") ? Results.Ok() : Erro(r);
});

app.MapGet("/apps/{slug}/logs", async (string slug, int? linhas, CancellationToken ct) =>
{
    if (ComandosDocker.ValidarSlug(slug) is { } invalido) return Results.BadRequest(invalido);
    var r = await Docker(ComandosDocker.Logs(slug, linhas ?? 200), TimeSpan.FromSeconds(30), ct);
    if (r.Codigo != 0 && r.Erro.Contains("No such container"))
        return Results.Text("(o app não está rodando)", "text/plain; charset=utf-8");
    if (r.Codigo != 0) return Erro(r);
    // docker logs devolve o stdout do app na saída e o stderr no erro: junta os dois.
    return Results.Text(r.Saida + r.Erro, "text/plain; charset=utf-8");
});

app.Run();

IResult Erro(Resultado r) => Results.Text($"docker saiu com {r.Codigo}: {r.Erro.Trim()}", statusCode: 500);

async Task<Resultado> Docker(List<string> argumentos, TimeSpan limite, CancellationToken ct)
{
    var psi = new ProcessStartInfo(docker)
    {
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        UseShellExecute = false,
    };
    // ArgumentList, nunca uma string: nada passa por shell.
    foreach (var a in argumentos) psi.ArgumentList.Add(a);
    using var p = Process.Start(psi)!;
    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
    timeout.CancelAfter(limite);
    var saida = p.StandardOutput.ReadToEndAsync(timeout.Token);
    var erro = p.StandardError.ReadToEndAsync(timeout.Token);
    try
    {
        await p.WaitForExitAsync(timeout.Token);
        return new Resultado(p.ExitCode, await saida, await erro);
    }
    catch (OperationCanceledException)
    {
        try { p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
        return new Resultado(-1, "", $"docker {argumentos[0]} passou de {limite.TotalSeconds:0} s");
    }
}

record Resultado(int Codigo, string Saida, string Erro);

public partial class Program;
