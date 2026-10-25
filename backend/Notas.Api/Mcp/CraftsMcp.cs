using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Notas.Api.Data;
using Notas.Api.Services.Estudio;

namespace Notas.Api.Mcp;

/// <summary>
/// MCP remoto dos craft apps do ArtCraft (/api/mcp/crafts/{app}). O token dos apps já foi conferido
/// pelo AppsMcpAuth; aqui o pedido vai para o serviço crafts-mcp (que roda a CLI do app sem janela)
/// e ganha três ferramentas do hub, que só a API pode fazer:
/// hub_trazer_midia (arquivo da biblioteca → pasta da sessão), hub_guardar_arquivo (pasta da sessão
/// → biblioteca) e hub_arquivos_da_sessao.
/// </summary>
public static partial class CraftsMcp
{
    public const string NomeHttp = "crafts-mcp";
    private static readonly string[] Apps =
        ["photocraft", "vectorcraft", "filmcraft", "lightcraft", "pdfcraft", "effectcraft", "designcraft", "figcraft", "wordcraft", "soundcraft", "deckcraft", "cadcraft", "gridcraft"];

    /// <summary>Como a CLI enxerga a pasta da sessão (montagem do container crafts-mcp).</summary>
    public const string RaizNaCli = "/trabalho";

    [GeneratedRegex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")]
    private static partial Regex Sessao();

    public static void MapCraftsMcp(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/mcp/crafts/{craft}", Post);
        app.MapDelete("/api/mcp/crafts/{craft}", Delete);
        app.MapGet("/api/mcp/crafts/{craft}", () => Results.StatusCode(StatusCodes.Status405MethodNotAllowed));
    }

    private static async Task<IResult> Post(string craft, HttpContext http, IHttpClientFactory fabrica, IOptions<EstudioOptions> opt,
        AppDbContext db, EstudioArmazenamento arm, EstudioMidias midias, CancellationToken ct)
    {
        if (!Apps.Contains(craft)) return Results.NotFound();
        if (string.IsNullOrWhiteSpace(opt.Value.CraftsMcpUrl))
            return Results.Problem("O MCP dos craft apps está desligado neste servidor (serviço crafts-mcp, profile \"crafts\").", statusCode: 503);

        var corpo = await new StreamReader(http.Request.Body).ReadToEndAsync(ct);
        JsonNode? msg;
        try { msg = JsonNode.Parse(corpo); }
        catch (JsonException) { return Results.BadRequest(); }
        var sessao = http.Request.Headers["Mcp-Session-Id"].FirstOrDefault();

        // Ferramenta do hub: resolvida aqui, sem passar pela CLI.
        if (msg is JsonObject o && (string?)o["method"] == "tools/call" && ((string?)o["params"]?["name"])?.StartsWith("hub_") == true)
        {
            if (sessao is null || !Sessao().IsMatch(sessao))
                return Results.Json(Erro(o["id"], "Comece a sessão (initialize) antes de usar as ferramentas do hub."));
            var uid = http.User.FindFirstValue("sub")!;
            var texto = await Hub((string)o["params"]!["name"]!, o["params"]?["arguments"] as JsonObject ?? [], uid, sessao, craft, db, arm, midias, ct);
            http.Response.Headers["Mcp-Session-Id"] = sessao;
            return Results.Json(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = o["id"]?.DeepClone(), ["result"] = Texto(texto) });
        }

        using var req = new HttpRequestMessage(HttpMethod.Post, $"{opt.Value.CraftsMcpUrl!.TrimEnd('/')}/{craft}")
        {
            Content = new StringContent(corpo, Encoding.UTF8, "application/json"),
        };
        if (sessao is not null) req.Headers.Add("Mcp-Session-Id", sessao);
        HttpResponseMessage res;
        try { res = await fabrica.CreateClient(NomeHttp).SendAsync(req, ct); }
        catch (HttpRequestException e) { return Results.Problem("O serviço crafts-mcp não respondeu: " + e.Message, statusCode: 502); }
        using (res)
        {
            if (res.Headers.TryGetValues("Mcp-Session-Id", out var s)) http.Response.Headers["Mcp-Session-Id"] = s.First();
            var resposta = await res.Content.ReadAsStringAsync(ct);
            if ((int)res.StatusCode == 202) return Results.StatusCode(202);
            // tools/list ganha as ferramentas do hub no fim da lista da CLI.
            if (msg is JsonObject m && (string?)m["method"] == "tools/list" && res.IsSuccessStatusCode && JsonNode.Parse(resposta) is JsonObject r &&
                r["result"]?["tools"] is JsonArray tools)
            {
                foreach (var t in FerramentasDoHub(craft)) tools.Add(t);
                resposta = r.ToJsonString();
            }
            return Results.Content(resposta, "application/json", Encoding.UTF8, (int)res.StatusCode);
        }
    }

    private static async Task<IResult> Delete(string craft, HttpContext http, IHttpClientFactory fabrica, IOptions<EstudioOptions> opt, CancellationToken ct)
    {
        var sessao = http.Request.Headers["Mcp-Session-Id"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(opt.Value.CraftsMcpUrl) || sessao is null || !Sessao().IsMatch(sessao)) return Results.NoContent();
        using var req = new HttpRequestMessage(HttpMethod.Delete, $"{opt.Value.CraftsMcpUrl!.TrimEnd('/')}/{craft}");
        req.Headers.Add("Mcp-Session-Id", sessao);
        try { (await fabrica.CreateClient(NomeHttp).SendAsync(req, ct)).Dispose(); } catch (HttpRequestException) { }
        return Results.NoContent();
    }

    /// <summary>Pasta da sessão do jeito que a API a enxerga (data/estudio/_mcp/&lt;sessão&gt;).</summary>
    public static string PastaDaSessao(EstudioArmazenamento arm, string sessao) => Path.Combine(arm.Raiz, "_mcp", sessao);

    private static async Task<string> Hub(string nome, JsonObject args, string uid, string sessao, string craft,
        AppDbContext db, EstudioArmazenamento arm, EstudioMidias midias, CancellationToken ct)
    {
        var pasta = PastaDaSessao(arm, sessao);
        Directory.CreateDirectory(pasta);
        switch (nome)
        {
            case "hub_trazer_midia":
            {
                var id = (string?)args["midia"];
                var m = await db.EstudioMidias.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid && x.DeletedAt == null, ct);
                if (m is null) return "Arquivo não encontrado na biblioteca.";
                var nomeArquivo = NomeSeguro(m.Nome);
                File.Copy(arm.Absoluto(m.Arquivo), Path.Combine(pasta, nomeArquivo), overwrite: true);
                return $"Pronto: {RaizNaCli}/{sessao}/{nomeArquivo}\nUse esse caminho nas ferramentas do {craft} (abrir, importar, colocar).";
            }
            case "hub_guardar_arquivo":
            {
                var caminho = (string?)args["caminho"] ?? "";
                var prefixo = $"{RaizNaCli}/{sessao}/";
                var relativo = caminho.StartsWith(prefixo, StringComparison.Ordinal) ? caminho[prefixo.Length..] : caminho.TrimStart('/');
                var local = Path.GetFullPath(Path.Combine(pasta, relativo));
                if (!local.StartsWith(Path.GetFullPath(pasta) + Path.DirectorySeparatorChar, StringComparison.Ordinal) || !File.Exists(local))
                    return $"Arquivo não encontrado na pasta da sessão ({prefixo}). Salve/exporte lá primeiro.";
                await using var f = File.OpenRead(local);
                var nomeFinal = string.IsNullOrWhiteSpace((string?)args["nome"]) ? Path.GetFileName(local) : (string)args["nome"]!;
                var pastaBib = (string?)args["pasta"];
                var m = await midias.Importar(uid, f, null, nomeFinal, "craft", x => x.Pasta = string.IsNullOrWhiteSpace(pastaBib) ? NomeDoApp(craft) : pastaBib, ct);
                return $"Na biblioteca: {m.Nome} (id {m.Id}). Abrir no hub: /estudio/apps/{craft}?abrir={m.Id}";
            }
            case "hub_arquivos_da_sessao":
            {
                var arquivos = Directory.EnumerateFiles(pasta, "*", SearchOption.AllDirectories)
                    .Select(a => $"- {RaizNaCli}/{sessao}/{Path.GetRelativePath(pasta, a).Replace('\\', '/')} ({new FileInfo(a).Length / 1024} KB)").ToList();
                return arquivos.Count == 0 ? $"A pasta da sessão ({RaizNaCli}/{sessao}/) está vazia." : string.Join('\n', arquivos);
            }
            default:
                return "Ferramenta do hub desconhecida.";
        }
    }

    private static List<JsonObject> FerramentasDoHub(string craft) =>
    [
        Ferramenta("hub_trazer_midia", $"Copia um arquivo da biblioteca do Estúdio do hub para a pasta desta sessão, para o {NomeDoApp(craft)} abrir. Devolve o caminho.",
            new JsonObject { ["midia"] = new JsonObject { ["type"] = "string", ["description"] = "Id do arquivo na biblioteca (ver estudio_midias no MCP do Estúdio)." } }, ["midia"]),
        Ferramenta("hub_guardar_arquivo", "Guarda na biblioteca do Estúdio um arquivo que o app salvou ou exportou na pasta desta sessão. Devolve o id e o link.",
            new JsonObject
            {
                ["caminho"] = new JsonObject { ["type"] = "string", ["description"] = $"Caminho do arquivo ({RaizNaCli}/<sessão>/…)." },
                ["nome"] = new JsonObject { ["type"] = "string", ["description"] = "Nome na biblioteca (opcional)." },
                ["pasta"] = new JsonObject { ["type"] = "string", ["description"] = "Pasta na biblioteca (opcional)." },
            }, ["caminho"]),
        Ferramenta("hub_arquivos_da_sessao", "Lista os arquivos da pasta desta sessão (o que foi trazido, salvo e exportado).", [], []),
    ];

    private static JsonObject Ferramenta(string nome, string descricao, JsonObject props, string[] obrigatorios) => new()
    {
        ["name"] = nome,
        ["description"] = descricao,
        ["inputSchema"] = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = props,
            ["required"] = new JsonArray(obrigatorios.Select(x => (JsonNode)JsonValue.Create(x)!).ToArray()),
        },
    };

    private static JsonObject Texto(string texto) => new()
    {
        ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = texto }),
    };

    private static JsonObject Erro(JsonNode? id, string mensagem) => new()
    {
        ["jsonrpc"] = "2.0", ["id"] = id?.DeepClone(), ["result"] = new JsonObject { ["isError"] = true, ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = mensagem }) },
    };

    private static string NomeDoApp(string craft) => craft switch
    {
        "cadcraft" => "CADCraft",
        "pdfcraft" => "PdfCraft",
        _ => char.ToUpperInvariant(craft[0]) + craft[1..^5] + "Craft",
    };

    private static string NomeSeguro(string nome)
    {
        var n = string.Concat(Path.GetFileName(nome).Select(c => char.IsLetterOrDigit(c) || c is '.' or '-' or '_' or ' ' ? c : '_')).Trim();
        return n.Length == 0 ? "arquivo" : n;
    }
}
