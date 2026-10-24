using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace Notas.Api.Services.Estudio;

/// <summary>Pedido que não bate com o catálogo (modelo, operação ou parâmetro inválido).</summary>
public class ErroDoEstudio(string mensagem) : Exception(mensagem);

public sealed class CustoSpec
{
    public double Fixo { get; set; }
    public double PorUnidade { get; set; }
    public double PorSegundo { get; set; }
    public double PorCaractere { get; set; }
    public Dictionary<string, Dictionary<string, double>> Mult { get; set; } = [];
}

public sealed class OperacaoSpec
{
    public string Endpoint { get; set; } = "";
    public Dictionary<string, string> Mapa { get; set; } = [];
    public List<string> Obrigatorios { get; set; } = [];
    public Dictionary<string, List<JsonElement>> Opcoes { get; set; } = [];
    public Dictionary<string, JsonElement> Padroes { get; set; } = [];
    public Dictionary<string, double[]> Limites { get; set; } = [];
    public JsonObject? Fixos { get; set; }
    public CustoSpec Custo { get; set; } = new();
    public int? MaxImagens { get; set; }
    /// <summary>Cobra pela duração do vídeo de entrada (ex.: tirar o fundo de um vídeo).</summary>
    public bool DuracaoDaEntrada { get; set; }
}

public sealed class ModeloSpec
{
    public string Id { get; set; } = "";
    public string Nome { get; set; } = "";
    public string Familia { get; set; } = "";
    /// <summary>imagem, video, audio, modelo3d ou mundo — o que a geração devolve.</summary>
    public string Tipo { get; set; } = "";
    /// <summary>fal (padrão) ou worldlabs.</summary>
    public string Provedor { get; set; } = "fal";
    public string? Descricao { get; set; }
    public Dictionary<string, OperacaoSpec> Ops { get; set; } = [];
}

/// <summary>
/// Catálogo de modelos do Estúdio: o que cada modelo do fal.ai (e da World Labs) aceita e como
/// os parâmetros genéricos da tela e do MCP (prompt, proporção, duração…) viram os campos do
/// provedor. Vem de um JSON embutido; <see cref="EstudioOptions.CatalogoArquivo"/> soma ou
/// substitui modelos sem recompilar — os provedores trocam endpoint com frequência.
/// </summary>
public sealed class Catalogo
{
    /// <summary>Entradas que são arquivos (ids de mídia que viram URLs antes de ir ao provedor).</summary>
    public static readonly string[] ChavesDeMidia =
        ["imagens", "imagem", "imagemFinal", "imagemCostas", "imagemEsquerda", "imagemDireita", "mascara", "video", "videos", "audios", "arquivo3d"];

    /// <summary>Entradas de mídia que são listas por natureza.</summary>
    private static readonly HashSet<string> ChavesDeLista = ["imagens", "videos", "audios"];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public IReadOnlyList<ModeloSpec> Modelos { get; }
    private readonly Dictionary<string, ModeloSpec> _porId;

    public Catalogo(IOptions<EstudioOptions> options, ILogger<Catalogo> log)
    {
        using var embutido = typeof(Catalogo).Assembly.GetManifestResourceStream("Notas.Api.Services.Estudio.catalogo.json")
            ?? throw new InvalidOperationException("catalogo.json não está embutido no assembly.");
        var raiz = JsonNode.Parse(embutido)!.AsObject();
        var modelos = (raiz["modelos"] as JsonArray ?? []).OfType<JsonObject>().ToList();

        var extra = options.Value.CatalogoArquivo;
        if (!string.IsNullOrWhiteSpace(extra) && File.Exists(extra))
        {
            try
            {
                var outros = JsonNode.Parse(File.ReadAllText(extra))?["modelos"] as JsonArray ?? [];
                foreach (var m in outros.OfType<JsonObject>())
                {
                    var id = (string?)m["id"];
                    modelos.RemoveAll(x => (string?)x["id"] == id);
                    modelos.Add(m);
                }
            }
            catch (JsonException e)
            {
                log.LogWarning(e, "Estúdio: catálogo extra inválido em {Arquivo}; seguindo só com o embutido", extra);
            }
        }

        Modelos = Carregar(modelos);
        _porId = Modelos.ToDictionary(m => m.Id, StringComparer.OrdinalIgnoreCase);
    }

    public ModeloSpec? Modelo(string id) => _porId.GetValueOrDefault(id);

    public (ModeloSpec Modelo, OperacaoSpec Op) Resolver(string modeloId, string operacao)
    {
        var modelo = Modelo(modeloId) ?? throw new ErroDoEstudio($"Modelo desconhecido: '{modeloId}'.");
        if (!modelo.Ops.TryGetValue(operacao, out var op))
            throw new ErroDoEstudio($"{modelo.Nome} não faz '{operacao}'. Faz: {string.Join(", ", modelo.Ops.Keys)}.");
        return (modelo, op);
    }

    // ---------- montagem do pedido ao provedor ----------

    /// <summary>
    /// Traduz os parâmetros genéricos para o corpo que o provedor espera. <paramref name="urls"/> traz,
    /// para cada entrada de mídia, as URLs já acessíveis pelo provedor (ou marcadores, na validação).
    /// </summary>
    public static JsonObject MontarEntrada(OperacaoSpec op, JsonObject parametros, IReadOnlyDictionary<string, List<string>> urls)
    {
        Validar(op, parametros, urls);
        var corpo = op.Fixos?.DeepClone().AsObject() ?? [];
        foreach (var (chave, alvo) in op.Mapa)
        {
            var (campo, formato) = Separar(alvo);
            if (ChavesDeMidia.Contains(chave))
            {
                if (!urls.TryGetValue(chave, out var lista) || lista.Count == 0) continue;
                corpo[campo] = formato switch
                {
                    "lista" => new JsonArray(lista.Select(u => (JsonNode)JsonValue.Create(u)!).ToArray()),
                    "primeiro" => JsonValue.Create(lista[0]),
                    _ when ChavesDeLista.Contains(chave) => new JsonArray(lista.Select(u => (JsonNode)JsonValue.Create(u)!).ToArray()),
                    _ => JsonValue.Create(lista[0]),
                };
                continue;
            }

            var valor = Valor(op, parametros, chave);
            if (valor is null) continue;
            if (valor.GetValueKind() == JsonValueKind.String && string.IsNullOrWhiteSpace(valor.GetValue<string>())) continue;
            if (op.Limites.TryGetValue(chave, out var lim) && Numero(valor) is { } n)
                valor = JsonValue.Create(Math.Clamp(n, lim[0], lim[1]));
            corpo[campo] = Formatar(valor, formato);
        }
        return corpo;
    }

    /// <summary>Custo estimado em centavos de dólar.</summary>
    public static double EstimarCusto(OperacaoSpec op, JsonObject parametros, double? duracaoDaEntradaSeg = null)
    {
        var c = op.Custo;
        var unidades = Numero(Valor(op, parametros, "quantidade")) ?? 1;
        var segundos = op.DuracaoDaEntrada ? duracaoDaEntradaSeg ?? 10 : Numero(Valor(op, parametros, "duracao")) ?? 0;
        var chars = (Valor(op, parametros, "prompt")?.ToString() ?? "").Length;
        var total = c.Fixo + c.PorUnidade * unidades + c.PorSegundo * segundos + c.PorCaractere * chars;
        foreach (var (param, tabela) in c.Mult)
        {
            var v = Valor(op, parametros, param);
            if (v is null) continue;
            var chave = v.GetValueKind() switch
            {
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                JsonValueKind.Number => Numero(v)!.Value.ToString(CultureInfo.InvariantCulture),
                _ => v.ToString(),
            };
            var fator = tabela.FirstOrDefault(kv => string.Equals(kv.Key, chave, StringComparison.OrdinalIgnoreCase)).Value;
            if (fator > 0) total *= fator;
        }
        return Math.Round(total, 2);
    }

    private static void Validar(OperacaoSpec op, JsonObject parametros, IReadOnlyDictionary<string, List<string>> urls)
    {
        foreach (var obrig in op.Obrigatorios)
        {
            if (ChavesDeMidia.Contains(obrig))
            {
                if (!urls.TryGetValue(obrig, out var l) || l.Count == 0)
                    throw new ErroDoEstudio($"Falta a entrada '{NomeDaEntrada(obrig)}'.");
            }
            else if (Valor(op, parametros, obrig) is not { } v || string.IsNullOrWhiteSpace(v.ToString()))
            {
                throw new ErroDoEstudio(obrig == "prompt" ? "Escreva o prompt (o que você quer)." : $"Falta o parâmetro '{obrig}'.");
            }
        }

        if (op.MaxImagens is { } max && urls.TryGetValue("imagens", out var imgs) && imgs.Count > max)
            throw new ErroDoEstudio($"Este modelo aceita no máximo {max} imagem(ns) de referência.");

        foreach (var (chave, permitidos) in op.Opcoes)
        {
            if (parametros[chave] is not { } v || permitidos.Count == 0) continue;
            var texto = Comparavel(v);
            if (!permitidos.Any(p => string.Equals(Comparavel(p), texto, StringComparison.OrdinalIgnoreCase)))
                throw new ErroDoEstudio($"Valor inválido para '{chave}': {texto}. Aceita: {string.Join(", ", permitidos.Select(Comparavel))}.");
        }
    }

    private static string NomeDaEntrada(string chave) => chave switch
    {
        "imagens" => "imagens de referência",
        "imagem" => "imagem",
        "imagemFinal" => "imagem final",
        "mascara" => "máscara",
        "video" => "vídeo",
        "arquivo3d" => "modelo 3D",
        _ => chave,
    };

    private static JsonNode? Valor(OperacaoSpec op, JsonObject parametros, string chave)
    {
        if (parametros[chave] is { } v) return v.DeepClone();
        return op.Padroes.TryGetValue(chave, out var p) ? JsonNode.Parse(p.GetRawText()) : null;
    }

    private static (string Campo, string Formato) Separar(string alvo)
    {
        var i = alvo.IndexOf('|');
        return i < 0 ? (alvo, "") : (alvo[..i], alvo[(i + 1)..]);
    }

    private static double? Numero(JsonNode? v)
    {
        if (v is null) return null;
        return v.GetValueKind() switch
        {
            // GetValue<double>() falha num JsonValue criado a partir de int: o texto JSON serve para os dois.
            JsonValueKind.Number => double.Parse(v.ToJsonString(), CultureInfo.InvariantCulture),
            JsonValueKind.String when double.TryParse(v.GetValue<string>().TrimEnd('s'), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) => d,
            _ => null,
        };
    }

    private static string Comparavel(JsonNode v) => v.GetValueKind() switch
    {
        JsonValueKind.Number => Numero(v)!.Value.ToString(CultureInfo.InvariantCulture),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        _ => v.ToString(),
    };

    private static string Comparavel(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.Number => e.GetDouble().ToString(CultureInfo.InvariantCulture),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        _ => e.ToString(),
    };

    private static JsonNode? Formatar(JsonNode valor, string formato)
    {
        var texto = Comparavel(valor);
        return formato switch
        {
            "inteiro" => Numero(valor) is { } n ? JsonValue.Create((long)Math.Round(n)) : null,
            "decimal" => Numero(valor) is { } d ? JsonValue.Create(d) : null,
            "texto" => JsonValue.Create(texto),
            "sufixo-s" => JsonValue.Create(texto.EndsWith('s') ? texto : texto + "s"),
            "bool" => JsonValue.Create(valor.GetValueKind() == JsonValueKind.True || texto.Equals("true", StringComparison.OrdinalIgnoreCase)),
            "lista" => new JsonArray(valor.DeepClone()),
            "gpt-tamanho" => JsonValue.Create(texto switch
            {
                "1:1" => "1024x1024",
                "3:2" or "16:9" or "4:3" or "21:9" => "1536x1024",
                "2:3" or "9:16" or "3:4" => "1024x1536",
                _ => "auto",
            }),
            "flux-tamanho" => JsonValue.Create(texto switch
            {
                "1:1" => "square_hd",
                "16:9" or "21:9" => "landscape_16_9",
                "9:16" => "portrait_16_9",
                "4:3" or "3:2" => "landscape_4_3",
                "3:4" or "2:3" => "portrait_4_3",
                _ => texto,
            }),
            _ => valor.DeepClone(),
        };
    }

    // ---------- carga ----------

    private static List<ModeloSpec> Carregar(List<JsonObject> modelos)
    {
        // "base": "modelo:op" herda a operação de outro modelo; o que a operação traz por cima
        // substitui o campo inteiro (mapa, opções, custo…), não mescla por dentro.
        var brutos = new Dictionary<string, JsonObject>(StringComparer.OrdinalIgnoreCase);
        foreach (var m in modelos)
            foreach (var (nome, op) in m["ops"]?.AsObject() ?? [])
                if (op is JsonObject o) brutos[$"{m["id"]}:{nome}"] = o;

        var resolvidos = new Dictionary<string, JsonObject>(StringComparer.OrdinalIgnoreCase);
        JsonObject Resolver(string chave, int profundidade)
        {
            if (resolvidos.TryGetValue(chave, out var pronto)) return pronto;
            if (profundidade > 8 || !brutos.TryGetValue(chave, out var bruto))
                throw new InvalidOperationException($"Catálogo do Estúdio: operação base inexistente ou em ciclo: {chave}");
            var final = new JsonObject();
            if ((string?)bruto["base"] is { } baseChave)
                foreach (var (k, v) in Resolver(baseChave, profundidade + 1)) final[k] = v?.DeepClone();
            foreach (var (k, v) in bruto)
                if (k != "base") final[k] = v?.DeepClone();
            return resolvidos[chave] = final;
        }

        var lista = new List<ModeloSpec>();
        foreach (var m in modelos)
        {
            var modelo = new ModeloSpec
            {
                Id = (string?)m["id"] ?? "",
                Nome = (string?)m["nome"] ?? "",
                Familia = (string?)m["familia"] ?? "",
                Tipo = (string?)m["tipo"] ?? "",
                Provedor = (string?)m["provedor"] ?? "fal",
                Descricao = (string?)m["descricao"],
            };
            foreach (var (nome, _) in m["ops"]?.AsObject() ?? [])
                modelo.Ops[nome] = Resolver($"{modelo.Id}:{nome}", 0).Deserialize<OperacaoSpec>(Json)!;
            lista.Add(modelo);
        }
        return lista;
    }
}
