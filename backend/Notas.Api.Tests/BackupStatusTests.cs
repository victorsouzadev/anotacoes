using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Notas.Api.Services.Sistema;
using Xunit;

namespace Notas.Api.Tests;

public class BackupStatusTests
{
    private static readonly DateTime Agora = new(2026, 11, 18, 12, 0, 0, DateTimeKind.Utc);

    private static string Arquivo(string conteudo)
    {
        var p = Path.Combine(Path.GetTempPath(), $"backup-{Guid.NewGuid():N}.json");
        File.WriteAllText(p, conteudo);
        return p;
    }

    [Fact]
    public void Arquivo_ausente_conta_como_nunca_registrado_e_atrasado()
    {
        var e = BackupStatus.Ler(Path.Combine(Path.GetTempPath(), "nao-existe-" + Guid.NewGuid()), Agora);
        Assert.False(e.Registrado);
        Assert.True(e.Atrasado);
        Assert.Contains("nenhum backup", BackupStatus.Linha(e));
    }

    [Fact]
    public void Json_invalido_conta_como_nunca_registrado()
    {
        var e = BackupStatus.Ler(Arquivo("{ isso não é json"), Agora);
        Assert.False(e.Registrado);
        Assert.True(e.Atrasado);
    }

    [Fact]
    public void Backup_recente_nao_esta_atrasado()
    {
        var e = BackupStatus.Ler(Arquivo("""{"concluidoEm":"2026-11-18T04:00:00Z","arquivos":[{"nome":"notas.db","bytes":10}],"totalBytes":10}"""), Agora);
        Assert.True(e.Registrado);
        Assert.False(e.Atrasado);
        Assert.Equal(8, e.IdadeHoras);
        Assert.Single(e.Arquivos);
        Assert.Equal("Backup: ok, o último terminou há 8 h.", BackupStatus.Linha(e));
    }

    [Fact]
    public void Mais_de_36_horas_esta_atrasado()
    {
        var e = BackupStatus.Ler(Arquivo("""{"concluidoEm":"2026-11-16T20:00:00Z","arquivos":[],"totalBytes":0}"""), Agora);
        Assert.True(e.Atrasado);
        Assert.Equal("Backup: ⚠️ atrasado, o último terminou há 1 dia e 16 h.", BackupStatus.Linha(e));
    }

    [Theory]
    [InlineData(0.5, "menos de 1 h")]
    [InlineData(5, "5 h")]
    [InlineData(24, "1 dia")]
    [InlineData(50, "2 dias e 2 h")]
    public void Idade_em_portugues(double horas, string esperado) => Assert.Equal(esperado, BackupStatus.Idade(horas));
}

public class BackupStatusApiTests : IClassFixture<BackupStatusApiTests.Factory>
{
    public class Factory : TasksApiFactory
    {
        public readonly string Status = Path.Combine(Path.GetTempPath(), $"backup-status-{Guid.NewGuid():N}.json");

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("Sistema:BackupStatus", Status);
            builder.UseSetting("Sites:Publicadores", "admin-backup@example.com");
        }
    }

    private readonly Factory _factory;
    public BackupStatusApiTests(Factory factory) => _factory = factory;

    private async Task<HttpClient> LogadoComo(string email)
    {
        var client = _factory.CreateClient();
        var res = await client.PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        if (res.StatusCode == HttpStatusCode.Conflict)
            res = await client.PostAsJsonAsync("/api/auth/login", new { email, password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString();
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    [Fact]
    public async Task So_publicadores_veem_o_estado()
    {
        var comum = await LogadoComo($"comum_{Guid.NewGuid():N}@example.com");
        Assert.Equal(HttpStatusCode.Forbidden, (await comum.GetAsync("/api/sistema/backup")).StatusCode);

        File.WriteAllText(_factory.Status, $$"""{"concluidoEm":"{{DateTime.UtcNow.AddHours(-2):O}}","arquivos":[],"totalBytes":0}""");
        var admin = await LogadoComo("admin-backup@example.com");
        var estado = await admin.GetFromJsonAsync<JsonElement>("/api/sistema/backup");
        Assert.True(estado.GetProperty("registrado").GetBoolean());
        Assert.False(estado.GetProperty("atrasado").GetBoolean());
    }
}
