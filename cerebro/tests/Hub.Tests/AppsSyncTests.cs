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

    public AppsSyncTests()
    {
        var o = new HubOptions { DataPath = Path.Combine(_dir, "hub"), VaultPath = Path.Combine(_dir, "vault") };
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
}
