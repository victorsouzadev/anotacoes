using Hub.Plugin;
using Xunit;

namespace Hub.Plugin.Sdk.Tests;

public class RelogioTests
{
    [Fact]
    public void Hoje_usa_o_fuso_do_usuario_e_nao_utc()
    {
        // 01/12 01:30 UTC ainda é 30/11 em São Paulo.
        var r = new RelogioDoHub(agoraUtc: () => new DateTime(2026, 12, 1, 1, 30, 0, DateTimeKind.Utc));
        Assert.Equal(new DateOnly(2026, 11, 30), r.Hoje());
        Assert.Equal((2026, 11), r.ResolverMes(null, null));
        Assert.Equal((2025, 3), r.ResolverMes(2025, 3));
    }

    [Fact]
    public void Fuso_inexistente_cai_para_utc_menos_3()
    {
        var r = new RelogioDoHub("Fuso/Inexistente", () => new DateTime(2026, 1, 1, 2, 0, 0, DateTimeKind.Utc));
        Assert.Equal("UTC-03", r.FusoId);
        Assert.Equal(new DateOnly(2025, 12, 31), r.Hoje());
    }

    [Fact]
    public void Limites_e_mes_anterior()
    {
        Assert.Equal((new DateOnly(2028, 2, 1), new DateOnly(2028, 2, 29)), RelogioDoHub.LimitesDoMes(2028, 2));
        Assert.Equal((2025, 12), RelogioDoHub.MesAnterior(2026, 1));
        Assert.Equal((2026, 4), RelogioDoHub.MesAnterior(2026, 5));
    }
}
