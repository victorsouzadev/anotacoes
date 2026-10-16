using Hub.Core;
using Hub.Data;
using Hub.Pipeline;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Options;

namespace Hub.Tests;

/// <summary>Chave de transcrição pela tela: vale sobre o .env, fica cifrada e pode ser apagada.</summary>
public sealed class TranscriptionSettingsTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "cerebro-transc-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    private TranscriptionSettings Criar(string envKey)
    {
        var o = new HubOptions { DataPath = Path.Combine(_dir, "hub"), VaultPath = Path.Combine(_dir, "vault") };
        o.Web.JwtSecret = "segredo-jwt-de-teste-com-32-bytes!!";
        o.Transcription.ApiKey = envKey;
        var opts = Options.Create(o);
        return new TranscriptionSettings(new HubDb(opts), opts, new SecretBox(opts));
    }

    [Fact]
    public void Tela_vale_sobre_o_servidor_e_apagar_volta_ao_env()
    {
        var t = Criar("sk-do-env");
        Assert.Equal("servidor", t.Resolve().KeySource);

        t.Save("groq", null, "gsk_da_tela");
        var e = t.Resolve();
        Assert.Equal(("tela", "gsk_da_tela", "whisper-large-v3-turbo"), (e.KeySource, e.ApiKey, e.Model));
        Assert.Contains("groq.com", e.BaseUrl);
        Assert.DoesNotContain("gsk_da_tela", t.Load().EncryptedKey);

        t.Save("groq", "whisper-large-v3", null);
        Assert.Equal(("gsk_da_tela", "whisper-large-v3"), (t.Resolve().ApiKey, t.Resolve().Model));

        t.Save("groq", null, "");
        Assert.Equal("sk-do-env", t.Resolve().ApiKey);
    }

    [Fact]
    public void Sem_chave_nenhuma_fica_desligada() => Assert.False(Criar("").Resolve().Enabled);
}
