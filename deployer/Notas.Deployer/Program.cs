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
    ContainerPostgres = builder.Configuration["DEPLOYER_POSTGRES"] ?? "notas-postgres",
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

// Backup do banco Postgres de um site, pedido pela API antes de cada deploy. O dump vai
// primeiro para um arquivo: só dá para responder 200 depois de saber que o pg_dump terminou bem.
app.MapPost("/postgres/{banco}/dump", async (string banco, HttpContext http, CancellationToken ct) =>
{
    if (ComandosDocker.ValidarBanco(banco) is { } invalido) return Results.BadRequest(invalido);
    var arquivo = Path.Combine(Path.GetTempPath(), $"dump-{Guid.NewGuid():N}");
    var r = await Docker(ComandosDocker.DumpPostgres(banco, cfg), TimeSpan.FromMinutes(5), ct, saida: arquivo);
    if (r.Codigo != 0)
    {
        File.Delete(arquivo);
        return Erro(r);
    }
    http.Response.RegisterForDispose(new ApagarAoFim(arquivo));
    return Results.File(arquivo, "application/octet-stream");
});

// Restaura um dump (corpo da requisição) no banco — que a API acabou de recriar vazio.
app.MapPost("/postgres/{banco}/restaurar", async (string banco, HttpContext http, CancellationToken ct) =>
{
    if (ComandosDocker.ValidarBanco(banco) is { } invalido) return Results.BadRequest(invalido);
    // O teto padrão do Kestrel (30 MB) é pequeno para um dump.
    if (http.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } f)
        f.MaxRequestBodySize = 2L * 1024 * 1024 * 1024;
    var arquivo = Path.Combine(Path.GetTempPath(), $"restore-{Guid.NewGuid():N}");
    try
    {
        await using (var destino = File.Create(arquivo)) await http.Request.Body.CopyToAsync(destino, ct);
        if (new FileInfo(arquivo).Length == 0) return Results.BadRequest("dump vazio");
        var r = await Docker(ComandosDocker.RestaurarPostgres(banco, cfg), TimeSpan.FromMinutes(10), ct, entrada: arquivo);
        return r.Codigo == 0 ? Results.Ok() : Erro(r);
    }
    finally
    {
        File.Delete(arquivo);
    }
});

app.Run();

IResult Erro(Resultado r) => Results.Text($"docker saiu com {r.Codigo}: {r.Erro.Trim()}", statusCode: 500);

// entrada: arquivo mandado para o stdin do docker; saida: arquivo que recebe o stdout
// (binário, sem passar por string) — usados no dump/restore do Postgres.
async Task<Resultado> Docker(List<string> argumentos, TimeSpan limite, CancellationToken ct, string? entrada = null, string? saida = null)
{
    var psi = new ProcessStartInfo(docker)
    {
        RedirectStandardInput = entrada is not null,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        UseShellExecute = false,
    };
    // ArgumentList, nunca uma string: nada passa por shell.
    foreach (var a in argumentos) psi.ArgumentList.Add(a);
    using var p = Process.Start(psi)!;
    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
    timeout.CancelAfter(limite);
    Task<string> textoSaida;
    if (saida is null)
    {
        textoSaida = p.StandardOutput.ReadToEndAsync(timeout.Token);
    }
    else
    {
        textoSaida = Task.Run(async () =>
        {
            await using var f = File.Create(saida);
            await p.StandardOutput.BaseStream.CopyToAsync(f, timeout.Token);
            return "";
        });
    }
    var erro = p.StandardError.ReadToEndAsync(timeout.Token);
    try
    {
        if (entrada is not null)
        {
            await using (var f = File.OpenRead(entrada)) await f.CopyToAsync(p.StandardInput.BaseStream, timeout.Token);
            p.StandardInput.Close();
        }
        await p.WaitForExitAsync(timeout.Token);
        return new Resultado(p.ExitCode, await textoSaida, await erro);
    }
    catch (IOException) when (!p.HasExited || p.ExitCode != 0)
    {
        // O processo morreu antes de ler o stdin inteiro: o erro real está no stderr.
        await p.WaitForExitAsync(CancellationToken.None);
        return new Resultado(p.ExitCode == 0 ? -1 : p.ExitCode, "", await erro);
    }
    catch (OperationCanceledException)
    {
        try { p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
        return new Resultado(-1, "", $"docker {argumentos[0]} passou de {limite.TotalSeconds:0} s");
    }
}

record Resultado(int Codigo, string Saida, string Erro);

sealed class ApagarAoFim(string arquivo) : IDisposable
{
    public void Dispose() { try { File.Delete(arquivo); } catch (IOException) { } }
}

public partial class Program;
