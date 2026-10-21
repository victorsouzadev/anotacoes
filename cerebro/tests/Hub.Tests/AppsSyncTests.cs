using Hub.Api;
using Hub.Core;
using Hub.Data;
using Hub.Pipeline;
using Hub.Vault;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Hub.Tests;

/// <summary>Agenda da rotina dos apps: qual horário está vencido, sem repetir e sem acumular.</summary>
public sealed class AppsSyncTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "cerebro-apps-" + Guid.NewGuid().ToString("N"));
    private readonly AppsSyncService _sync;

    private readonly HubOptions _o;

    public AppsSyncTests()
    {
        var o = _o = new HubOptions { DataPath = Path.Combine(_dir, "hub"), VaultPath = Path.Combine(_dir, "vault") };
        o.Web.JwtSecret = "segredo-jwt-de-teste-com-32-bytes!!";
        var opts = Options.Create(o);
        var db = new HubDb(opts);
        _sync = new AppsSyncService(db, new AccessStore(db, new SecretBox(opts), opts),
            new VaultStore(opts, NullLogger<VaultStore>.Instance), new HubClock(opts), opts,
            NullLoggerFactory.Instance, NullLogger<AppsSyncService>.Instance);
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    [Fact]
    public void Padrao_e_duas_vezes_ao_dia_com_todos_os_apps()
    {
        var s = _sync.Load();
        Assert.True(s.Enabled);
        Assert.Equal(["08:00", "20:00"], s.EffectiveTimes);
        Assert.All(AppsSyncService.Apps, a => Assert.True(s.AppEnabled(a.Id)));
    }

    [Fact]
    public void Horario_vencido_roda_uma_vez_so()
    {
        var s = _sync.Configure(true, ["00:00"], ["tarefas"]);
        var slot = _sync.DueSlot(s);
        Assert.NotNull(slot);
        Assert.EndsWith(" 00:00", slot);
        Assert.Null(_sync.DueSlot(s with { LastSlot = slot }));
        Assert.False(s.AppEnabled("financas"));
    }

    [Fact]
    public void Varios_horarios_vencidos_rodam_so_o_mais_recente()
    {
        var s = _sync.Configure(true, ["00:00", "00:01"], ["tarefas", "financas", "criativo"]);
        var slot = _sync.DueSlot(s)!;
        // Um único horário por vez, o mais recente que já passou (00:01, salvo no primeiro minuto do dia).
        Assert.Contains(slot[^5..], new[] { "00:00", "00:01" });
        Assert.Null(_sync.DueSlot(s with { LastSlot = slot }));
    }

    [Theory]
    [InlineData("8h")]
    [InlineData("25:00")]
    [InlineData("08:00:00")]
    public void Horario_invalido_e_recusado(string horario) =>
        Assert.Throws<ArgumentException>(() => _sync.Configure(true, [horario], []));

    [Fact]
    public void Treino_e_casa_entram_na_rotina()
    {
        Assert.Contains(AppsSyncService.Apps, a => a.Id == "treino" && a.Tool == "treino_resumo" && a.Since && !a.External);
        Assert.Contains(AppsSyncService.Apps, a => a.Id == "casa" && a.Tool == "casa_resumo" && !a.Since && a.External);
        Assert.DoesNotContain(AppsSyncService.Apps, a => a.Id == "financas" && a.Since);
    }

    [Fact]
    public void Apps_do_hub_vao_pela_rede_interna_e_a_casa_pelo_endereco_proprio()
    {
        var treino = AppsSyncService.Apps.First(a => a.Id == "treino");
        var (url, token) = _sync.Endpoint(treino, "token-dos-apps");
        Assert.Equal("http://api:8080/api/mcp/treino", url.ToString());
        Assert.Equal("token-dos-apps", token);

        var casa = AppsSyncService.Apps.First(a => a.Id == "casa");
        // Sem CASA_MCP_TOKEN a Casa fica de fora, com um erro que diz o que configurar.
        var ex = Assert.Throws<InvalidOperationException>(() => _sync.Endpoint(casa, "token-dos-apps"));
        Assert.Contains("CASA_MCP_TOKEN", ex.Message);

        _o.Casa.McpToken = "token-da-casa";
        (url, token) = _sync.Endpoint(casa, null);
        Assert.Equal("https://casa.vsitefy.com.br/mcp", url.ToString());
        Assert.Equal("token-da-casa", token);
    }
}
