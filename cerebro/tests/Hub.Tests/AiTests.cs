using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Hub.Core;
using Hub.Data;
using Hub.Pipeline;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Hub.Tests;

public sealed class AiTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "cerebro-ai-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    private (AiSettings Settings, HubDb Db, HubOptions Options) Make(string anthropicKey = "", string openRouterKey = "", string jwt = "segredo-jwt-de-teste-com-32-bytes!!")
    {
        var o = new HubOptions { DataPath = _dir };
        o.Anthropic.ApiKey = anthropicKey;
        o.OpenRouter.ApiKey = openRouterKey;
        o.Web.JwtSecret = jwt;
        var db = new HubDb(Options.Create(o));
        return (new AiSettings(db, Options.Create(o), new SecretBox(Options.Create(o))), db, o);
    }

    [Fact]
    public void Sem_nada_configurado_fica_desligado()
    {
        var (ai, _, _) = Make();
        Assert.False(ai.Resolve().Enabled);
    }

    [Fact]
    public void Padrao_usa_o_servidor_anthropic_antes_da_openrouter()
    {
        Assert.Equal(AiProvider.Anthropic, Make("sk-ant", "sk-or").Settings.Resolve().Provider);
        var soOpenRouter = Make(openRouterKey: "sk-or-servidor").Settings.Resolve();
        Assert.Equal(AiProvider.OpenRouter, soOpenRouter.Provider);
        Assert.Equal("servidor", soOpenRouter.KeySource);
        Assert.Equal("anthropic/claude-haiku-4.5", soOpenRouter.Model);
    }

    [Fact]
    public void Chave_da_tela_vence_o_servidor_e_fica_cifrada()
    {
        var (ai, db, _) = Make(openRouterKey: "sk-or-servidor");
        ai.Save(AiProvider.OpenRouter, "openai/gpt-4o-mini", "sk-or-da-tela-1234");

        var e = ai.Resolve();
        Assert.Equal("sk-or-da-tela-1234", e.ApiKey);
        Assert.Equal("tela", e.KeySource);
        Assert.Equal("openai/gpt-4o-mini", e.Model);
        Assert.Equal("••••••••1234", AiSettings.Mask(ai.StoredKey()));
        Assert.DoesNotContain("sk-or-da-tela", db.GetSetting("ai")!.Value.Value);
    }

    [Fact]
    public void Null_mantem_a_chave_e_vazio_apaga()
    {
        var (ai, _, _) = Make();
        ai.Save(AiProvider.OpenRouter, null, "sk-or-1");
        ai.Save(AiProvider.OpenRouter, "google/gemini-3.6-flash", null);
        Assert.Equal("sk-or-1", ai.StoredKey());
        ai.Save(AiProvider.OpenRouter, null, "");
        Assert.Null(ai.StoredKey());
        Assert.False(ai.Resolve().Enabled);
    }

    [Fact]
    public void Desligado_ignora_as_chaves_do_servidor()
    {
        var (ai, _, _) = Make("sk-ant", "sk-or");
        ai.Save(AiProvider.Off, null, null);
        Assert.False(ai.Resolve().Enabled);
    }

    [Fact]
    public void Jwt_trocado_invalida_a_chave_salva_sem_quebrar()
    {
        Make().Settings.Save(AiProvider.OpenRouter, null, "sk-or-antiga");
        var (outro, _, _) = Make(jwt: "outro-segredo-jwt-com-mais-de-32-bytes!!");
        Assert.Null(outro.StoredKey());
        Assert.False(outro.Resolve().Enabled);
    }

    [Fact]
    public async Task OpenRouter_envia_tool_forcada_e_le_a_tool_call()
    {
        var (ai, _, o) = Make();
        ai.Save(AiProvider.OpenRouter, "openai/gpt-4o-mini", "sk-or-teste");
        var handler = new StubHandler("""
            {"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"1","type":"function",
              "function":{"name":"classificar_nota","arguments":"{\"title\":\"Resumos de reunião\",\"summary\":\"Guardar resumos.\",\"tags\":[\"Reunioes\",\"obsidian\"],\"folder\":\"10-Projetos\",\"links\":[\"Inexistente\"],\"confidence\":0.8}"}}]}}]}
            """);
        var classifier = new ClaudeClassifier(new StubFactory(handler), Options.Create(o), ai, NullLogger<ClaudeClassifier>.Instance);

        var r = await classifier.ClassifyAsync("t", "corpo", "teste", VaultLayout.PermanentFolders, [], CancellationToken.None);

        Assert.Equal("Resumos de reunião", r.Title);
        Assert.Equal("10-Projetos", r.Folder);
        Assert.Empty(r.Links);  // só notas que existem
        Assert.Equal("https://openrouter.ai/api/v1/chat/completions", handler.Request!.RequestUri!.ToString());
        Assert.Equal("Bearer sk-or-teste", handler.Request.Headers.Authorization!.ToString());
        var body = JsonNode.Parse(handler.Body!)!;
        Assert.Equal("openai/gpt-4o-mini", body["model"]!.GetValue<string>());
        Assert.Equal("classificar_nota", body["tool_choice"]!["function"]!["name"]!.GetValue<string>());
    }

    [Fact]
    public async Task OpenRouter_aceita_json_no_texto_e_explica_erro_http()
    {
        var (ai, _, o) = Make(openRouterKey: "sk-or");
        var texto = new StubHandler("""{"choices":[{"message":{"content":"Aqui: {\"title\":\"X\",\"summary\":\"\",\"tags\":[],\"folder\":\"30-Recursos\",\"links\":[],\"confidence\":1}"}}]}""");
        var r = await new ClaudeClassifier(new StubFactory(texto), Options.Create(o), ai, NullLogger<ClaudeClassifier>.Instance)
            .ClassifyAsync("t", "c", "s", VaultLayout.PermanentFolders, [], CancellationToken.None);
        Assert.Equal("30-Recursos", r.Folder);

        var erro = new StubHandler("""{"error":{"message":"No auth credentials found"}}""", HttpStatusCode.Unauthorized);
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            new ClaudeClassifier(new StubFactory(erro), Options.Create(o), ai, NullLogger<ClaudeClassifier>.Instance)
                .ClassifyAsync("t", "c", "s", VaultLayout.PermanentFolders, [], CancellationToken.None));
        Assert.Contains("OpenRouter 401", ex.Message);
    }

    private sealed class StubHandler(string response, HttpStatusCode status = HttpStatusCode.OK) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }
        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Request = request;
            Body = await request.Content!.ReadAsStringAsync(ct);
            return new HttpResponseMessage(status) { Content = new StringContent(response, Encoding.UTF8, "application/json") };
        }
    }

    private sealed class StubFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }
}
