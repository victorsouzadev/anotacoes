using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Notas.Deployer;
using Xunit;

namespace Notas.Deployer.Tests;

public class ComandosDockerTests
{
    private static readonly Configuracao Cfg = new() { RaizSitesNoHost = "/opt/notas-vps/data/sites/" };
    private static IniciarApp App(Dictionary<string, string>? vars = null) =>
        new(new string('a', 32), "Recados.dll", "9.0", 192, vars);

    [Fact]
    public void Run_monta_so_as_pastas_do_proprio_site_com_limites()
    {
        var args = ComandosDocker.Run("recados", App(), Cfg);
        var texto = string.Join(' ', args);

        Assert.Contains($"/opt/notas-vps/data/sites/recados/deploys/{new string('a', 32)}/api:/app:ro", args);
        Assert.Contains("/opt/notas-vps/data/sites/recados/data:/data", args);
        Assert.Contains("--read-only", args);
        Assert.Contains("--memory 192m --memory-swap 192m", texto);
        Assert.Contains("--cap-drop ALL", texto);
        Assert.Contains("--user 1000:1000", texto);
        Assert.Contains("--network notas-sites", texto);
        Assert.EndsWith("mcr.microsoft.com/dotnet/aspnet:9.0 dotnet /app/Recados.dll", texto);
        Assert.DoesNotContain("docker.sock", texto);
        Assert.DoesNotContain("--privileged", texto);
    }

    [Fact]
    public void Variaveis_do_usuario_nao_sobrescrevem_as_da_plataforma()
    {
        var args = ComandosDocker.Run("recados", App(new() { ["ConnectionStrings__Default"] = "Data Source=/etc/x", ["Chave"] = "a b; rm -rf /" }), Cfg);
        var usuario = args.IndexOf("ConnectionStrings__Default=Data Source=/etc/x");
        var plataforma = args.IndexOf("ConnectionStrings__Default=Data Source=/data/app.db");
        Assert.True(usuario >= 0 && plataforma > usuario, "o -e da plataforma precisa vir depois (o último vence)");
        // Vai como um argumento só: não passa por shell.
        Assert.Contains("Chave=a b; rm -rf /", args);
    }

    [Theory]
    [InlineData("../etc", "slug inválido")]
    [InlineData("a", "slug inválido")]
    [InlineData("Recados", "slug inválido")]
    public void Slug_invalido(string slug, string erro) =>
        Assert.Equal(erro, ComandosDocker.Validar(slug, App()));

    [Fact]
    public void Campos_invalidos_sao_recusados()
    {
        Assert.Equal("deployId inválido", ComandosDocker.Validar("ok-app", App() with { DeployId = "../../x" }));
        Assert.Equal("entrada inválida", ComandosDocker.Validar("ok-app", App() with { Entrada = "../x.dll" }));
        Assert.Equal("entrada inválida", ComandosDocker.Validar("ok-app", App() with { Entrada = "x.sh" }));
        Assert.Equal("runtime não suportado", ComandosDocker.Validar("ok-app", App() with { Runtime = "latest" }));
        Assert.Equal("memória fora de 64..512 MB", ComandosDocker.Validar("ok-app", App() with { MemoriaMb = 4096 }));
        Assert.StartsWith("variável inválida", ComandosDocker.Validar("ok-app", App(new() { ["A=B"] = "x" })));
        Assert.Null(ComandosDocker.Validar("ok-app", App(new() { ["Email__Senha"] = "x" })));
    }
}

/// <summary>Sobe o Deployer de verdade com um "docker" falso que só anota os argumentos.</summary>
public class DeployerApiTests : IClassFixture<DeployerApiTests.Fabrica>
{
    public const string Token = "token-de-teste-com-mais-de-32-caracteres";

    public class Fabrica : WebApplicationFactory<Program>
    {
        public string Registro { get; } = Path.Combine(Path.GetTempPath(), $"docker-falso-{Guid.NewGuid():N}.log");
        private readonly string _script = Path.Combine(Path.GetTempPath(), $"docker-falso-{Guid.NewGuid():N}.sh");

        public Fabrica()
        {
            File.WriteAllText(_script, $"""
                #!/bin/sh
                echo "$*" >> "{Registro}"
                if [ "$1" = "ps" ]; then echo recados; echo outro; fi
                if [ "$1" = "logs" ]; then echo "linha do app"; echo "erro do app" >&2; fi
                if [ "$1" = "rm" ]; then echo "Error: No such container: $3" >&2; exit 1; fi
                exit 0
                """);
            if (!OperatingSystem.IsWindows())
                File.SetUnixFileMode(_script, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseSetting("DEPLOYER_TOKEN", Token);
            builder.UseSetting("SITES_HOST_DIR", "/host/sites");
            builder.UseSetting("DOCKER_BIN", _script);
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            File.Delete(_script);
            if (File.Exists(Registro)) File.Delete(Registro);
        }
    }

    private readonly Fabrica _f;
    private readonly HttpClient _c;

    public DeployerApiTests(Fabrica f)
    {
        _f = f;
        _c = f.CreateClient();
        _c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);
    }

    [Fact]
    public async Task Sem_token_recusa()
    {
        var anon = _f.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/apps")).StatusCode);
        anon.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "errado");
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.PostAsync("/apps/recados/remover", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anon.GetAsync("/health")).StatusCode);
    }

    [Fact]
    public async Task Iniciar_remove_o_antigo_e_roda_o_novo()
    {
        var res = await _c.PostAsJsonAsync("/apps/recados/iniciar",
            new { deployId = new string('b', 32), entrada = "Recados.dll", runtime = "9.0", memoriaMb = 128, variaveis = new Dictionary<string, string>() });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var linhas = File.ReadAllLines(_f.Registro);
        Assert.Contains("rm -f site-recados", linhas);
        Assert.Contains(linhas, l => l.StartsWith("run -d --name site-recados") && l.Contains("/host/sites/recados/data:/data"));
    }

    [Fact]
    public async Task Iniciar_com_dado_invalido_nao_chama_o_docker()
    {
        var res = await _c.PostAsJsonAsync("/apps/recados/iniciar",
            new { deployId = "x", entrada = "Recados.dll", runtime = "9.0", memoriaMb = 128 });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Listar_logs_e_remover()
    {
        Assert.Equal(["recados", "outro"], await _c.GetFromJsonAsync<List<string>>("/apps"));
        var logs = await _c.GetStringAsync("/apps/recados/logs?linhas=5");
        Assert.Contains("linha do app", logs);
        Assert.Contains("erro do app", logs);
        // O script falso responde "No such container": remover continua sendo sucesso.
        Assert.Equal(HttpStatusCode.OK, (await _c.PostAsync("/apps/recados/remover", null)).StatusCode);
    }
}
