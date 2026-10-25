using Notas.Api.Services.Financas.Auvp;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Auth;
using Notas.Api.Data;
using Notas.Api.Endpoints;
using Notas.Api.Services.Dieta;
using Notas.Api.Services.Financas;
using Notas.Api.Services.Financas.Llm;
using Notas.Api.Services.Financas.Chat;
using Notas.Api.Services.Estudio;
using Notas.Api.Services.Imagens;
using Notas.Api.Services.Moldes;
using Notas.Api.Services.Seguranca;
using Notas.Api.Services.Sites;

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

        // Importação da AUVP Financeiro (open banking). Sem Auvp__BaseUrl a
        // integração fica desligada e a tela não oferece o botão.
        builder.Services.Configure<AuvpOptions>(builder.Configuration.GetSection(AuvpOptions.SectionName));
        builder.Services.AddHttpClient(nameof(AuvpCliente), c =>
            {
                c.Timeout = TimeSpan.FromSeconds(
                    Math.Clamp(builder.Configuration.GetValue("Auvp:TimeoutSegundos", 30), 5, 120));
                // Sem User-Agent o .NET não manda nenhum, e o firewall na frente da
                // AUVP (Cloudflare) trata cliente anônimo com mais desconfiança.
                c.DefaultRequestHeaders.UserAgent.ParseAdd("Anotacoes-Financas/1.0");
            })
            // O Cloudflare da AUVP barra alguns IPs de datacenter (403 em HTML). Com
            // Auvp__Proxy as chamadas saem por outro endereço, sem afetar o resto do app.
            .ConfigurePrimaryHttpMessageHandler(() => AuvpProxy.Handler(builder.Configuration["Auvp:Proxy"]));
        builder.Services.AddScoped<IAuvpCliente, AuvpCliente>();
        builder.Services.AddScoped<AuvpSincronizador>();
        builder.Services.AddScoped<AuvpEscrita>();
        builder.Services.AddHostedService<AuvpSincronizacaoAutomatica>();

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

        // Legendas de Instagram: prévia do post entra, texto sai. Mesmo teto de
        // tempo do nomeador, porque também leva imagem.
        builder.Services.AddHttpClient(nameof(LegendistaInstagram), c =>
            c.Timeout = TimeSpan.FromSeconds(
                builder.Configuration.GetValue("OpenRouter:TimeoutComAnexosSegundos", 120) + 15));

        // Post com IA: várias fotos entram, modelo e textos saem.
        builder.Services.AddHttpClient(nameof(MontadorDePost), c =>
            c.Timeout = TimeSpan.FromSeconds(
                builder.Configuration.GetValue("OpenRouter:TimeoutComAnexosSegundos", 120) + 15));

        // Moldes: foto de embalagem entra, tipo de molde e medidas saem. Também
        // leva imagem, então usa o mesmo teto de tempo dos outros com anexo.
        builder.Services.AddHttpClient(nameof(AnalisadorDeEmbalagem), c =>
            c.Timeout = TimeSpan.FromSeconds(
                builder.Configuration.GetValue("OpenRouter:TimeoutComAnexosSegundos", 120) + 15));

        // Ferramenta "Estúdio": gerações de imagem, vídeo, áudio e 3D no fal.ai (e mundos na World Labs),
        // biblioteca de arquivos em disco e montagens com o ffmpeg. A fila anda em segundo plano
        // (EstudioWorker); a chave é de cada usuário, com a do servidor (Estudio__FalKey) como padrão.
        builder.Services.Configure<EstudioOptions>(builder.Configuration.GetSection(EstudioOptions.SectionName));
        builder.Services.AddHttpClient(FalCliente.NomeHttp, c =>
        {
            c.Timeout = TimeSpan.FromMinutes(10);
            c.DefaultRequestHeaders.UserAgent.ParseAdd("Anotacoes-Estudio/1.0");
        });
        builder.Services.AddSingleton<Catalogo>();
        builder.Services.AddSingleton<EstudioArmazenamento>();
        builder.Services.AddSingleton<Ffmpeg>();
        builder.Services.AddSingleton<FalCliente>();
        builder.Services.AddSingleton<WorldLabsCliente>();
        builder.Services.AddScoped<EstudioMidias>();
        builder.Services.AddScoped<EstudioGeracoes>();
        builder.Services.AddScoped<EstudioProcessador>();
        builder.Services.AddHostedService<EstudioWorker>();
        // MCP remoto dos craft apps: a API confere o token e repassa ao serviço crafts-mcp.
        builder.Services.AddHttpClient(Notas.Api.Mcp.CraftsMcp.NomeHttp, c => c.Timeout = TimeSpan.FromMinutes(3));

        // Ferramenta "Publicar": ZIPs viram sites em <slug>.<domínio>. Os containers são
        // criados pelo serviço deployer (único com docker.sock); a API só fala HTTP com ele.
        builder.Services.Configure<SitesOptions>(builder.Configuration.GetSection(SitesOptions.SectionName));
        builder.Services.AddSingleton<SitesArmazenamento>();
        builder.Services.AddSingleton<FilaSites>();
        builder.Services.AddScoped<ExecutorSites>();
        builder.Services.AddSingleton<IPostgresProvisionador, PostgresProvisionador>();
        builder.Services.AddHostedService<PublicacaoWorker>();
        builder.Services.AddHttpClient<IDeployer, DeployerHttp>(c => c.Timeout = TimeSpan.FromMinutes(6));
        builder.Services.AddHttpClient<IVerificadorSaude, VerificadorSaudeHttp>(c => c.Timeout = TimeSpan.FromSeconds(5));

        builder.Services.AddSingleton<IProtetorDeSegredos, ProtetorDeSegredos>();
        builder.Services.AddScoped<ILlmExtractorFactory, LlmExtractorFactory>();
        builder.Services.AddScoped<INomeadorDeElementos, NomeadorDeElementos>();
        builder.Services.AddScoped<ILegendistaInstagram, LegendistaInstagram>();
        builder.Services.AddScoped<IMontadorDePost, MontadorDePost>();
        builder.Services.AddScoped<IAnalisadorDeEmbalagem, AnalisadorDeEmbalagem>();

        // Ferramenta "Dieta": gamificação derivada dos registros e consulta de código de barras.
        builder.Services.AddScoped<DietaProgresso>();
        builder.Services.AddScoped<Notas.Api.Services.Dieta.Ia.FerramentasDieta>();
        builder.Services.AddScoped<Notas.Api.Services.Dieta.Ia.ChatDieta>();
        builder.Services.AddScoped<Notas.Api.Services.Dieta.Ia.ReconhecedorDeAlimento>();
        builder.Services.AddHttpClient<IOpenFoodFacts, OpenFoodFacts>(c =>
        {
            c.Timeout = TimeSpan.FromSeconds(10);
            c.DefaultRequestHeaders.UserAgent.ParseAdd("Anotacoes-Dieta/1.0 (cerebro.vsitefy.com.br)");
        });

        // Ferramenta "Anotação": aprovação das pré-anotações do Claude nos relatos do mestrado.
        // Só liga com Anotacao__RunDir apontando para uma pasta local; na VPS fica desligada.
        builder.Services.Configure<Notas.Api.Services.Anotacao.AnotacaoOptions>(
            builder.Configuration.GetSection(Notas.Api.Services.Anotacao.AnotacaoOptions.SectionName));
        builder.Services.AddSingleton<Notas.Api.Services.Anotacao.AnotacaoArquivos>();

        builder.Services.AddScoped<TransacaoExtractionService>();
        builder.Services.AddScoped<OrcamentoService>();
        builder.Services.AddScoped<MetaService>();
        builder.Services.AddScoped<PlanejamentoService>();
        builder.Services.AddScoped<FerramentasFinanceiras>();
        builder.Services.AddScoped<ChatComFerramentas>();
        builder.Services.AddScoped<ChatFinanceiro>();
        builder.Services.AddScoped<IChatModeloCliente, ChatModeloCliente>();
        // Uma resposta do chat pode encadear várias consultas; cada chamada ao
        // modelo tem folga bem maior que a extração de um lançamento.
        builder.Services.AddHttpClient(nameof(ChatModeloCliente), c => c.Timeout = TimeSpan.FromSeconds(90));

        // MCPs dos apps para o Segundo Cérebro e o Claude: /api/mcp/tarefas, /financas, /criativo, /dieta, /treino e /estudio.
        // Um servidor só; cada rota enxerga só as ferramentas do seu grupo (prefixo do nome).
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddSingleton<Notas.Api.Mcp.AppsMcpAuth>();
        builder.Services.AddScoped<Notas.Api.Mcp.McpUser>();
        builder.Services
            .AddMcpServer(o => o.ServerInstructions =
                "Dados das ferramentas do hub do usuário (tarefas, finanças, sites, imagens, dieta e treinos de corrida) e o Estúdio " +
                "(geração de imagem, vídeo, áudio e 3D por IA, biblioteca de arquivos e documentos das ferramentas). Só leitura, " +
                "exceto os registros rápidos da dieta (refeição, peso e água) e as ferramentas do Estúdio. Gerações custam dinheiro: " +
                "acima do limite do usuário, peça a confirmação dele antes de chamar estudio_gerar com confirmar=true.")
            .WithHttpTransport(o =>
            {
                o.Stateless = true;
                o.ConfigureSessionOptions = (http, options, _) =>
                {
                    var grupo = (http.Request.RouteValues["grupo"] as string ?? "").ToLowerInvariant();
                    if (options.ToolCollection is { } tools)
                        foreach (var t in tools.ToArray())
                            if (!t.ProtocolTool.Name.StartsWith(grupo + "_", StringComparison.Ordinal)) tools.Remove(t);
                    return Task.CompletedTask;
                };
            })
            .WithTools<Notas.Api.Mcp.TarefasMcpTools>()
            .WithTools<Notas.Api.Mcp.FinancasMcpTools>()
            .WithTools<Notas.Api.Mcp.CriativoMcpTools>()
            .WithTools<Notas.Api.Mcp.DietaMcpTools>()
            .WithTools<Notas.Api.Mcp.TreinoMcpTools>()
            .WithTools<Notas.Api.Mcp.EstudioMcpTools>();

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

            // IA da Dieta (chat e reconhecimento de foto): por usuário, como a das Finanças.
            o.AddPolicy("dieta-ia", ctx => RateLimitPartition.GetFixedWindowLimiter(
                ctx.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
                    ?? ctx.User.FindFirst("sub")?.Value
                    ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = 30,
                    Window = TimeSpan.FromMinutes(1),
                }));

            // Gerações do Estúdio custam dinheiro por chamada: por usuário, como as outras IAs.
            o.AddPolicy("estudio-ia", ctx => RateLimitPartition.GetFixedWindowLimiter(
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
            TacoSeed.Aplicar(db);
        }

        // A autenticação vem antes do limitador porque a política "financas-ia" particiona
        // por usuário: com a ordem invertida, ctx.User estaria vazio e todo mundo atrás do
        // mesmo IP dividiria a mesma cota.
        app.UseAuthentication();
        // Depois da autenticação JWT: nas rotas /api/mcp quem decide é o token dos apps (do Cérebro).
        app.Use((http, next) => Notas.Api.Mcp.AppsMcpAuth.Middleware(http, () => next(http)));
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
        app.MapAuvpEndpoints();
        app.MapFinancasAnaliseEndpoints();
        app.MapPlanejamentoEndpoints();
        app.MapChatFinanceiroEndpoints();
        app.MapOrcamentoEndpoints();
        app.MapMetaEndpoints();
        app.MapConfiguracaoIaEndpoints();
        app.MapTasksEndpoints();
        app.MapImagemEndpoints();
        app.MapEstudioEndpoints();
        app.MapSitesEndpoints();
        app.MapMoldesEndpoints();
        app.MapDietaEndpoints();
        app.MapDietaIaEndpoints();
        app.MapTreinoEndpoints();
        app.MapAnotacaoEndpoints();
        app.MapMcp("/api/mcp/{grupo:regex(^(tarefas|financas|criativo|dieta|treino|estudio)$)}");
        Notas.Api.Mcp.CraftsMcp.MapCraftsMcp(app);
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
