using System.ComponentModel;
using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using ModelContextProtocol.Server;
using Notas.Api.Services.Financas;
using Notas.Api.Services.Financas.Chat;

namespace Notas.Api.Mcp;

/// <summary>
/// MCP da ferramenta Finanças (/api/mcp/financas). Só leitura. Usa as mesmas consultas do chat
/// financeiro (FerramentasFinanceiras), então os números batem com a tela.
/// </summary>
[McpServerToolType]
public sealed class FinancasMcpTools(FerramentasFinanceiras ferramentas, FinancasClock clock, McpUser user)
{
    private Task<string> Rodar(string nome, JsonObject args, CancellationToken ct) => ferramentas.ExecutarAsync(user.Id, nome, args, ct);

    private (int Ano, int Mes) MesOuAtual(int? ano, int? mes) => clock.ResolverMes(ano, mes);

    [McpServerTool(Name = "financas_resumo", ReadOnly = true, OpenWorld = false)]
    [Description("Resumo financeiro em Markdown para o Segundo Cérebro: mês atual e anterior (receitas, despesas, saldo, " +
                 "maiores categorias), saúde financeira e metas. É o que a rotina de sincronização guarda.")]
    public async Task<string> Resumo(CancellationToken ct = default)
    {
        var hoje = clock.Hoje();
        var anterior = hoje.AddMonths(-1);
        var sb = new StringBuilder();
        sb.Append("## Mês atual (").Append(hoje.ToString("MM/yyyy", CultureInfo.InvariantCulture)).Append(")\n")
          .Append(MesEmMarkdown(await Rodar("resumo_mes", new() { ["ano"] = hoje.Year, ["mes"] = hoje.Month }, ct)));
        sb.Append("\n## Mês anterior (").Append(anterior.ToString("MM/yyyy", CultureInfo.InvariantCulture)).Append(")\n")
          .Append(MesEmMarkdown(await Rodar("resumo_mes", new() { ["ano"] = anterior.Year, ["mes"] = anterior.Month }, ct)));
        sb.Append("\n## Saúde financeira do mês\n```json\n")
          .Append(await Rodar("saude_financeira", new() { ["ano"] = hoje.Year, ["mes"] = hoje.Month }, ct)).Append("\n```\n");
        sb.Append("\n## Metas\n```json\n").Append(await Rodar("metas", [], ct)).Append("\n```\n");
        return sb.ToString().TrimEnd();
    }

    private static readonly CultureInfo Br = CultureInfo.GetCultureInfo("pt-BR");

    /// <summary>O JSON do resumo_mes em Markdown legível no Obsidian (cai para o JSON se o formato mudar).</summary>
    internal static string MesEmMarkdown(string json)
    {
        try
        {
            var o = JsonNode.Parse(json)!.AsObject();
            if (o["erro"] is { } erro) return $"Erro: {erro}\n";
            string V(string k) => (o[k]?.GetValue<decimal>() ?? 0).ToString("C", Br);
            var sb = new StringBuilder()
                .Append($"- Receitas: {V("receitas")}\n- Despesas: {V("despesas")} (consumo {V("consumo")})\n- Saldo: **{V("saldo")}**\n")
                .Append($"- Lançamentos: {o["lancamentos"]}");
            if (o["semCategoriaConfirmada"]?.GetValue<int>() is > 0 and var sem) sb.Append($" ({sem} sem categoria confirmada)");
            sb.Append('\n');
            if (o["despesasPorCategoria"] is JsonArray cats && cats.Count > 0)
            {
                sb.Append("\n| Categoria | Total | Lançamentos |\n|---|---:|---:|\n");
                foreach (var c in cats)
                    sb.Append($"| {c!["categoria"]} | {c["total"]!.GetValue<decimal>().ToString("C", Br)} | {c["quantidade"]} |\n");
            }
            return sb.ToString();
        }
        catch (Exception e) when (e is InvalidOperationException or FormatException or System.Text.Json.JsonException or NullReferenceException)
        {
            return $"```json\n{json}\n```\n";
        }
    }

    [McpServerTool(Name = "financas_resumo_mes", ReadOnly = true, OpenWorld = false)]
    [Description("Receitas, despesas, consumo, saldo e despesas por categoria de um mês (por competência). JSON.")]
    public Task<string> ResumoMes(
        [Description("Ano, ex.: 2026. Padrão: atual.")] int? ano = null,
        [Description("Mês de 1 a 12. Padrão: atual.")] int? mes = null,
        CancellationToken ct = default)
    {
        var (a, m) = MesOuAtual(ano, mes);
        return Rodar("resumo_mes", new() { ["ano"] = a, ["mes"] = m }, ct);
    }

    [McpServerTool(Name = "financas_buscar_transacoes", ReadOnly = true, OpenWorld = false)]
    [Description("Lista lançamentos com filtros e devolve itens, quantidade e soma. JSON.")]
    public Task<string> Buscar(
        [Description("Trecho da descrição (ex.: 'ifood').")] string? texto = null,
        [Description("Categoria, ex.: Alimentacao, Transporte, Moradia, Saude, Lazer, Compras, ContasServicos.")] string? categoria = null,
        [Description("'despesa' ou 'receita'.")] string? tipo = null,
        [Description("Data inicial AAAA-MM-DD.")] string? de = null,
        [Description("Data final AAAA-MM-DD.")] string? ate = null,
        [Description("'data' (padrão) ou 'valor' (maiores primeiro).")] string? ordenar = null,
        [Description("Máximo de itens (até 200).")] int? limite = null,
        CancellationToken ct = default)
    {
        var args = new JsonObject();
        void Set(string k, JsonNode? v) { if (v is not null) args[k] = v; }
        Set("texto", texto); Set("categoria", categoria); Set("tipo", tipo); Set("de", de); Set("ate", ate);
        Set("ordenar", ordenar); Set("limite", limite);
        return Rodar("buscar_transacoes", args, ct);
    }

    [McpServerTool(Name = "financas_evolucao", ReadOnly = true, OpenWorld = false)]
    [Description("Receitas, despesas e consumo mês a mês dos últimos N meses (até 24), opcionalmente de uma categoria. JSON.")]
    public Task<string> Evolucao(
        [Description("Quantidade de meses (padrão 6).")] int meses = 6,
        [Description("Opcional: categoria.")] string? categoria = null,
        CancellationToken ct = default)
    {
        var args = new JsonObject { ["meses"] = meses };
        if (categoria is not null) args["categoria"] = categoria;
        return Rodar("evolucao_mensal", args, ct);
    }

    [McpServerTool(Name = "financas_saude", ReadOnly = true, OpenWorld = false)]
    [Description("Indicadores do mês: taxa de poupança, reserva de emergência, orçamento e independência financeira. JSON.")]
    public Task<string> Saude([Description("Ano.")] int? ano = null, [Description("Mês.")] int? mes = null, CancellationToken ct = default)
    {
        var (a, m) = MesOuAtual(ano, mes);
        return Rodar("saude_financeira", new() { ["ano"] = a, ["mes"] = m }, ct);
    }

    [McpServerTool(Name = "financas_metas", ReadOnly = true, OpenWorld = false)]
    [Description("Metas de reserva com valor alvo, acumulado e prazo. JSON.")]
    public Task<string> Metas(CancellationToken ct = default) => Rodar("metas", [], ct);

    [McpServerTool(Name = "financas_recorrentes", ReadOnly = true, OpenWorld = false)]
    [Description("Gastos que se repetem nos últimos 6 meses (assinaturas, contas). JSON.")]
    public Task<string> Recorrentes(CancellationToken ct = default) => Rodar("gastos_recorrentes", [], ct);

    [McpServerTool(Name = "financas_compromissos", ReadOnly = true, OpenWorld = false)]
    [Description("Parcelas já contratadas para os próximos 12 meses. JSON.")]
    public Task<string> Compromissos(CancellationToken ct = default) => Rodar("compromissos_futuros", [], ct);
}
