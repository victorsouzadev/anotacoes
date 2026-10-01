using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Notas.Api.Dtos;
using Notas.Api.Services.Financas.Llm;

namespace Notas.Api.Services.Moldes;

/// <summary>
/// Olha a foto de uma embalagem pronta (caixa milk, pirâmide, sacolinha…) e diz
/// qual molde do gerador ela é, com as medidas estimadas — a tela preenche o
/// gerador com isso e a pessoa só confere.
///
/// O catálogo de tipos e campos vem da própria tela, então um molde novo no
/// gerador já entra aqui sem mexer no servidor. Tudo o que volta da IA é
/// conferido contra esse catálogo: tipo desconhecido vira "nenhum", chave que
/// não existe some e número sai preso aos limites do campo.
/// </summary>
public interface IAnalisadorDeEmbalagem
{
    Task<AnalisarEmbalagemResponse> AnalisarAsync(
        string userId, string imagem, IReadOnlyList<TipoMoldeDto> tipos, MedidaConhecidaDto? medida, CancellationToken ct = default);
}

public class AnalisadorDeEmbalagem : IAnalisadorDeEmbalagem
{
    public const int MaxTipos = 30;
    public const int MaxCamposPorTipo = 30;
    private const int MaxTexto = 200;

    private readonly ILlmExtractorFactory _factory;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly OpenRouterOptions _padrao;
    private readonly ILogger<AnalisadorDeEmbalagem> _logger;

    public AnalisadorDeEmbalagem(
        ILlmExtractorFactory factory,
        IHttpClientFactory httpClientFactory,
        IOptions<OpenRouterOptions> padrao,
        ILogger<AnalisadorDeEmbalagem> logger)
    {
        _factory = factory;
        _httpClientFactory = httpClientFactory;
        _padrao = padrao.Value;
        _logger = logger;
    }

    private static AnalisarEmbalagemResponse Falha(string motivo) => new(false, motivo, null, null, null, null);

    public async Task<AnalisarEmbalagemResponse> AnalisarAsync(
        string userId, string imagem, IReadOnlyList<TipoMoldeDto> tipos, MedidaConhecidaDto? medida, CancellationToken ct = default)
    {
        var catalogo = tipos.Where(t => !string.IsNullOrWhiteSpace(t.Id)).Take(MaxTipos).ToList();
        if (catalogo.Count == 0) return Falha("Nenhum tipo de molde para comparar.");

        var credenciais = await _factory.ResolverCredenciaisAsync(userId, ct);
        if (credenciais.Provedor != "openrouter" || string.IsNullOrWhiteSpace(credenciais.Chave))
        {
            return Falha("Nenhum provedor de IA que leia imagens está configurado. Cadastre uma chave da OpenRouter em Configurações.");
        }

        var corpo = JsonSerializer.Serialize(new
        {
            model = credenciais.Modelo,
            max_tokens = 800,
            temperature = 0,
            response_format = new { type = "json_object" },
            messages = new object[]
            {
                new
                {
                    role = "user",
                    content = new object[]
                    {
                        new { type = "text", text = Prompt(catalogo, medida) },
                        new { type = "image_url", image_url = new { url = imagem } },
                    },
                },
            },
        });

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(_padrao.TimeoutComAnexosSegundos));
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, _padrao.BaseUrl);
            request.Headers.Add("Authorization", $"Bearer {credenciais.Chave}");
            request.Headers.Add("HTTP-Referer", _padrao.Referer);
            request.Headers.Add("X-Title", "Anotacoes - Moldes");
            request.Content = new StringContent(corpo, Encoding.UTF8, "application/json");

            var http = _httpClientFactory.CreateClient(nameof(AnalisadorDeEmbalagem));
            using var resposta = await http.SendAsync(request, cts.Token);
            var texto = await resposta.Content.ReadAsStringAsync(cts.Token);
            if (!resposta.IsSuccessStatusCode)
            {
                _logger.LogError("OpenRouter respondeu {Status} ao analisar embalagem: {Corpo}",
                    resposta.StatusCode, texto.Length > 400 ? texto[..400] : texto);
                return Falha(resposta.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.PaymentRequired
                    ? "A OpenRouter recusou a chave de API (verifique a chave e o saldo)."
                    : $"O serviço de IA não respondeu ({(int)resposta.StatusCode}).");
            }

            return Interpretar(texto, catalogo) ?? Falha("A IA respondeu num formato inesperado.");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Falha ao analisar embalagem com a IA.");
            return Falha("Não foi possível falar com o serviço de IA.");
        }
    }

    private static string Curto(string? s) =>
        string.IsNullOrWhiteSpace(s) ? "" : (s.Length > MaxTexto ? s[..MaxTexto] : s).Replace('\n', ' ').Trim();

    private static string Num(double v) => v.ToString("0.###", CultureInfo.InvariantCulture);

    public static string Prompt(IReadOnlyList<TipoMoldeDto> tipos, MedidaConhecidaDto? medida)
    {
        var sb = new StringBuilder();
        sb.AppendLine("Você ajuda uma papelaria personalizada a recriar embalagens de papel a partir de uma foto.");
        sb.AppendLine("Olhe a embalagem da foto e diga qual destes moldes ela é, estimando os valores dos campos dele.");
        sb.AppendLine();
        sb.AppendLine("Moldes disponíveis:");
        foreach (var t in tipos)
        {
            sb.AppendLine($"- id \"{Curto(t.Id)}\": {Curto(t.Nome)} — {Curto(t.Descricao)}");
            foreach (var c in (t.Campos ?? new List<CampoMoldeDto>()).Where(c => !string.IsNullOrWhiteSpace(c.Chave)).Take(MaxCamposPorTipo))
            {
                var linha = $"    - \"{Curto(c.Chave)}\": {Curto(c.Rotulo)}";
                if (c.Opcoes is { Count: > 0 })
                {
                    linha += $" (uma destas: {string.Join(", ", c.Opcoes.Take(12).Select(o => $"\"{Curto(o)}\""))})";
                }
                else if (Curto(c.Unidade) == "sim-nao")
                {
                    linha += " (true ou false)";
                }
                else
                {
                    linha += $" (número em {Curto(c.Unidade)}";
                    if (c.Min is { } min && c.Max is { } max) linha += $", de {Num(min)} a {Num(max)}";
                    linha += ")";
                }
                sb.AppendLine(linha);
            }
        }
        sb.AppendLine();
        if (medida is not null && !string.IsNullOrWhiteSpace(medida.Chave) && medida.Valor > 0)
        {
            sb.AppendLine($"Medida conhecida (real, use como escala para as outras): \"{Curto(medida.Chave)}\" = {Num(medida.Valor)}.");
        }
        else
        {
            sb.AppendLine("Nenhuma medida real foi informada: estime pelo tamanho típico desse tipo de embalagem e por objetos de referência na foto (mão, mesa, doces), mantendo as proporções que você vê.");
        }
        sb.AppendLine();
        sb.AppendLine("Regras:");
        sb.AppendLine("- use só os ids e as chaves listados; preencha apenas os campos que dá pra estimar pela foto;");
        sb.AppendLine("- números em ponto decimal, na unidade do campo; opções exatamente como listadas;");
        sb.AppendLine("- se a embalagem não for nenhum dos moldes, use \"tipo\": \"nenhum\" e explique.");
        sb.AppendLine();
        sb.AppendLine("Responda só com JSON: {\"tipo\": \"<id ou nenhum>\", \"confianca\": \"alta|media|baixa\", \"valores\": {\"<chave>\": <valor>}, \"explicacao\": \"<uma frase em português>\"}");
        return sb.ToString();
    }

    /// <summary>Lê a resposta do provedor e confere contra o catálogo.</summary>
    public static AnalisarEmbalagemResponse? Interpretar(string corpo, IReadOnlyList<TipoMoldeDto> tipos)
    {
        try
        {
            using var doc = JsonDocument.Parse(corpo);
            if (doc.RootElement.TryGetProperty("error", out _)) return null;
            var conteudo = doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString() ?? "";
            var limpo = conteudo.Trim();
            if (limpo.StartsWith("```"))
            {
                var inicio = limpo.IndexOf('\n');
                var fim = limpo.LastIndexOf("```", StringComparison.Ordinal);
                if (inicio > 0 && fim > inicio) limpo = limpo[(inicio + 1)..fim].Trim();
            }

            using var resposta = JsonDocument.Parse(limpo);
            var raiz = resposta.RootElement;
            var tipoId = raiz.TryGetProperty("tipo", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null;
            var explicacao = raiz.TryGetProperty("explicacao", out var e) && e.ValueKind == JsonValueKind.String ? Curto(e.GetString()) : null;
            var confianca = raiz.TryGetProperty("confianca", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : null;
            if (confianca is not ("alta" or "media" or "baixa")) confianca = "baixa";

            var tipo = tipos.FirstOrDefault(x => x.Id == tipoId);
            if (tipo is null)
            {
                return new AnalisarEmbalagemResponse(true, explicacao ?? "A embalagem da foto não parece com nenhum dos moldes do gerador.",
                    null, confianca, null, explicacao);
            }

            var valores = new Dictionary<string, object>();
            if (raiz.TryGetProperty("valores", out var v) && v.ValueKind == JsonValueKind.Object)
            {
                foreach (var campo in (tipo.Campos ?? new List<CampoMoldeDto>()).Where(x => !string.IsNullOrWhiteSpace(x.Chave)))
                {
                    if (!v.TryGetProperty(campo.Chave!, out var bruto)) continue;
                    var valor = Conferir(campo, bruto);
                    if (valor is not null) valores[campo.Chave!] = valor;
                }
            }
            return new AnalisarEmbalagemResponse(true, null, tipo.Id, confianca, valores, explicacao);
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static object? Conferir(CampoMoldeDto campo, JsonElement bruto)
    {
        if (campo.Opcoes is { Count: > 0 })
        {
            var s = bruto.ValueKind == JsonValueKind.String ? bruto.GetString() : bruto.ToString();
            return s is not null && campo.Opcoes.Contains(s) ? s : null;
        }
        if (campo.Unidade == "sim-nao")
        {
            return bruto.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                JsonValueKind.String when bruto.GetString() is "sim" or "true" => true,
                JsonValueKind.String when bruto.GetString() is "nao" or "não" or "false" => false,
                _ => null,
            };
        }
        double n;
        if (bruto.ValueKind == JsonValueKind.Number) n = bruto.GetDouble();
        else if (bruto.ValueKind == JsonValueKind.String &&
                 double.TryParse(bruto.GetString()?.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var p)) n = p;
        else return null;
        if (double.IsNaN(n) || double.IsInfinity(n)) return null;
        if (campo.Min is { } min) n = Math.Max(min, n);
        if (campo.Max is { } max) n = Math.Min(max, n);
        return Math.Round(n, 2);
    }
}
