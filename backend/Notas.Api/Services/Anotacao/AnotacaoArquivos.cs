using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Notas.Api.Dtos;

namespace Notas.Api.Services.Anotacao;

public class AnotacaoOptions
{
    public const string SectionName = "Anotacao";

    /// <summary>
    /// Pasta de um run do llm-ner-pipeline (a que tem documents.jsonl). Os relatos são
    /// boletins de ocorrência reais: a pasta só existe na máquina de quem anota, e sem ela
    /// configurada a ferramenta fica desligada (é o caso da VPS).
    /// </summary>
    public string? RunDir { get; set; }

    /// <summary>E-mails (separados por vírgula) que podem ver os relatos. Vazio = ninguém:
    /// o cadastro do hub é aberto, então estar logado não basta.</summary>
    public string Usuarios { get; set; } = "";

    public bool PodeAnotar(string? email) =>
        !string.IsNullOrWhiteSpace(email) &&
        Usuarios.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(u => string.Equals(u, email, StringComparison.OrdinalIgnoreCase));
}

/// <summary>
/// Aprovação das pré-anotações do Claude. Lê os arquivos do run do pipeline e devolve a
/// decisão no mesmo formato que a revisão em Streamlit grava: uma linha a mais no
/// manual_review.jsonl, que a revisão de lá passa a enxergar na hora. Nada vai para o banco.
/// </summary>
public class AnotacaoArquivos
{
    public static readonly HashSet<string> Tipos = new(StringComparer.Ordinal)
    {
        "PERSON", "CPF", "RG", "CNPJ", "CNH", "PHONE", "EMAIL", "ADDRESS", "VEHICLE", "COMPANY", "BANK", "CARD",
    };

    private const string Propostas = "claude_proposals.jsonl";
    private const string Revisoes = "manual_review.jsonl";
    private const string Documentos = "documents.jsonl";

    private static readonly JsonSerializerOptions Linha = new() { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private readonly string? _dir;
    private readonly SemaphoreSlim _escrita = new(1, 1);
    private Dictionary<string, string>? _textos;
    private DateTime _textosLidosEm;

    public AnotacaoArquivos(IOptions<AnotacaoOptions> options)
    {
        _dir = options.Value.RunDir;
    }

    public bool Habilitado => !string.IsNullOrWhiteSpace(_dir) && File.Exists(Path.Combine(_dir, Documentos));

    public EstadoAnotacaoResponse Estado()
    {
        if (!Habilitado) return new EstadoAnotacaoResponse(false, 0, 0);
        var (pendentes, aprovadas) = Contagem(LerPropostas(), LerRevisoes());
        return new EstadoAnotacaoResponse(true, pendentes, aprovadas);
    }

    /// <summary>A próxima proposta sem decisão, na ordem em que os lotes foram gravados.</summary>
    public DocumentoAnotacaoResponse? Proximo(IReadOnlySet<string> pular)
    {
        var propostas = LerPropostas();
        var revisoes = LerRevisoes();
        var (pendentes, aprovadas) = Contagem(propostas, revisoes);

        foreach (var (rowId, proposta) in propostas)
        {
            if (revisoes.ContainsKey(rowId) || pular.Contains(rowId)) continue;
            if (!Textos().TryGetValue(rowId, out var texto)) continue;

            var entidades = new List<EntidadeAnotacaoDto>();
            foreach (var e in proposta["entities"]?.AsArray() ?? [])
            {
                var inicio = ParaUtf16(texto, e!["span_start"]!.GetValue<int>());
                var fim = ParaUtf16(texto, e["span_end"]!.GetValue<int>());
                if (inicio < 0 || fim > texto.Length || inicio >= fim) continue;
                entidades.Add(new EntidadeAnotacaoDto(e["entity_type"]!.GetValue<string>(), inicio, fim, texto[inicio..fim]));
            }
            return new DocumentoAnotacaoResponse(rowId, texto, entidades, proposta["model"]?.GetValue<string>(), pendentes, aprovadas);
        }
        return null;
    }

    /// <summary>Grava a decisão. Devolve o erro para mostrar na tela, ou null quando gravou.</summary>
    public async Task<string?> RegistrarAsync(string rowId, DecisaoAnotacaoRequest req, CancellationToken ct)
    {
        if (!Textos().TryGetValue(rowId, out var texto)) return "Documento não encontrado no run.";
        if (!LerPropostas().TryGetValue(rowId, out var proposta)) return "Documento sem proposta do Claude.";

        var entidades = new List<JsonObject>();
        foreach (var e in req.Entidades ?? [])
        {
            if (!Tipos.Contains(e.Tipo)) return $"Tipo desconhecido: {e.Tipo}.";
            if (e.Inicio < 0 || e.Fim > texto.Length || e.Inicio >= e.Fim) return "Trecho fora do texto.";
            // O texto vem do relato, não do navegador: a posição é o que vale.
            entidades.Add(new JsonObject
            {
                ["entity_type"] = e.Tipo,
                ["extracted_text"] = texto[e.Inicio..e.Fim],
                ["span_start"] = ParaCodepoint(texto, e.Inicio),
                ["span_end"] = ParaCodepoint(texto, e.Fim),
                ["justification"] = "hub",
            });
        }
        entidades.Sort((a, b) => a["span_start"]!.GetValue<int>().CompareTo(b["span_start"]!.GetValue<int>()));

        var original = (proposta["entities"]?.AsArray() ?? [])
            .Select(p => (p!["entity_type"]!.GetValue<string>(), p["span_start"]!.GetValue<int>(), p["span_end"]!.GetValue<int>()))
            .ToHashSet();
        var final = entidades
            .Select(p => (p["entity_type"]!.GetValue<string>(), p["span_start"]!.GetValue<int>(), p["span_end"]!.GetValue<int>()))
            .ToHashSet();

        var linha = new JsonObject
        {
            ["timestamp"] = DateTime.UtcNow.ToString("O"),
            ["row_id"] = rowId,
            ["status"] = original.SetEquals(final) ? "approved" : "corrected",
            ["notes"] = req.Observacao?.Trim() ?? "",
            ["entities"] = new JsonArray(entidades.ToArray<JsonNode?>()),
            ["category"] = "claude_proposal",
            ["queue_types"] = new JsonArray(),
            ["validation_error_count"] = 0,
            ["qa_review_recommended"] = false,
            ["has_qa_divergence"] = false,
            ["reviewer"] = "victor",
            ["source"] = "hub",
            ["proposal_model"] = proposta["model"]?.GetValue<string>(),
        };

        await _escrita.WaitAsync(ct);
        try
        {
            await File.AppendAllTextAsync(Path.Combine(_dir!, Revisoes), linha.ToJsonString(Linha) + "\n", new UTF8Encoding(false), ct);
        }
        finally
        {
            _escrita.Release();
        }
        return null;
    }

    private static (int Pendentes, int Aprovadas) Contagem(Dictionary<string, JsonObject> propostas, Dictionary<string, JsonObject> revisoes)
    {
        var pendentes = propostas.Keys.Count(id => !revisoes.ContainsKey(id));
        var aprovadas = revisoes.Values.Count(r => r["source"]?.GetValue<string>() == "hub");
        return (pendentes, aprovadas);
    }

    /// <summary>Última linha de cada documento, como a revisão em Streamlit lê.</summary>
    private Dictionary<string, JsonObject> LerRevisoes() => LerPorDocumento(Revisoes, ultimaVence: true);

    /// <summary>A primeira proposta de cada documento, na ordem do arquivo (a ordem dos lotes).</summary>
    private Dictionary<string, JsonObject> LerPropostas() => LerPorDocumento(Propostas, ultimaVence: false);

    private Dictionary<string, JsonObject> LerPorDocumento(string arquivo, bool ultimaVence)
    {
        var resultado = new Dictionary<string, JsonObject>();
        var caminho = Path.Combine(_dir!, arquivo);
        if (!File.Exists(caminho)) return resultado;

        foreach (var linha in File.ReadLines(caminho))
        {
            if (string.IsNullOrWhiteSpace(linha)) continue;
            if (JsonNode.Parse(linha) is not JsonObject obj) continue;
            var rowId = obj["row_id"]?.ToString();
            if (string.IsNullOrEmpty(rowId)) continue;
            if (ultimaVence || !resultado.ContainsKey(rowId)) resultado[rowId] = obj;
        }
        return resultado;
    }

    /// <summary>Os relatos (~10 MB) ficam em memória e só são relidos quando o arquivo muda.</summary>
    private Dictionary<string, string> Textos()
    {
        var caminho = Path.Combine(_dir!, Documentos);
        var modificado = File.GetLastWriteTimeUtc(caminho);
        if (_textos is not null && modificado == _textosLidosEm) return _textos;

        var textos = new Dictionary<string, string>();
        foreach (var linha in File.ReadLines(caminho))
        {
            if (string.IsNullOrWhiteSpace(linha)) continue;
            var obj = JsonNode.Parse(linha)!;
            textos[obj["row_id"]!.ToString()] = obj["original_text"]!.GetValue<string>();
        }
        _textos = textos;
        _textosLidosEm = modificado;
        return textos;
    }

    /// <summary>O pipeline conta posições em code points (Python); o navegador, em UTF-16.
    /// Só diferem quando o texto tem caractere fora do BMP (emoji), mas aí diferem.</summary>
    public static int ParaUtf16(string texto, int codepoint)
    {
        var i = 0;
        for (var c = 0; c < codepoint && i < texto.Length; c++)
            i += char.IsHighSurrogate(texto[i]) && i + 1 < texto.Length ? 2 : 1;
        return i;
    }

    public static int ParaCodepoint(string texto, int utf16)
    {
        var c = 0;
        for (var i = 0; i < utf16 && i < texto.Length; c++)
            i += char.IsHighSurrogate(texto[i]) && i + 1 < texto.Length ? 2 : 1;
        return c;
    }
}
