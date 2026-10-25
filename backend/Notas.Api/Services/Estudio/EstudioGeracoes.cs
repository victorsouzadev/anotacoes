using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Notas.Api.Data;
using Notas.Api.Services.Seguranca;

namespace Notas.Api.Services.Estudio;

/// <summary>Pedido de geração vindo da tela ou do MCP.</summary>
public sealed record PedidoGeracao(
    string Modelo,
    string Operacao,
    JsonObject? Parametros = null,
    Dictionary<string, List<string>>? Entradas = null,
    string? App = null,
    string? Pipeline = null);

public sealed record ChavesEstudio(string? Fal, string? WorldLabs, bool FalDoServidor, bool WorldLabsDoServidor);

public sealed record UsoEstudio(double GastoMesCentavos, int? LimiteMensalCentavos, int ConfirmarAcimaCentavos, int GeracoesNoMes);

/// <summary>Cria as gerações (fila), aplicando catálogo, chaves e teto de gasto.</summary>
public sealed class EstudioGeracoes(AppDbContext db, Catalogo catalogo, IProtetorDeSegredos protetor, IOptions<EstudioOptions> options)
{
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Operações feitas aqui mesmo com o ffmpeg, sem provedor.</summary>
    public static readonly string[] OperacoesLocais = ["montar", "quadros"];

    public async Task<ChavesEstudio> Chaves(string userId, CancellationToken ct)
    {
        var c = await db.EstudioConfigs.AsNoTracking().FirstOrDefaultAsync(x => x.UserId == userId, ct);
        var fal = c?.ChaveFalCifrada is { } f ? protetor.Desproteger(f) : null;
        var wl = c?.ChaveWorldLabsCifrada is { } w ? protetor.Desproteger(w) : null;
        var falServidor = string.IsNullOrWhiteSpace(fal) && !string.IsNullOrWhiteSpace(options.Value.FalKey);
        var wlServidor = string.IsNullOrWhiteSpace(wl) && !string.IsNullOrWhiteSpace(options.Value.WorldLabsKey);
        return new ChavesEstudio(
            string.IsNullOrWhiteSpace(fal) ? NuloSeVazio(options.Value.FalKey) : fal,
            string.IsNullOrWhiteSpace(wl) ? NuloSeVazio(options.Value.WorldLabsKey) : wl,
            falServidor, wlServidor);
    }

    public async Task<UsoEstudio> Uso(string userId, CancellationToken ct)
    {
        var inicio = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var jobs = await db.EstudioJobs.AsNoTracking()
            .Where(j => j.UserId == userId && j.CriadoEm >= inicio && j.Status != "falhou" && j.Provedor != "local")
            .Select(j => new { j.CustoEstimadoCentavos, j.Status, j.RequestId })
            .ToListAsync(ct);
        // Cancelado antes de chegar ao provedor não custou nada.
        var validos = jobs.Where(j => j.Status != "cancelado" || j.RequestId != null).ToList();
        var c = await db.EstudioConfigs.AsNoTracking().FirstOrDefaultAsync(x => x.UserId == userId, ct);
        return new UsoEstudio(Math.Round(validos.Sum(j => j.CustoEstimadoCentavos), 2), c?.LimiteMensalCentavos, c?.ConfirmarAcimaCentavos ?? 100, validos.Count);
    }

    /// <summary>Custo estimado (centavos) sem criar nada.</summary>
    public async Task<double> Estimar(string userId, PedidoGeracao pedido, CancellationToken ct)
    {
        var (_, op) = catalogo.Resolver(pedido.Modelo, pedido.Operacao);
        var midias = await CarregarEntradas(userId, pedido.Entradas, ct);
        return Catalogo.EstimarCusto(op, pedido.Parametros ?? [], DuracaoDaEntrada(midias));
    }

    public async Task<EstudioJob> Criar(string userId, PedidoGeracao pedido, CancellationToken ct)
    {
        var (modelo, op) = catalogo.Resolver(pedido.Modelo, pedido.Operacao);
        var parametros = pedido.Parametros ?? [];
        var midias = await CarregarEntradas(userId, pedido.Entradas, ct);

        // Valida já com endereços fictícios: parâmetro errado aparece na hora, não minutos depois na fila.
        var marcadores = midias.ToDictionary(kv => kv.Key, kv => kv.Value.Select(m => $"https://exemplo/{m.Id}").ToList());
        Catalogo.MontarEntrada(op, parametros, marcadores);

        if (pedido.Pipeline == "trocar-fundo" && (!midias.TryGetValue("fundo", out var fundo) || fundo.Count == 0))
            throw new ErroDoEstudio("Escolha a imagem do novo fundo.");

        var chaves = await Chaves(userId, ct);
        if (modelo.Provedor == "worldlabs" && chaves.WorldLabs is null)
            throw new ErroDoEstudio("Cadastre a chave da World Labs em Estúdio › Configurações para gerar mundos Marble.");
        if (modelo.Provedor == "fal" && chaves.Fal is null)
            throw new ErroDoEstudio("Cadastre a chave do fal.ai em Estúdio › Configurações (fal.ai/dashboard/keys).");

        var custo = Catalogo.EstimarCusto(op, parametros, DuracaoDaEntrada(midias));
        await ConferirTeto(userId, custo, ct);

        var job = new EstudioJob
        {
            Id = Guid.NewGuid().ToString("N"),
            UserId = userId,
            App = Limitar(pedido.App ?? modelo.Tipo, 40),
            ModeloId = modelo.Id,
            Operacao = pedido.Operacao,
            Provedor = modelo.Provedor,
            Endpoint = op.Endpoint,
            Parametros = parametros.ToJsonString(),
            Entradas = JsonSerializer.Serialize(midias.ToDictionary(kv => kv.Key, kv => kv.Value.Select(m => m.Id).ToList()), Json),
            Pipeline = pedido.Pipeline,
            CustoEstimadoCentavos = custo,
            Mensagem = "Na fila",
        };
        db.EstudioJobs.Add(job);
        await db.SaveChangesAsync(ct);
        return job;
    }

    /// <summary>Montagem de vídeo ou extração de quadros, feitas com o ffmpeg do próprio servidor.</summary>
    public async Task<EstudioJob> CriarLocal(string userId, string app, string operacao, JsonObject parametros,
        Dictionary<string, List<string>> entradas, CancellationToken ct)
    {
        if (!OperacoesLocais.Contains(operacao)) throw new ErroDoEstudio($"Operação local desconhecida: {operacao}.");
        var midias = await CarregarEntradas(userId, entradas, ct);
        if (midias.Count == 0) throw new ErroDoEstudio("Escolha ao menos um arquivo.");
        var job = new EstudioJob
        {
            Id = Guid.NewGuid().ToString("N"),
            UserId = userId,
            App = Limitar(app, 40),
            ModeloId = "ffmpeg",
            Operacao = operacao,
            Provedor = "local",
            Endpoint = "ffmpeg",
            Parametros = parametros.ToJsonString(),
            Entradas = JsonSerializer.Serialize(midias.ToDictionary(kv => kv.Key, kv => kv.Value.Select(m => m.Id).ToList()), Json),
            Mensagem = "Na fila",
        };
        db.EstudioJobs.Add(job);
        await db.SaveChangesAsync(ct);
        return job;
    }

    private async Task ConferirTeto(string userId, double custo, CancellationToken ct)
    {
        var uso = await Uso(userId, ct);
        if (uso.LimiteMensalCentavos is { } limite && uso.GastoMesCentavos + custo > limite)
            throw new ErroDoEstudio(
                $"Esta geração (~US$ {custo / 100:0.00}) passaria do teto mensal de US$ {limite / 100.0:0.00} " +
                $"(já foram ~US$ {uso.GastoMesCentavos / 100:0.00}). Aumente o teto em Estúdio › Configurações.");
    }

    /// <summary>Ids → mídias do usuário, na ordem pedida. Id de outro usuário ou apagado é erro, não silêncio.</summary>
    public async Task<Dictionary<string, List<EstudioMidia>>> CarregarEntradas(string userId, Dictionary<string, List<string>>? entradas, CancellationToken ct)
    {
        var resultado = new Dictionary<string, List<EstudioMidia>>();
        if (entradas is null || entradas.Count == 0) return resultado;
        var ids = entradas.Values.SelectMany(v => v).Where(v => !string.IsNullOrWhiteSpace(v)).Distinct().ToList();
        if (ids.Count > 40) throw new ErroDoEstudio("Arquivos demais num pedido só (máximo 40).");
        var achadas = await db.EstudioMidias.Where(m => m.UserId == userId && m.DeletedAt == null && ids.Contains(m.Id)).ToDictionaryAsync(m => m.Id, ct);
        foreach (var (chave, lista) in entradas)
        {
            var itens = new List<EstudioMidia>();
            foreach (var id in lista.Where(v => !string.IsNullOrWhiteSpace(v)))
                itens.Add(achadas.GetValueOrDefault(id) ?? throw new ErroDoEstudio($"Arquivo não encontrado: {id}."));
            if (itens.Count > 0) resultado[chave] = itens;
        }
        return resultado;
    }

    private static double? DuracaoDaEntrada(Dictionary<string, List<EstudioMidia>> midias) =>
        midias.TryGetValue("video", out var v) && v.Count > 0 ? v[0].DuracaoSeg : null;

    private static string? NuloSeVazio(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    private static string Limitar(string s, int max) => s.Length > max ? s[..max] : s;
}
