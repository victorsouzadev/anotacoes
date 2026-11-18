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

/// <summary>Leitura de texto de PDFs e imagens (spec 026).</summary>
public sealed class AttachmentReaderTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "cerebro-anexo-" + Guid.NewGuid().ToString("N"));

    public AttachmentReaderTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    private (AttachmentReader Reader, AiSettings Ai, Stub Handler) Make(string resposta, string provider = AiProvider.Anthropic, HttpStatusCode status = HttpStatusCode.OK)
    {
        var o = new HubOptions { DataPath = _dir };
        o.Web.JwtSecret = "segredo-jwt-de-teste-com-32-bytes!!";
        var db = new HubDb(Options.Create(o));
        var ai = new AiSettings(db, Options.Create(o), new SecretBox(Options.Create(o)));
        ai.Save(provider, null, provider == AiProvider.Anthropic ? "sk-ant-teste" : "sk-or-teste");
        var handler = new Stub(resposta, status);
        var classifier = new ClaudeClassifier(new StubFactory(handler), Options.Create(o), ai, NullLogger<ClaudeClassifier>.Instance);
        return (new AttachmentReader(classifier, ai), ai, handler);
    }

    private string Arquivo(string nome, byte[] dados)
    {
        var p = Path.Combine(_dir, nome);
        File.WriteAllBytes(p, dados);
        return p;
    }

    private const string RespostaAnthropic = """
        {"content":[{"type":"tool_use","name":"transcrever_anexo","input":{"tem_texto":true,"texto":"Total R$ 42,90\nPadaria Central"}}]}
        """;

    [Fact]
    public async Task Desligado_por_padrao_nao_chama_a_ia()
    {
        var (reader, ai, handler) = Make(RespostaAnthropic);
        ai.SetLerAnexos(false);
        var r = await reader.LerAsync(Arquivo("recibo.jpg", [1, 2, 3]), CancellationToken.None);
        Assert.Null(r.Texto);
        Assert.Contains("desligada", r.Aviso);
        Assert.Null(handler.Body);
    }

    [Fact]
    public async Task Imagem_vai_como_bloco_image_na_anthropic_e_volta_o_texto()
    {
        var (reader, ai, handler) = Make(RespostaAnthropic);
        ai.SetLerAnexos(true);
        var r = await reader.LerAsync(Arquivo("recibo.jpg", [0xFF, 0xD8, 0xFF]), CancellationToken.None);
        Assert.Equal("Total R$ 42,90\nPadaria Central", r.Texto);
        var conteudo = JsonNode.Parse(handler.Body!)!["messages"]![0]!["content"]!.AsArray();
        Assert.Equal("image", conteudo[0]!["type"]!.GetValue<string>());
        Assert.Equal("image/jpeg", conteudo[0]!["source"]!["media_type"]!.GetValue<string>());
        Assert.Equal(Convert.ToBase64String([0xFF, 0xD8, 0xFF]), conteudo[0]!["source"]!["data"]!.GetValue<string>());
        Assert.Equal("text", conteudo[1]!["type"]!.GetValue<string>());
    }

    [Fact]
    public async Task Pdf_na_openrouter_vai_como_file_e_imagem_sem_texto_vira_descricao()
    {
        var (reader, ai, handler) = Make("""
            {"choices":[{"message":{"tool_calls":[{"function":{"name":"transcrever_anexo","arguments":"{\"tem_texto\":false,\"texto\":\"\",\"descricao\":\"Foto de uma praia.\"}"}}]}}]}
            """, AiProvider.OpenRouter);
        ai.SetLerAnexos(true);
        var pdf = Encoding.Latin1.GetBytes("%PDF-1.4\n1 0 obj << /Type /Pages /Count 1 >>\n2 0 obj << /Type /Page >>\n%%EOF");
        var r = await reader.LerAsync(Arquivo("doc.pdf", pdf), CancellationToken.None);
        Assert.Equal("*Sem texto legível.* Foto de uma praia.", r.Texto);
        var parte = JsonNode.Parse(handler.Body!)!["messages"]![1]!["content"]![0]!;
        Assert.Equal("file", parte["type"]!.GetValue<string>());
        Assert.StartsWith("data:application/pdf;base64,", parte["file"]!["file_data"]!.GetValue<string>());
    }

    [Fact]
    public async Task Limites_e_heic_viram_aviso_sem_chamar_a_ia()
    {
        var (reader, ai, handler) = Make(RespostaAnthropic);
        ai.SetLerAnexos(true);
        var grande = await reader.LerAsync(Arquivo("grande.png", new byte[AttachmentReader.MaxBytes + 1]), CancellationToken.None);
        Assert.Contains("maior que 10 MB", grande.Aviso);
        var paginas = string.Concat(Enumerable.Repeat("<< /Type /Page >>\n", 21));
        var longo = await reader.LerAsync(Arquivo("longo.pdf", Encoding.Latin1.GetBytes("%PDF-1.4\n" + paginas)), CancellationToken.None);
        Assert.Contains("mais de 20 páginas", longo.Aviso);
        var heic = await reader.LerAsync(Arquivo("foto.heic", [1]), CancellationToken.None);
        Assert.Contains("HEIC", heic.Aviso);
        Assert.Null(handler.Body);
    }

    [Fact]
    public async Task Pdf_que_o_modelo_nao_le_vira_aviso_e_nao_derruba_a_captura()
    {
        var (reader, ai, _) = Make("""{"error":{"message":"model does not support file input"}}""", AiProvider.OpenRouter, HttpStatusCode.BadRequest);
        ai.SetLerAnexos(true);
        var r = await reader.LerAsync(Arquivo("doc.pdf", Encoding.Latin1.GetBytes("%PDF-1.4\n<< /Type /Page >>")), CancellationToken.None);
        Assert.Null(r.Texto);
        Assert.Contains("Não foi possível ler o PDF", r.Aviso);
    }

    [Fact]
    public void Conta_paginas_sem_confundir_com_pages() =>
        Assert.Equal(2, AttachmentReader.ContarPaginasPdf(Encoding.Latin1.GetBytes("/Type /Pages /Type /Page /Type/Page /Type /PageLabel")));

    private sealed class Stub(string response, HttpStatusCode status) : HttpMessageHandler
    {
        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Body = await request.Content!.ReadAsStringAsync(ct);
            return new HttpResponseMessage(status) { Content = new StringContent(response, Encoding.UTF8, "application/json") };
        }
    }

    private sealed class StubFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }
}
