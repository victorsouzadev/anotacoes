using System.Security.Claims;
using Notas.Api.Data;
using Notas.Api.Dtos;
using Notas.Api.Services.Financas;

namespace Notas.Api.Endpoints;

// Orçamento mensal: o usuário informa um valor total e distribui esse valor entre
// as categorias de gasto. O acompanhamento cruza essa distribuição com os
// lançamentos já registrados no mês.
public static class OrcamentoEndpoints
{
    public static void MapOrcamentoEndpoints(this IEndpointRouteBuilder app)
    {
        var grupo = app.MapGroup("/api/financas/orcamentos").RequireAuthorization();

        // GET /api/financas/orcamentos — histórico de orçamentos do usuário.
        grupo.MapGet("/", async (ClaimsPrincipal user, OrcamentoService service, CancellationToken ct) =>
        {
            var orcamentos = await service.ListarAsync(user.UserId(), ct);
            return Results.Ok(orcamentos.Select(ToResponse));
        });

        // GET /api/financas/orcamentos/atual?ano=&mes= — orçamento de um mês (padrão: mês corrente).
        grupo.MapGet("/atual", async (ClaimsPrincipal user, OrcamentoService service, FinancasClock clock,
            CancellationToken ct, int? ano, int? mes) =>
        {
            var (anoRef, mesRef) = clock.ResolverMes(ano, mes);
            return await Executar(async () =>
            {
                var orcamento = await service.ObterAsync(user.UserId(), anoRef, mesRef, ct);
                // Mês sem orçamento não é erro: a interface precisa distinguir
                // "ainda não cadastrou" de "falhou".
                return orcamento is null ? Results.NoContent() : Results.Ok(ToResponse(orcamento));
            });
        });

        // GET /api/financas/orcamentos/acompanhamento?ano=&mes= — planejado x realizado.
        grupo.MapGet("/acompanhamento", async (ClaimsPrincipal user, OrcamentoService service, FinancasClock clock,
            CancellationToken ct, int? ano, int? mes) =>
        {
            var (anoRef, mesRef) = clock.ResolverMes(ano, mes);
            return await Executar(async () =>
                Results.Ok(await service.AcompanharAsync(user.UserId(), anoRef, mesRef, ct)));
        });

        // GET /api/financas/orcamentos/historico?meses=12 — evolução planejado x realizado.
        grupo.MapGet("/historico", async (ClaimsPrincipal user, OrcamentoService service,
            CancellationToken ct, int? meses) =>
            Results.Ok(await service.HistoricoAsync(user.UserId(), meses ?? 12, ct)));

        // GET /api/financas/orcamentos/modelos?valorTotal= — distribuições prontas, já em reais.
        grupo.MapGet("/modelos", (decimal? valorTotal) =>
        {
            var total = valorTotal is > 0 ? valorTotal.Value : 0m;
            return Results.Ok(ModelosOrcamento.Todos.Select(m => ModelosOrcamento.ToResponse(m, total)));
        });

        // GET /api/financas/orcamentos/categorias — categorias válidas na distribuição, com grupo e rótulo.
        grupo.MapGet("/categorias", () => Results.Ok(
            CategoriaInfo.Orcaveis.Select(c => new
            {
                categoria = c.ToString(),
                rotulo = CategoriaInfo.Rotulo(c),
                grupo = CategoriaInfo.Grupo(c).ToString(),
                grupoRotulo = OrcamentoService.RotuloGrupo(CategoriaInfo.Grupo(c).ToString()),
            })));

        // PUT /api/financas/orcamentos — cria ou substitui o orçamento do mês informado.
        grupo.MapPut("/", async (SalvarOrcamentoRequest req, ClaimsPrincipal user, OrcamentoService service,
            CancellationToken ct) => await Executar(async () =>
        {
            var orcamento = await service.SalvarAsync(user.UserId(), req, ct);
            return Results.Ok(ToResponse(orcamento));
        }));

        // POST /api/financas/orcamentos/copiar — replica a distribuição de outro mês.
        grupo.MapPost("/copiar", async (CopiarOrcamentoRequest req, ClaimsPrincipal user, OrcamentoService service,
            CancellationToken ct) => await Executar(async () =>
        {
            var orcamento = await service.CopiarAsync(user.UserId(), req, ct);
            return Results.Ok(ToResponse(orcamento));
        }));

        grupo.MapDelete("/{ano:int}/{mes:int}", async (int ano, int mes, ClaimsPrincipal user,
            OrcamentoService service, CancellationToken ct) => await Executar(async () =>
        {
            var removido = await service.RemoverAsync(user.UserId(), ano, mes, ct);
            return removido ? Results.NoContent() : Results.NotFound();
        }));
    }

    // Toda entrada inválida de orçamento vira 400 com a mensagem já pronta para
    // exibição — as mensagens do serviço são escritas para o usuário final.
    private static async Task<IResult> Executar(Func<Task<IResult>> acao)
    {
        try
        {
            return await acao();
        }
        catch (OrcamentoInvalidoException ex)
        {
            return Results.BadRequest(new { erro = ex.Message });
        }
    }

    private static OrcamentoResponse ToResponse(Orcamento orcamento)
    {
        var itens = orcamento.Itens.OrderByDescending(i => i.Percentual).ToList();
        var valores = OrcamentoService.Distribuir(orcamento.ValorTotal, itens.Select(i => i.Percentual).ToList());

        return new OrcamentoResponse(
            orcamento.Id, orcamento.Ano, orcamento.Mes, orcamento.ValorTotal, orcamento.Observacoes,
            itens.Select((i, idx) => new OrcamentoItemResponse(
                i.Categoria.ToString(),
                CategoriaInfo.Rotulo(i.Categoria),
                CategoriaInfo.Grupo(i.Categoria).ToString(),
                i.Percentual,
                valores[idx])).ToList(),
            orcamento.CriadoEm, orcamento.AtualizadoEm);
    }
}
