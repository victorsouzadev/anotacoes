using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api.Data;
using Notas.Api.Services.Plugins;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>Specs 029 (registro e /api/plugins), 030 (token por plug-in) e 031 (migrações do núcleo).</summary>
public class NucleoPluginsTests : IClassFixture<TasksApiFactory>
{
    private readonly TasksApiFactory _factory;
    public NucleoPluginsTests(TasksApiFactory factory) => _factory = factory;

    private async Task<HttpClient> Logado()
    {
        var c = _factory.CreateClient();
        var r = await c.PostAsJsonAsync("/api/auth/register", new { email = $"pl_{Guid.NewGuid():N}@example.com", password = "Sup3rSecret!" });
        var corpo = await r.Content.ReadFromJsonAsync<JsonElement>();
        c.DefaultRequestHeaders.Authorization = new("Bearer", corpo.GetProperty("accessToken").GetString());
        return c;
    }

    private const string Manifesto = """{"id":"exemplo","nome":"Exemplo","icone":"grid","rota":"/exemplo","porta":8080,"health":"/exemplo/api/health","tabelas":{"prefixo":"exemplo_"}}""";

    private async Task Registrar(string id = "exemplo", bool noAr = true)
    {
        using var s = _factory.Services.CreateScope();
        var db = s.ServiceProvider.GetRequiredService<AppDbContext>();
        db.PluginsEstado.RemoveRange(db.PluginsEstado);
        db.PluginsEstado.Add(new PluginEstado { Id = id, Versao = "abc1234", Manifesto = Manifesto.Replace("exemplo", id), NoAr = noAr });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Plugins_lista_modulos_do_nucleo_e_plugins_com_estado()
    {
        await Registrar(noAr: false);
        var c = await Logado();
        var lista = await c.GetFromJsonAsync<JsonElement>("/api/plugins");
        var itens = lista.EnumerateArray().ToList();
        Assert.Contains(itens, i => i.GetProperty("id").GetString() == "financas" && i.GetProperty("origem").GetString() == "nucleo");
        var ex = itens.Single(i => i.GetProperty("id").GetString() == "exemplo");
        Assert.Equal("plugin", ex.GetProperty("origem").GetString());
        Assert.Equal("indisponivel", ex.GetProperty("estado").GetString());
        Assert.Equal("/exemplo", ex.GetProperty("rota").GetString());
    }

    [Fact]
    public async Task Plugin_extraido_substitui_o_modulo_do_nucleo()
    {
        await Registrar("dieta");
        var itens = (await (await Logado()).GetFromJsonAsync<JsonElement>("/api/plugins")).EnumerateArray().ToList();
        Assert.Single(itens, i => i.GetProperty("id").GetString() == "dieta");
        Assert.Equal("plugin", itens.Single(i => i.GetProperty("id").GetString() == "dieta").GetProperty("origem").GetString());
    }

    [Fact]
    public async Task Plugins_exige_login() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await _factory.CreateClient().GetAsync("/api/plugins")).StatusCode);

    [Fact]
    public async Task Token_plugin_so_para_registrado_e_com_a_audiencia_dele()
    {
        await Registrar();
        var c = await Logado();
        Assert.Equal(HttpStatusCode.NotFound,
            (await c.PostAsJsonAsync("/api/auth/token-plugin", new { plugin = "nao-existe" })).StatusCode);

        var r = await c.PostAsJsonAsync("/api/auth/token-plugin", new { plugin = "exemplo" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var corpo = await r.Content.ReadFromJsonAsync<JsonElement>();
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(corpo.GetProperty("access_token").GetString());
        Assert.Equal(["exemplo"], jwt.Audiences);
        Assert.Equal("ES256", jwt.Header.Alg);
        Assert.Equal(900, corpo.GetProperty("expires_in").GetInt32());

        // O token do plug-in não abre as rotas do hub.
        var outro = _factory.CreateClient();
        outro.DefaultRequestHeaders.Authorization = new("Bearer", corpo.GetProperty("access_token").GetString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await outro.GetAsync("/api/plugins")).StatusCode);
    }

    [Fact]
    public async Task Token_plugin_exige_login() =>
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await _factory.CreateClient().PostAsJsonAsync("/api/auth/token-plugin", new { plugin = "exemplo" })).StatusCode);

    [Fact]
    public async Task Importar_le_o_estado_do_deployer_e_tira_os_desligados()
    {
        var arq = Path.Combine(Path.GetTempPath(), $"estado-{Guid.NewGuid():N}.json");
        await File.WriteAllTextAsync(arq, $$"""
            { "exemplo": { "id": "exemplo", "versao": "v2", "versaoAnterior": "v1", "manifesto": {{Manifesto}}, "noAr": true, "ativo": true },
              "velho": { "id": "velho", "versao": "v1", "manifesto": {{Manifesto.Replace("exemplo", "velho")}}, "noAr": false, "ativo": false } }
            """);
        using var s = _factory.Services.CreateScope();
        var db = s.ServiceProvider.GetRequiredService<AppDbContext>();
        db.PluginsEstado.RemoveRange(db.PluginsEstado);
        db.PluginsEstado.Add(new PluginEstado { Id = "velho", Versao = "v1", Manifesto = Manifesto });
        await db.SaveChangesAsync();

        await RegistroDePlugins.Importar(db, arq, default);
        var linhas = db.PluginsEstado.ToList();
        Assert.Equal(["exemplo"], linhas.Select(l => l.Id));
        Assert.Equal("v1", linhas[0].VersaoAnterior);
        Assert.Equal("http://plugin-exemplo:8080/exemplo/api/health", RegistroDePlugins.UrlHealth(linhas[0]));
    }

    /// <summary>
    /// Spec 031: depois da divisão, migração do núcleo não apaga tabela que não é dele. Na extração a entidade sai
    /// do AppDbContext com uma migração de Up vazio (o EF geraria DropTable).
    /// </summary>
    [Fact]
    public void Migracoes_do_nucleo_nao_apagam_tabela_alheia()
    {
        var tipos = typeof(AppDbContext).Assembly.GetTypes()
            .Where(t => t.IsSubclassOf(typeof(Migration)) && !t.IsAbstract)
            .Select(t => (t, id: t.GetCustomAttributes(typeof(MigrationAttribute), false).Cast<MigrationAttribute>().Single().Id))
            .Where(x => string.CompareOrdinal(x.id, "20261120") >= 0);
        var proibidas = new List<string>();
        foreach (var (t, id) in tipos)
        {
            var m = (Migration)Activator.CreateInstance(t)!;
            foreach (var op in m.UpOperations.OfType<DropTableOperation>())
                if (!op.Name.StartsWith("core_")) proibidas.Add($"{id}: {op.Name}");
        }
        Assert.Empty(proibidas);
    }
}
