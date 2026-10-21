using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Notas.Api.Dtos;
using Notas.Api.Services.Anotacao;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>
/// Aprovação das pré-anotações do Claude: lê os arquivos de um run do pipeline numa
/// pasta temporária e confere que a decisão sai no formato que a revisão em Streamlit lê.
/// </summary>
public class AnotacaoTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"anotacao_{Guid.NewGuid():N}");

    public AnotacaoTests() => Directory.CreateDirectory(_dir);

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private AnotacaoArquivos Servico(string? dir = null) =>
        new(Options.Create(new AnotacaoOptions { RunDir = dir ?? _dir }));

    private void Gravar(string arquivo, params object[] linhas) =>
        File.WriteAllLines(Path.Combine(_dir, arquivo), linhas.Select(l => System.Text.Json.JsonSerializer.Serialize(l)));

    private static object Entidade(string tipo, int ini, int fim) =>
        new { entity_type = tipo, extracted_text = "x", span_start = ini, span_end = fim, justification = "claude" };

    private List<JsonObject> Revisoes() =>
        File.ReadAllLines(Path.Combine(_dir, "manual_review.jsonl")).Select(l => (JsonObject)JsonNode.Parse(l)!).ToList();

    [Fact]
    public void Sem_pasta_configurada_fica_desligada()
    {
        Assert.False(Servico("").Habilitado);
        Assert.False(Servico(Path.Combine(_dir, "nao-existe")).Habilitado);
        Assert.False(Servico().Habilitado); // pasta existe, mas sem documents.jsonl
    }

    [Fact]
    public void Proximo_pula_documentos_ja_revisados_e_os_pulados_na_sessao()
    {
        Gravar("documents.jsonl",
            new { row_id = "1", original_text = "ANA PRADO" },
            new { row_id = "2", original_text = "JOAO SILVA" },
            new { row_id = "3", original_text = "MARIA" });
        Gravar("claude_proposals.jsonl",
            new { row_id = "1", entities = new[] { Entidade("PERSON", 0, 9) }, model = "claude" },
            new { row_id = "2", entities = new[] { Entidade("PERSON", 0, 10) }, model = "claude" },
            new { row_id = "3", entities = Array.Empty<object>(), model = "claude" });
        Gravar("manual_review.jsonl", new { row_id = "1", entities = Array.Empty<object>() });

        var servico = Servico();
        var doc = servico.Proximo(new HashSet<string>())!;
        Assert.Equal("2", doc.RowId);
        Assert.Equal("JOAO SILVA", doc.Entidades.Single().Texto);
        Assert.Equal(2, doc.Pendentes);

        Assert.Equal("3", servico.Proximo(new HashSet<string> { "2" })!.RowId);
        Assert.Null(servico.Proximo(new HashSet<string> { "2", "3" }));
    }

    [Fact]
    public async Task Decisao_sem_mudanca_e_aprovada_e_com_mudanca_e_corrigida()
    {
        Gravar("documents.jsonl",
            new { row_id = "1", original_text = "ANA PRADO LIGOU" },
            new { row_id = "2", original_text = "TIM 91 98888-7777" });
        Gravar("claude_proposals.jsonl",
            new { row_id = "1", entities = new[] { Entidade("PERSON", 0, 9) }, model = "claude" },
            new { row_id = "2", entities = new[] { Entidade("COMPANY", 0, 3) }, model = "claude" });
        var servico = Servico();

        Assert.Null(await servico.RegistrarAsync("1",
            new DecisaoAnotacaoRequest([new EntidadeAnotacaoDto("PERSON", 0, 9, "qualquer")], null), default));
        Assert.Null(await servico.RegistrarAsync("2",
            new DecisaoAnotacaoRequest([new EntidadeAnotacaoDto("COMPANY", 0, 3, "TIM"), new EntidadeAnotacaoDto("PHONE", 4, 17, "")], " ok "), default));

        var linhas = Revisoes();
        Assert.Equal("approved", linhas[0]["status"]!.GetValue<string>());
        // O texto gravado vem do relato, não do que o navegador mandou.
        Assert.Equal("ANA PRADO", linhas[0]["entities"]![0]!["extracted_text"]!.GetValue<string>());
        Assert.Equal("hub", linhas[0]["source"]!.GetValue<string>());
        Assert.Equal("corrected", linhas[1]["status"]!.GetValue<string>());
        Assert.Equal("ok", linhas[1]["notes"]!.GetValue<string>());
        Assert.Equal(2, servico.Estado().Aprovadas);
        Assert.Equal(0, servico.Estado().Pendentes);
    }

    [Fact]
    public async Task Decisao_invalida_nao_grava_nada()
    {
        Gravar("documents.jsonl", new { row_id = "1", original_text = "ANA" });
        Gravar("claude_proposals.jsonl", new { row_id = "1", entities = Array.Empty<object>(), model = "claude" });
        var servico = Servico();

        Assert.NotNull(await servico.RegistrarAsync("1", new DecisaoAnotacaoRequest([new EntidadeAnotacaoDto("NOME", 0, 3, "")], null), default));
        Assert.NotNull(await servico.RegistrarAsync("1", new DecisaoAnotacaoRequest([new EntidadeAnotacaoDto("PERSON", 0, 99, "")], null), default));
        Assert.NotNull(await servico.RegistrarAsync("9", new DecisaoAnotacaoRequest([], null), default));
        Assert.False(File.Exists(Path.Combine(_dir, "manual_review.jsonl")));
    }

    [Fact]
    public void Converte_posicoes_entre_python_e_javascript()
    {
        // O emoji ocupa 1 code point no Python e 2 unidades UTF-16 no navegador.
        var texto = "OI 😀 ANA";
        Assert.Equal(6, AnotacaoArquivos.ParaUtf16(texto, 5));
        Assert.Equal(5, AnotacaoArquivos.ParaCodepoint(texto, 6));
        Assert.Equal(texto.Length, AnotacaoArquivos.ParaUtf16(texto, 8));
    }
}
