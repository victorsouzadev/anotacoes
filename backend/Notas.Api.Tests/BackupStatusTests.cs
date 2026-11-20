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

    // ---- Spec 036: cópia externa e conferência ----

    private const string LocalEmDia = """{"concluidoEm":"2026-11-18T07:00:00Z","arquivos":[],"totalBytes":0}""";

    private static BackupEstado Completo(string externo, string local = LocalEmDia) =>
        BackupStatus.LerCompleto(new SistemaOptions { BackupStatus = Arquivo(local), BackupExterno = Arquivo(externo) }, Agora);

    [Fact]
    public void Externo_ausente_e_nunca_registrado()
    {
        var e = BackupStatus.LerCompleto(new SistemaOptions
        {
            BackupStatus = Arquivo(LocalEmDia),
            BackupExterno = Path.Combine(Path.GetTempPath(), "nao-existe-" + Guid.NewGuid()),
        }, Agora);
        Assert.False(e.Atrasado);
        Assert.False(e.Externo!.Registrado);
        Assert.True(e.Externo.Atrasado);
        Assert.False(e.Conferencia!.Registrado);
        Assert.True(e.Conferencia.Atrasado);
        Assert.Contains("cópia externa nunca registrada", BackupStatus.Linha(e));
        Assert.Contains("restauração nunca conferida", BackupStatus.Linha(e));
    }

    [Fact]
    public void Externo_invalido_e_nunca_registrado()
    {
        var e = Completo("{ quebrado");
        Assert.False(e.Externo!.Registrado);
        Assert.False(e.Conferencia!.Registrado);
    }

    [Fact]
    public void Tudo_em_dia_vira_uma_linha_so()
    {
        var e = Completo("""
            {"copia":{"concluidoEm":"2026-11-18T07:01:00Z","ok":true,"bytesTotal":1000},
             "conferencia":{"concluidoEm":"2026-11-15T08:00:00Z","ok":true}}
            """);
        Assert.False(e.Externo!.Atrasado);
        Assert.Equal(1000, e.Externo.BytesTotal);
        Assert.False(e.Conferencia!.Atrasado);
        Assert.Equal("Backup: ok, local há 5 h, cópia externa há 5 h, restauração conferida há 3 dias e 4 h.", BackupStatus.Linha(e));
    }

    [Fact]
    public void Externo_com_mais_de_36_horas_esta_atrasado_mesmo_com_local_em_dia()
    {
        var e = Completo("""
            {"copia":{"concluidoEm":"2026-11-16T20:00:00Z","ok":true},
             "conferencia":{"concluidoEm":"2026-11-15T08:00:00Z","ok":true}}
            """);
        Assert.False(e.Atrasado);
        Assert.True(e.Externo!.Atrasado);
        Assert.Equal("Backup: ⚠️ cópia externa atrasada, a última terminou há 1 dia e 16 h.", BackupStatus.Linha(e));
    }

    [Fact]
    public void Falha_recente_aparece_mas_o_ultimo_sucesso_continua_valendo()
    {
        var e = Completo("""
            {"copia":{"concluidoEm":"2026-11-18T07:01:00Z","ok":false,"falhaEm":"2026-11-18T11:00:00Z","erro":"Fatal: unable to open repository"},
             "conferencia":{"concluidoEm":"2026-11-15T08:00:00Z","ok":true}}
            """);
        Assert.False(e.Externo!.Atrasado);
        Assert.Equal("Fatal: unable to open repository", e.Externo.UltimaFalha!.Erro);
    }

    [Fact]
    public void Erro_longo_e_cortado()
    {
        var erro = new string('x', 1000);
        var e = Completo($$$"""{"copia":{"ok":false,"falhaEm":"2026-11-18T11:00:00Z","erro":"{{{erro}}}"}}""");
        Assert.False(e.Externo!.Registrado);
        Assert.Equal(300, e.Externo.UltimaFalha!.Erro.Length);
    }

    [Fact]
    public void Conferencia_com_erro_ou_velha_esta_atrasada()
    {
        var comErro = Completo("""
            {"copia":{"concluidoEm":"2026-11-18T07:01:00Z","ok":true},
             "conferencia":{"concluidoEm":"2026-11-17T08:00:00Z","ok":false}}
            """);
        Assert.True(comErro.Conferencia!.Atrasado);
        Assert.Equal("Backup: ⚠️ a última conferência da restauração falhou.", BackupStatus.Linha(comErro));

        var velha = Completo("""
            {"copia":{"concluidoEm":"2026-11-18T07:01:00Z","ok":true},
             "conferencia":{"concluidoEm":"2026-11-09T12:00:00Z","ok":true}}
            """);
        Assert.True(velha.Conferencia!.Atrasado);
        Assert.Contains("restauração não conferida há 9 dias", BackupStatus.Linha(velha));
    }

    [Fact]
    public void Linha_da_025_nao_muda_sem_o_estado_externo()
    {
        var e = BackupStatus.Ler(Arquivo(LocalEmDia), Agora);
        Assert.Null(e.Externo);
        Assert.Equal("Backup: ok, o último terminou há 5 h.", BackupStatus.Linha(e));
    }
}

public class BackupStatusApiTests : IClassFixture<BackupStatusApiTests.Factory>
{
    public class Factory : TasksApiFactory
    {
        public readonly string Status = Path.Combine(Path.GetTempPath(), $"backup-status-{Guid.NewGuid():N}.json");
        public readonly string Externo = Path.Combine(Path.GetTempPath(), $"backup-externo-{Guid.NewGuid():N}.json");

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("Sistema:BackupStatus", Status);
            builder.UseSetting("Sistema:BackupExterno", Externo);
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

    [Fact]
    public async Task Devolve_externo_e_conferencia_sem_campos_alem_do_contrato()
    {
        File.WriteAllText(_factory.Status, $$"""{"concluidoEm":"{{DateTime.UtcNow.AddHours(-2):O}}","arquivos":[],"totalBytes":0}""");
        File.WriteAllText(_factory.Externo, $$$"""
            {"copia":{"concluidoEm":"{{{DateTime.UtcNow.AddHours(-2):O}}}","ok":true,"bytesTotal":42,"instantaneo":"abc","segredo":"nao-deve-sair"},
             "conferencia":{"concluidoEm":"{{{DateTime.UtcNow.AddDays(-2):O}}}","ok":true}}
            """);
        var admin = await LogadoComo("admin-backup@example.com");
        var corpo = await admin.GetStringAsync("/api/sistema/backup");
        Assert.DoesNotContain("nao-deve-sair", corpo);
        var estado = JsonDocument.Parse(corpo).RootElement;
        var externo = estado.GetProperty("externo");
        Assert.True(externo.GetProperty("registrado").GetBoolean());
        Assert.False(externo.GetProperty("atrasado").GetBoolean());
        Assert.Equal(42, externo.GetProperty("bytesTotal").GetInt64());
        Assert.Equal(
            ["atrasado", "bytesTotal", "concluidoEm", "idadeHoras", "registrado", "ultimaFalha"],
            externo.EnumerateObject().Select(p => p.Name).Order().ToArray());
        Assert.True(estado.GetProperty("conferencia").GetProperty("ok").GetBoolean());
    }
}
