using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>A API no modo desktop: login local por chave, sem senha.</summary>
public class DesktopApiFactory : TasksApiFactory
{
    public const string Key = "chave-de-teste-do-desktop";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Desktop:Enabled", "true");
        builder.UseSetting("Desktop:Key", Key);
    }
}

public class DesktopModeTests : IClassFixture<DesktopApiFactory>, IClassFixture<TasksApiFactory>
{
    private readonly DesktopApiFactory _desktop;
    private readonly TasksApiFactory _servidor;

    public DesktopModeTests(DesktopApiFactory desktop, TasksApiFactory servidor)
    {
        _desktop = desktop;
        _servidor = servidor;
    }

    private static HttpRequestMessage Local(string? key)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/local");
        if (key is not null) req.Headers.Add("X-Desktop-Key", key);
        return req;
    }

    [Fact]
    public async Task Login_local_com_a_chave_devolve_sessao_e_sempre_o_mesmo_usuario()
    {
        var c = _desktop.CreateClient();
        var a = await (await c.SendAsync(Local(DesktopApiFactory.Key))).Content.ReadFromJsonAsync<JsonElement>();
        var b = await (await c.SendAsync(Local(DesktopApiFactory.Key))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(a.GetProperty("user").GetProperty("id").GetString(), b.GetProperty("user").GetProperty("id").GetString());

        // e a sessão vale pra API normal
        c.DefaultRequestHeaders.Authorization = new("Bearer", a.GetProperty("accessToken").GetString());
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/imagens/projetos")).StatusCode);
    }

    [Fact]
    public async Task Sem_a_chave_certa_nao_entra()
    {
        var c = _desktop.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.SendAsync(Local(null))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.SendAsync(Local("errada"))).StatusCode);
    }

    [Fact]
    public async Task No_servidor_o_login_local_nem_existe()
    {
        var c = _servidor.CreateClient();
        var res = await c.SendAsync(Local(DesktopApiFactory.Key));
        Assert.True(res.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed, res.StatusCode.ToString());
    }
}
