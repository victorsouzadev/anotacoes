using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Auth;
using Notas.Api.Data;
using Notas.Api.Endpoints;
using Notas.Api.Services.Financas;
using Notas.Api.Services.Financas.Llm;
using Notas.Api.Services.Imagens;
using Notas.Api.Services.Seguranca;

namespace Notas.Api;

/// <summary>Ganchos pra quem hospeda a API fora do servidor (a versão desktop).</summary>
public class NotasAppOptions
{
    /// <summary>Modo desktop: libera o login local (um usuário só, sem senha).</summary>
    public bool Desktop { get; set; }
    /// <summary>Pasta com o Angular compilado, servido pelo mesmo processo.</summary>
    public string? WebRoot { get; set; }
    /// <summary>Raiz do conteúdo; o desktop usa a pasta do programa, não a de onde foi aberto.</summary>
    public string? ContentRoot { get; set; }
    public Action<WebApplicationBuilder>? ConfigureBuilder { get; set; }
    /// <summary>Roda depois dos registros padrão: o que registrar aqui vence.</summary>
    public Action<IServiceCollection>? ConfigureServices { get; set; }
    public Action<WebApplication>? MapExtra { get; set; }
}

/// <summary>
/// A aplicação inteira, montada num lugar só: o servidor (Program) e a versão
/// desktop (que hospeda a API dentro do próprio programa) sobem a mesma coisa.
/// </summary>
public static class NotasApp
{
    public static WebApplication Build(string[] args, NotasAppOptions? options = null)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args, WebRootPath = options?.WebRoot, ContentRootPath = options?.ContentRoot });
        options?.ConfigureBuilder?.Invoke(builder);

        var jwtSecret = builder.Configuration["JWT_SECRET"]
            ?? throw new InvalidOperationException("Defina a variável de ambiente JWT_SECRET.");
        var connectionString = builder.Configuration.GetConnectionString("Db")
            ?? "Data Source=../../data/db/notas.db";

        // No desktop o projeto inteiro (com as fotos) vai pro disco pela API local: lá o teto é maior.
        var maxBody = builder.Configuration.GetValue<long?>("Kestrel:MaxBodyBytes") ?? 10 * 1024 * 1024;
        builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = maxBody);

        builder.Services.AddDbContext<AppDbContext>(o => o.UseSqlite(connectionString));
        builder.Services.AddSingleton<TokenService>();

        // Enums (ferramenta Finanças) trafegam como string no JSON, em vez de índice numérico.
        builder.Services.ConfigureHttpJsonOptions(o =>
            o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

        // Ferramenta "Finanças": extração de lançamentos por LLM, com fallback heurístico
        // local quando nenhuma chave de API está configurada.
        builder.Services.Configure<AnthropicOptions>(builder.Configuration.GetSection(AnthropicOptions.SectionName));
        builder.Services.Configure<OpenRouterOptions>(builder.Configuration.GetSection(OpenRouterOptions.SectionName));
        builder.Services.Configure<ExtracaoOptions>(builder.Configuration.GetSection(ExtracaoOptions.SectionName));
        builder.Services.Configure<FinancasOptions>(builder.Configuration.GetSection(FinancasOptions.SectionName));
        builder.Services.AddSingleton<FinancasClock>();

        // Provedor de LLM: OpenRouter (o único que lê imagem/PDF), Anthropic direto, ou o
        // extrator heurístico local. O usuário pode cadastrar a própria chave e o próprio
        // modelo em Configurações; as variáveis de ambiente abaixo valem como padrão do
        // servidor para quem não configurou nada.
        // Os clientes HTTP são nomeados porque a escolha do provedor deixou de acontecer
        // na subida do processo: cada requisição resolve a chave e o modelo do usuário
        // (ver LlmExtractorFactory), então o extrator é construído sob demanda.
        builder.Services.AddHttpClient(nameof(OpenRouterLlmExtractor), c =>
            c.Timeout = TimeSpan.FromSeconds(
                builder.Configuration.GetValue("OpenRouter:TimeoutComAnexosSegundos", 120) + 15));

        builder.Services.AddHttpClient(nameof(AnthropicLlmExtractor), c =>
            c.Timeout = TimeSpan.FromSeconds(
                Math.Clamp(builder.Configuration.GetValue("Anthropic:TimeoutSegundos", 20), 5, 120)));

        // Ferramenta "Editor de Imagens": ampliação de foto pequena por super-resolução
        // num serviço externo. Sem chave (Upscale__ApiKey) o recurso fica desligado e o
        // editor nem oferece o botão.
        builder.Services.Configure<UpscaleOptions>(builder.Configuration.GetSection(UpscaleOptions.SectionName));
        // Cliente nomeado, e não tipado: a chave é de quem está logado, então o
        // ampliador é construído por requisição (ver UpscalerFactory).
        builder.Services.AddHttpClient(nameof(ReplicateUpscaler), c =>
            c.Timeout = TimeSpan.FromSeconds(
                Math.Clamp(builder.Configuration.GetValue("Upscale:TimeoutSegundos", 90), 15, 300) + 15));
        builder.Services.Configure<RelightOptions>(builder.Configuration.GetSection(RelightOptions.SectionName));
        builder.Services.AddHttpClient(nameof(ReplicateRelighter), c =>
            c.Timeout = TimeSpan.FromSeconds(
                Math.Clamp(builder.Configuration.GetValue("Relight:TimeoutSegundos", 180), 30, 600) + 15));
        builder.Services.Configure<RemoveBgOptions>(builder.Configuration.GetSection(RemoveBgOptions.SectionName));
        builder.Services.AddHttpClient(nameof(ReplicateBackgroundRemover), c =>
            c.Timeout = TimeSpan.FromSeconds(
                Math.Clamp(builder.Configuration.GetValue("RemoveBg:TimeoutSegundos", 90), 15, 300) + 15));
        builder.Services.AddScoped<IUpscalerFactory, UpscalerFactory>();

        // Nomear os elementos do editor é outra conversa com o LLM (imagens entram,
        // nomes de arquivo saem), então tem cliente próprio — com o timeout de anexo,
        // que é o caso dele.
        builder.Services.AddHttpClient(nameof(NomeadorDeElementos), c =>
            c.Timeout = TimeSpan.FromSeconds(
                builder.Configuration.GetValue("OpenRouter:TimeoutComAnexosSegundos", 120) + 15));

        builder.Services.AddSingleton<IProtetorDeSegredos, ProtetorDeSegredos>();
        builder.Services.AddScoped<ILlmExtractorFactory, LlmExtractorFactory>();
        builder.Services.AddScoped<INomeadorDeElementos, NomeadorDeElementos>();

        builder.Services.AddScoped<TransacaoExtractionService>();
        builder.Services.AddScoped<OrcamentoService>();
        builder.Services.AddScoped<MetaService>();

        builder.Services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(o => o.TokenValidationParameters = TokenService.ValidationParameters(jwtSecret));
        builder.Services.AddAuthorization();

        builder.Services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = 429;
            o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
                ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = 20,
                    Window = TimeSpan.FromMinutes(1),
                }));

            // Lançamento por texto livre é o único endpoint que custa dinheiro por chamada
            // (uma requisição ao LLM). O limite é por usuário autenticado, não por IP, para
            // que um token vazado não consiga queimar a chave da API em laço.
            o.AddPolicy("financas-ia", ctx => RateLimitPartition.GetFixedWindowLimiter(
                ctx.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
                    ?? ctx.User.FindFirst("sub")?.Value
                    ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = 30,
                    Window = TimeSpan.FromMinutes(1),
                }));

            // Importar arquivo custa muito mais que interpretar uma frase: uma foto de
            // cupom vale milhares de tokens e um PDF de extrato, dezenas de milhares.
            // O limite é bem mais apertado que o do lançamento por texto.
            o.AddPolicy("financas-importacao", ctx => RateLimitPartition.GetFixedWindowLimiter(
                ctx.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
                    ?? ctx.User.FindFirst("sub")?.Value
                    ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = 10,
                    Window = TimeSpan.FromMinutes(5),
                }));
        });

        options?.ConfigureServices?.Invoke(builder.Services);

        var app = builder.Build();

        // Todo tráfego chega via Caddy (e futuramente NPM) — confiar no X-Forwarded-For.
        app.UseForwardedHeaders(new ForwardedHeadersOptions
        {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
            KnownNetworks = { },
            KnownProxies = { },
        });

        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var dataSource = new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder(connectionString).DataSource;
            var dir = Path.GetDirectoryName(Path.GetFullPath(dataSource));
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            db.Database.Migrate();
            db.Database.ExecuteSqlRaw("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
        }

        // A autenticação vem antes do limitador porque a política "financas-ia" particiona
        // por usuário: com a ordem invertida, ctx.User estaria vazio e todo mundo atrás do
        // mesmo IP dividiria a mesma cota.
        app.UseAuthentication();
        app.UseRateLimiter();
        app.UseAuthorization();

        // O health check toca o banco de propósito: um "ok" que não consulta nada passa
        // mesmo com o SQLite inacessível, e o deploy daria por bem-sucedido um servidor
        // que responde erro em toda tela.
        app.MapGet("/api/health", async (AppDbContext db, CancellationToken ct) =>
        {
            try
            {
                await db.Database.ExecuteSqlRawAsync("SELECT 1", ct);
                // "icu" diz se a imagem trouxe o banco de localização: sem ele o .NET
                // sobe em modo globalization-invariant, e foi assim que o dashboard de
                // finanças começou a responder 500 sem nenhum sinal externo.
                return Results.Ok(new
                {
                    status = "ok",
                    banco = "ok",
                    versao = Environment.GetEnvironmentVariable("App__Versao") ?? "desconhecida",
                    icu = Notas.Api.Services.CulturaBr.PtBrCompleto ? "ok" : "ausente",
                    exemploMes = Notas.Api.Services.CulturaBr.MesAbreviado(DateOnly.FromDateTime(DateTime.UtcNow)),
                });
            }
            catch (Exception ex)
            {
                return Results.Json(new { status = "degradado", banco = "falhou", erro = ex.Message },
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        });
        app.MapAuthEndpoints();
        app.MapNotesEndpoints();
        app.MapFoldersEndpoints();
        app.MapFinancasEndpoints();
        app.MapOrcamentoEndpoints();
        app.MapMetaEndpoints();
        app.MapConfiguracaoIaEndpoints();
        app.MapTasksEndpoints();
        app.MapImagemEndpoints();
        if (options?.Desktop == true || app.Configuration.GetValue<bool>("Desktop:Enabled")) app.MapDesktopAuthEndpoints();
        options?.MapExtra?.Invoke(app);

        // Versão desktop: o mesmo processo serve o Angular já compilado.
        if (!string.IsNullOrEmpty(options?.WebRoot))
        {
            app.UseDefaultFiles();
            app.UseStaticFiles();
            app.MapFallbackToFile("index.html");
        }

        return app;
    }
}
