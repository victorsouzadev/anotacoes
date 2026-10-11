using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;

namespace Notas.Api.Services.Financas.Chat;

public record DefinicaoFerramenta(string Nome, string Descricao, JsonObject Parametros);

// As consultas que o chat pode fazer sobre os dados do usuário. Só leitura:
// o modelo pergunta, o backend responde com os números já calculados.
public class FerramentasFinanceiras(AppDbContext db, FinancasClock clock, PlanejamentoService planejamento,
    MetaService metas)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const int LimiteResultado = 30_000;

    private static readonly string CategoriasValidas = string.Join(", ", Enum.GetNames<Categoria>());

    public static readonly IReadOnlyList<DefinicaoFerramenta> Definicoes =
    [
        new("resumo_mes",
            "Resumo de um mês (por competência): receitas, despesas, consumo, saldo e despesas por categoria.",
            Schema(new() { ["ano"] = Inteiro("Ano, ex.: 2026"), ["mes"] = Inteiro("Mês de 1 a 12") }, "ano", "mes")),
        new("buscar_transacoes",
            "Lista lançamentos com filtros. Devolve os itens, a quantidade e a soma. Use para perguntas sobre "
            + "gastos específicos (uma loja, um período, uma categoria) e para achar os maiores gastos.",
            Schema(new()
            {
                ["texto"] = Texto("Trecho da descrição ou observação (ex.: 'ifood', 'uber')"),
                ["categoria"] = Texto($"Uma de: {CategoriasValidas}"),
                ["tipo"] = Texto("'despesa' ou 'receita'"),
                ["de"] = Texto("Data inicial AAAA-MM-DD (data da compra)"),
                ["ate"] = Texto("Data final AAAA-MM-DD (inclusive)"),
                ["conta"] = Texto("Nome da conta ou cartão"),
                ["tag"] = Texto("Tag"),
                ["ordenar"] = Texto("'data' (padrão, mais recentes primeiro) ou 'valor' (maiores primeiro)"),
                ["limite"] = Inteiro("Máximo de itens, até 200 (padrão 50). A soma considera todos."),
                ["incluir_fora_dos_totais"] = new JsonObject { ["type"] = "boolean",
                    ["description"] = "Incluir pagamentos de fatura e transferências (padrão false)" },
            })),
        new("evolucao_mensal",
            "Receitas, despesas e consumo mês a mês dos últimos N meses (até 24), opcionalmente de uma categoria.",
            Schema(new() { ["meses"] = Inteiro("Quantidade de meses, padrão 6"),
                ["categoria"] = Texto($"Opcional. Uma de: {CategoriasValidas}") })),
        new("saude_financeira",
            "Indicadores do mês: taxa de poupança, reserva de emergência (meses cobertos), pague-se primeiro, "
            + "orçamento base zero e independência financeira (regra dos 4%).",
            Schema(new() { ["ano"] = Inteiro("Ano"), ["mes"] = Inteiro("Mês de 1 a 12") }, "ano", "mes")),
        new("metas", "Metas de reserva com valor alvo, acumulado e prazo.", Schema(new())),
        new("dividas", "Dívidas cadastradas: saldo, juros ao mês e parcela mínima.", Schema(new())),
        new("gastos_recorrentes",
            "Gastos que se repetem nos últimos 6 meses (assinaturas, contas, mensalidades).", Schema(new())),
        new("compromissos_futuros",
            "Parcelas já contratadas para os próximos 12 meses e compras parceladas em curso.", Schema(new())),
    ];

    public async Task<string> ExecutarAsync(string userId, string nome, JsonObject? args, CancellationToken ct)
    {
        args ??= [];
        try
        {
            object resultado = nome switch
            {
                "resumo_mes" => await ResumoMesAsync(userId, args, ct),
                "buscar_transacoes" => await BuscarAsync(userId, args, ct),
                "evolucao_mensal" => await EvolucaoAsync(userId, args, ct),
                "saude_financeira" => await planejamento.SaudeAsync(userId, Ano(args), Mes(args), ct),
                "metas" => await metas.ListarAsync(userId, false, ct),
                "dividas" => await db.Dividas.AsNoTracking().Where(d => d.UserId == userId)
                    .Select(d => new { d.Nome, d.Saldo, d.JurosMensal, d.ParcelaMinima }).ToListAsync(ct),
                "gastos_recorrentes" => await RecorrentesAsync(userId, ct),
                "compromissos_futuros" => await CompromissosAsync(userId, ct),
                _ => new { erro = $"Ferramenta desconhecida: {nome}" },
            };
            var json = JsonSerializer.Serialize(resultado, Json);
            return json.Length > LimiteResultado
                ? json[..LimiteResultado] + "… [resultado cortado; refine os filtros]"
                : json;
        }
        catch (ArgumentException e)
        {
            return JsonSerializer.Serialize(new { erro = e.Message }, Json);
        }
    }

    // ------------------------------------------------------------- consultas

    private async Task<object> ResumoMesAsync(string userId, JsonObject args, CancellationToken ct)
    {
        var competencia = new DateOnly(Ano(args), Mes(args), 1);
        var doMes = await db.Transacoes.AsNoTracking()
            .Where(t => t.UserId == userId && !t.ForaDosTotais && t.Competencia == competencia)
            .ToListAsync(ct);
        var receitas = doMes.Where(t => t.Tipo == TipoTransacao.Receita).Sum(t => t.Valor);
        var despesas = doMes.Where(t => t.Tipo == TipoTransacao.Despesa).ToList();
        return new
        {
            competencia = competencia.ToString("yyyy-MM", CultureInfo.InvariantCulture),
            receitas,
            despesas = despesas.Sum(t => t.Valor),
            consumo = despesas.Where(PlanejamentoService.EhConsumo).Sum(t => t.Valor),
            saldo = receitas - despesas.Sum(t => t.Valor),
            lancamentos = doMes.Count,
            semCategoriaConfirmada = doMes.Count(t => !t.CategoriaConfirmada),
            despesasPorCategoria = despesas.GroupBy(t => t.Categoria)
                .Select(g => new { categoria = CategoriaInfo.Rotulo(g.Key), total = g.Sum(t => t.Valor), quantidade = g.Count() })
                .OrderByDescending(x => x.total).ToList(),
        };
    }

    private async Task<object> BuscarAsync(string userId, JsonObject args, CancellationToken ct)
    {
        var q = db.Transacoes.AsNoTracking().Where(t => t.UserId == userId);
        if (Bool(args, "incluir_fora_dos_totais") != true) q = q.Where(t => !t.ForaDosTotais);

        if (Str(args, "categoria") is { } cat)
        {
            if (!Enum.TryParse<Categoria>(cat, true, out var c))
                throw new ArgumentException($"Categoria inválida: {cat}. Use uma de: {CategoriasValidas}");
            q = q.Where(t => t.Categoria == c);
        }
        if (Str(args, "tipo") is { } tipo)
        {
            var t0 = tipo.StartsWith("rec", StringComparison.OrdinalIgnoreCase) ? TipoTransacao.Receita : TipoTransacao.Despesa;
            q = q.Where(t => t.Tipo == t0);
        }
        if (Data(args, "de") is { } de) q = q.Where(t => t.Data >= de);
        if (Data(args, "ate") is { } ate) q = q.Where(t => t.Data <= ate);
        if (Str(args, "conta") is { } conta) q = q.Where(t => t.Conta != null && EF.Functions.Like(t.Conta, $"%{conta}%"));
        if (Str(args, "tag") is { } tag) q = q.Where(t => t.Tags != null && EF.Functions.Like(t.Tags, $"%{tag}%"));

        var lista = await q.ToListAsync(ct);
        // Filtro de texto em memória: sem acento e sem caixa, como na busca da tela.
        if (Str(args, "texto") is { } texto)
        {
            var alvo = CulturaBr.SemAcentos(texto).ToUpperInvariant();
            lista = lista.Where(t => CulturaBr.SemAcentos($"{t.Descricao} {t.Observacoes}").ToUpperInvariant()
                .Contains(alvo, StringComparison.Ordinal)).ToList();
        }

        var ordenada = Str(args, "ordenar") == "valor"
            ? lista.OrderByDescending(t => t.Valor)
            : lista.OrderByDescending(t => t.Data);
        var limite = Math.Clamp(Int(args, "limite") ?? 50, 1, 200);

        return new
        {
            quantidade = lista.Count,
            somaDespesas = lista.Where(t => t.Tipo == TipoTransacao.Despesa).Sum(t => t.Valor),
            somaReceitas = lista.Where(t => t.Tipo == TipoTransacao.Receita).Sum(t => t.Valor),
            itens = ordenada.Take(limite).Select(t => new
            {
                data = t.Data,
                competencia = t.Competencia.ToString("yyyy-MM", CultureInfo.InvariantCulture),
                t.Descricao,
                t.Valor,
                tipo = t.Tipo == TipoTransacao.Receita ? "receita" : "despesa",
                categoria = CategoriaInfo.Rotulo(t.Categoria),
                t.Conta,
                parcela = t.Parcela is null ? null : $"{t.Parcela}/{t.TotalParcelas}",
                tags = t.Tags,
                foraDosTotais = t.ForaDosTotais ? true : (bool?)null,
            }).ToList(),
            mostrando = Math.Min(limite, lista.Count),
        };
    }

    private async Task<object> EvolucaoAsync(string userId, JsonObject args, CancellationToken ct)
    {
        var meses = Math.Clamp(Int(args, "meses") ?? 6, 1, 24);
        var atual = Transacao.CompetenciaDe(clock.Hoje());
        var inicio = atual.AddMonths(-(meses - 1));
        var q = db.Transacoes.AsNoTracking()
            .Where(t => t.UserId == userId && !t.ForaDosTotais && t.Competencia >= inicio && t.Competencia <= atual);
        if (Str(args, "categoria") is { } cat)
        {
            if (!Enum.TryParse<Categoria>(cat, true, out var c))
                throw new ArgumentException($"Categoria inválida: {cat}. Use uma de: {CategoriasValidas}");
            q = q.Where(t => t.Categoria == c);
        }
        var lista = await q.ToListAsync(ct);
        return Enumerable.Range(0, meses).Select(i => inicio.AddMonths(i)).Select(m =>
        {
            var doMes = lista.Where(t => t.Competencia == m).ToList();
            var despesas = doMes.Where(t => t.Tipo == TipoTransacao.Despesa).ToList();
            return new
            {
                competencia = m.ToString("yyyy-MM", CultureInfo.InvariantCulture),
                receitas = doMes.Where(t => t.Tipo == TipoTransacao.Receita).Sum(t => t.Valor),
                despesas = despesas.Sum(t => t.Valor),
                consumo = despesas.Where(PlanejamentoService.EhConsumo).Sum(t => t.Valor),
                mesEmAndamento = m == atual,
            };
        }).ToList();
    }

    private async Task<object> RecorrentesAsync(string userId, CancellationToken ct)
    {
        var atual = Transacao.CompetenciaDe(clock.Hoje());
        var inicio = atual.AddMonths(-5);
        var despesas = await db.Transacoes.AsNoTracking()
            .Where(t => t.UserId == userId && t.Tipo == TipoTransacao.Despesa && !t.ForaDosTotais
                        && t.Parcela == null && t.Competencia >= inicio && t.Competencia <= atual)
            .ToListAsync(ct);
        return Recorrencias.Detectar(despesas).Select(r => new
        {
            r.Ultimo.Descricao, categoria = CategoriaInfo.Rotulo(r.Ultimo.Categoria), r.ValorMedio,
            ultimoValor = r.Ultimo.Valor, ultimaData = r.Ultimo.Data, r.Meses, r.DiaHabitual, r.Ultimo.Conta,
        }).ToList();
    }

    private async Task<object> CompromissosAsync(string userId, CancellationToken ct)
    {
        var atual = Transacao.CompetenciaDe(clock.Hoje());
        var futuras = await db.Transacoes.AsNoTracking()
            .Where(t => t.UserId == userId && t.Tipo == TipoTransacao.Despesa && !t.ForaDosTotais
                        && t.Competencia > atual && t.Competencia <= atual.AddMonths(12))
            .ToListAsync(ct);
        return new
        {
            porMes = futuras.GroupBy(t => t.Competencia).OrderBy(g => g.Key).Select(g => new
            {
                competencia = g.Key.ToString("yyyy-MM", CultureInfo.InvariantCulture),
                total = g.Sum(t => t.Valor), quantidade = g.Count(),
            }).ToList(),
            parcelados = futuras.Where(t => t.Parcela != null)
                .GroupBy(t => (RegrasCategoria.ChaveDeDescricao(t.Descricao), t.TotalParcelas, t.Valor, t.Conta))
                .Select(g => new
                {
                    descricao = g.First().Descricao, valorParcela = g.Key.Valor, totalParcelas = g.Key.TotalParcelas,
                    parcelasRestantes = g.Count(), restante = g.Sum(t => t.Valor),
                    ultima = g.Max(t => t.Competencia).ToString("yyyy-MM", CultureInfo.InvariantCulture),
                })
                .OrderByDescending(x => x.restante).ToList(),
        };
    }

    // --------------------------------------------------------------- apoio

    private int Ano(JsonObject a) => Int(a, "ano") ?? clock.Hoje().Year;

    private int Mes(JsonObject a)
    {
        var mes = Int(a, "mes") ?? clock.Hoje().Month;
        return mes is < 1 or > 12 ? throw new ArgumentException($"Mês inválido: {mes}.") : mes;
    }

    private static string? Str(JsonObject a, string k) =>
        a[k] is JsonValue v && v.TryGetValue<string>(out var s) && !string.IsNullOrWhiteSpace(s) ? s.Trim() : null;

    private static int? Int(JsonObject a, string k) => a[k] switch
    {
        JsonValue v when v.TryGetValue<int>(out var i) => i,
        JsonValue v when v.TryGetValue<double>(out var d) => (int)d,
        JsonValue v when v.TryGetValue<string>(out var s) && int.TryParse(s, out var i2) => i2,
        _ => null,
    };

    private static bool? Bool(JsonObject a, string k) =>
        a[k] is JsonValue v && v.TryGetValue<bool>(out var b) ? b : null;

    private static DateOnly? Data(JsonObject a, string k)
    {
        if (Str(a, k) is not { } s) return null;
        return DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
            ? d : throw new ArgumentException($"Data inválida em '{k}': {s}. Use AAAA-MM-DD.");
    }

    private static JsonObject Texto(string d) => new() { ["type"] = "string", ["description"] = d };
    private static JsonObject Inteiro(string d) => new() { ["type"] = "integer", ["description"] = d };

    private static JsonObject Schema(JsonObject props, params string[] obrigatorios) => new()
    {
        ["type"] = "object",
        ["properties"] = props,
        ["required"] = new JsonArray(obrigatorios.Select(o => (JsonNode)o).ToArray()),
    };
}
