using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Dtos;
using Notas.Api.Services.Financas;
using Notas.Api.Services.Financas.Llm;
using Notas.Api.Services.Financas.Auvp;

namespace Notas.Api.Endpoints;

public static class FinancasEndpoints
{
    public static void MapFinancasEndpoints(this IEndpointRouteBuilder app)
    {
        // GET /api/financas/capacidades — sem chave de LLM não há leitura de
        // arquivo, e a interface precisa saber disso para não oferecer um botão
        // que só devolveria erro.
        app.MapGet("/api/financas/capacidades", async (ClaimsPrincipal user,
            TransacaoExtractionService extraction,
            Microsoft.Extensions.Options.IOptions<FinancasOptions> opcoes,
            CancellationToken ct) =>
        {
            var limites = opcoes.Value;
            var config = await extraction.ResolverConfiguracaoAsync(user.UserId(), ct);

            return Results.Ok(new CapacidadesResponse(
                config.Provedor,
                config.SuportaAnexos,
                limites.MaxArquivosPorImportacao,
                limites.MaxTamanhoArquivoMb,
                AnexoValidator.ExtensoesAceitas.ToArray()));
        }).RequireAuthorization();

        var transacoes = app.MapGroup("/api/financas/transacoes").RequireAuthorization();

        // POST /api/financas/transacoes — recebe texto livre, aciona o LLM, retorna a transação estruturada.
        //
        // É o único endpoint da app que gasta dinheiro por requisição, então tem
        // limite próprio por usuário: sem isso, um token vazado (ou um laço acidental
        // no cliente) queima a chave da Anthropic sem teto.
        transacoes.MapPost("/", async (CriarTransacaoRequest req, ClaimsPrincipal user, AppDbContext db,
            TransacaoExtractionService extractionService, Microsoft.Extensions.Options.IOptions<FinancasOptions> opcoes,
            CancellationToken ct) =>
        {
            var texto = req.Texto?.Trim() ?? "";
            if (texto.Length == 0)
                return Results.BadRequest(new { erro = "O campo 'texto' é obrigatório." });

            var maxTexto = opcoes.Value.MaxTamanhoTexto;
            if (texto.Length > maxTexto)
                return Results.BadRequest(new { erro = $"O texto do lançamento passa de {maxTexto} caracteres." });

            Transacao transacao;
            try
            {
                transacao = await extractionService.ExtrairTransacaoAsync(texto, user.UserId(), ct);
            }
            catch (ExtracaoInvalidaException ex)
            {
                return Results.UnprocessableEntity(new { erro = ex.Message });
            }
            catch (LlmIndisponivelException ex)
            {
                // Falha do provedor, não do texto do usuário: dizer 422 aqui faria a
                // interface acusar "não entendi seu lançamento" com a API fora do ar.
                return Results.Problem(title: "Serviço de interpretação indisponível", detail: ex.Message,
                    statusCode: StatusCodes.Status502BadGateway);
            }

            // Uma loja que o usuário já corrigiu antes entra direto na categoria dele.
            var regras = await RegrasCategoria.CarregarAsync(db, transacao.UserId, ct);
            if (regras.TryGetValue(RegrasCategoria.ChaveDeDescricao(transacao.Descricao), out var daRegra))
                transacao.Categoria = daRegra;

            db.Transacoes.Add(transacao);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/financas/transacoes/{transacao.Id}", TransacaoResponse.FromEntity(transacao));
        }).RequireRateLimiting("financas-ia");

        // POST /api/financas/transacoes/importar — foto de cupom, PDF de extrato,
        // CSV de fatura. Um cupom rende um lançamento; um extrato rende dezenas,
        // então este endpoint sempre devolve uma lista.
        //
        // Os lançamentos entram como "pendente de revisão" independentemente da
        // confiança do modelo: ler um documento é bem mais sujeito a erro que
        // interpretar uma frase digitada, e o usuário deve conferir antes de os
        // números entrarem no orçamento.
        transacoes.MapPost("/importar", async (HttpRequest request, ClaimsPrincipal user, AppDbContext db,
            TransacaoExtractionService extractionService, Microsoft.Extensions.Options.IOptions<FinancasOptions> opcoes,
            CancellationToken ct) =>
        {
            var limites = opcoes.Value;

            if (!request.HasFormContentType)
                return Results.BadRequest(new { erro = "Envie os arquivos como multipart/form-data." });

            var form = await request.ReadFormAsync(ct);
            var arquivos = form.Files;
            var texto = (form["texto"].ToString() ?? "").Trim();

            if (arquivos.Count == 0)
                return Results.BadRequest(new { erro = "Envie ao menos um arquivo." });

            if (arquivos.Count > limites.MaxArquivosPorImportacao)
                return Results.BadRequest(new { erro = $"Envie no máximo {limites.MaxArquivosPorImportacao} arquivos por vez." });

            if (texto.Length > limites.MaxTamanhoTexto)
                return Results.BadRequest(new { erro = $"A observação passa de {limites.MaxTamanhoTexto} caracteres." });

            var maxPorArquivo = (long)limites.MaxTamanhoArquivoMb * 1024 * 1024;
            if (arquivos.Sum(a => a.Length) > (long)limites.MaxTamanhoTotalMb * 1024 * 1024)
                return Results.BadRequest(new { erro = $"O total enviado passa de {limites.MaxTamanhoTotalMb} MB." });

            var anexos = new List<AnexoExtracao>(arquivos.Count);
            foreach (var arquivo in arquivos)
            {
                if (arquivo.Length == 0)
                    return Results.BadRequest(new { erro = $"O arquivo '{arquivo.FileName}' está vazio." });

                if (arquivo.Length > maxPorArquivo)
                    return Results.BadRequest(new { erro = $"'{arquivo.FileName}' passa de {limites.MaxTamanhoArquivoMb} MB." });

                if (!AnexoValidator.TryResolverTipo(arquivo.FileName, arquivo.ContentType, out var mime, out var erroTipo))
                    return Results.BadRequest(new { erro = erroTipo });

                using var memoria = new MemoryStream();
                await arquivo.CopyToAsync(memoria, ct);

                var anexo = new AnexoExtracao(Path.GetFileName(arquivo.FileName), mime, memoria.ToArray());
                if (!AnexoValidator.ConteudoEhTextoLegivel(anexo))
                    return Results.BadRequest(new { erro = $"Não consegui ler '{arquivo.FileName}' como texto (o arquivo precisa estar em UTF-8)." });

                anexos.Add(anexo);
            }

            ResultadoExtracao resultado;
            try
            {
                resultado = await extractionService.ExtrairAsync(new EntradaExtracao(texto, anexos), user.UserId(), ct);
            }
            catch (ExtracaoInvalidaException ex)
            {
                return Results.UnprocessableEntity(new { erro = ex.Message });
            }
            catch (LlmIndisponivelException ex)
            {
                return Results.Problem(title: "Serviço de interpretação indisponível", detail: ex.Message,
                    statusCode: StatusCodes.Status502BadGateway);
            }

            var atingiuLimite = resultado.Transacoes.Count > limites.MaxLancamentosPorImportacao;
            var aCriar = resultado.Transacoes.Take(limites.MaxLancamentosPorImportacao).ToList();

            var regrasImportacao = await RegrasCategoria.CarregarAsync(db, user.UserId(), ct);
            foreach (var transacao in aCriar)
            {
                transacao.Status = StatusTransacao.PendenteRevisao;
                if (regrasImportacao.TryGetValue(RegrasCategoria.ChaveDeDescricao(transacao.Descricao), out var daRegra))
                    transacao.Categoria = daRegra;
            }

            db.Transacoes.AddRange(aCriar);
            await db.SaveChangesAsync(ct);

            return Results.Ok(new ImportacaoResponse(
                aCriar.Count,
                aCriar.Select(TransacaoResponse.FromEntity).ToList(),
                resultado.Descartes.ToList(),
                atingiuLimite));
        }).RequireRateLimiting("financas-importacao")
          .DisableAntiforgery();

        // GET /api/financas/transacoes — lista transações com filtros de período, categoria e tipo.
        transacoes.MapGet("/", async (ClaimsPrincipal user, AppDbContext db, CancellationToken ct,
            DateOnly? dataInicio, DateOnly? dataFim, string? categoria, string? tipo,
            string? status, int? ano, int? mes, int? limite, string? q, string? tag, string? conta) =>
        {
            // Os filtros chegam como texto e são convertidos aqui: o binding de enum
            // da query string é sensível a maiúsculas, então `tipo=despesa` — o mesmo
            // formato que a API devolve nas respostas — seria recusado com 400.
            if (!TryParseFiltro<TipoTransacao>(tipo, out var tipoFiltro))
                return Results.BadRequest(new { erro = $"Tipo inválido: '{tipo}'." });
            if (!TryParseFiltro<StatusTransacao>(status, out var statusFiltro))
                return Results.BadRequest(new { erro = $"Situação inválida: '{status}'." });

            Categoria? categoriaFiltro = null;
            if (!string.IsNullOrWhiteSpace(categoria))
            {
                if (!CategoriaInfo.TryParse(categoria, out var c))
                    return Results.BadRequest(new { erro = $"Categoria inválida: '{categoria}'." });
                categoriaFiltro = c;
            }

            var userId = user.UserId();
            var query = db.Transacoes.AsNoTracking().Where(t => t.UserId == userId);

            // ano/mes é um atalho para o período do mês inteiro, usado pelo dashboard.
            if (ano.HasValue && mes.HasValue)
            {
                if (mes is < 1 or > 12) return Results.BadRequest(new { erro = $"Mês inválido: {mes}." });
                // Pelo mês de competência: a compra no cartão aparece no mês da fatura,
                // o mesmo em que soma no dashboard.
                var competencia = new DateOnly(ano.Value, mes.Value, 1);
                query = query.Where(t => t.Competencia == competencia);
            }

            if (dataInicio.HasValue) query = query.Where(t => t.Data >= dataInicio.Value);
            if (dataFim.HasValue) query = query.Where(t => t.Data <= dataFim.Value);
            if (categoriaFiltro.HasValue) query = query.Where(t => t.Categoria == categoriaFiltro.Value);
            if (tipoFiltro.HasValue) query = query.Where(t => t.Tipo == tipoFiltro.Value);
            if (statusFiltro.HasValue) query = query.Where(t => t.Status == statusFiltro.Value);

            // Busca por texto na descrição e nas observações (sem diferenciar caixa).
            if (!string.IsNullOrWhiteSpace(q))
            {
                var termo = $"%{q.Trim().Replace("%", "").Replace("_", "")}%";
                query = query.Where(t => EF.Functions.Like(t.Descricao, termo)
                                         || (t.Observacoes != null && EF.Functions.Like(t.Observacoes, termo)));
            }

            // Tags ficam numa coluna só, "A|B|C": compara com as bordas para "Pai"
            // não casar com "Papelaria".
            if (!string.IsNullOrWhiteSpace(tag))
            {
                var t0 = tag.Trim();
                query = tag.Trim() == "Sem tag"
                    ? query.Where(t => t.Tags == null)
                    : query.Where(t => t.Tags != null && ("|" + t.Tags + "|").Contains("|" + t0 + "|"));
            }

            if (!string.IsNullOrWhiteSpace(conta))
            {
                var c0 = conta.Trim();
                query = c0 == "Manual" ? query.Where(t => t.OrigemExterna == null) : query.Where(t => t.Conta == c0);
            }

            var resultado = await query
                .OrderByDescending(t => t.Data)
                .ThenByDescending(t => t.CriadoEm)
                .Take(Math.Clamp(limite ?? 500, 1, 2000))
                .ToListAsync(ct);

            return Results.Ok(resultado.Select(TransacaoResponse.FromEntity));
        });

        transacoes.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var transacao = await db.Transacoes.AsNoTracking()
                .FirstOrDefaultAsync(t => t.Id == id && t.UserId == user.UserId(), ct);
            return transacao is null ? Results.NotFound() : Results.Ok(TransacaoResponse.FromEntity(transacao));
        });

        // PATCH /api/financas/transacoes/{id} — usuário corrige campos extraídos incorretamente.
        transacoes.MapPatch("/{id:guid}", async (Guid id, AtualizarTransacaoRequest req, ClaimsPrincipal user,
            AppDbContext db, FinancasClock clock, AuvpEscrita auvp, CancellationToken ct) =>
        {
            var transacao = await db.Transacoes.FirstOrDefaultAsync(t => t.Id == id && t.UserId == user.UserId(), ct);
            if (transacao is null) return Results.NotFound();

            var antes = new { transacao.Descricao, transacao.Categoria, transacao.Observacoes, transacao.ForaDosTotais };

            if (req.Descricao is not null)
            {
                var descricao = req.Descricao.Trim();
                if (descricao.Length == 0) return Results.BadRequest(new { erro = "A descrição não pode ficar vazia." });
                if (descricao.Length > 500) return Results.BadRequest(new { erro = "A descrição passa de 500 caracteres." });
                transacao.Descricao = descricao;
            }

            // O POST rejeita valor <= 0; sem a mesma regra aqui, um PATCH conseguiria
            // gravar uma despesa negativa e quebrar as somas do dashboard.
            if (req.Valor is not null)
            {
                if (req.Valor <= 0) return Results.BadRequest(new { erro = "O valor deve ser maior que zero." });
                if (req.Valor > 99_999_999m) return Results.BadRequest(new { erro = "Valor acima do limite suportado." });
                transacao.Valor = Math.Round(req.Valor.Value, 2, MidpointRounding.AwayFromZero);
            }

            if (req.Tipo is not null)
            {
                if (!Enum.IsDefined(req.Tipo.Value)) return Results.BadRequest(new { erro = "Tipo inválido." });
                transacao.Tipo = req.Tipo.Value;
            }

            if (req.Categoria is not null)
            {
                if (!Enum.IsDefined(req.Categoria.Value)) return Results.BadRequest(new { erro = "Categoria inválida." });
                transacao.Categoria = req.Categoria.Value;
            }

            if (req.Data is not null)
            {
                var hoje = clock.Hoje();
                if (req.Data > hoje.AddYears(1) || req.Data < hoje.AddYears(-50))
                    return Results.BadRequest(new { erro = "Data fora do intervalo aceito." });
                transacao.Data = req.Data.Value;
                // Lançamento do banco mantém o mês da fatura informado por ele.
                if (transacao.OrigemExterna is null) transacao.Competencia = Transacao.CompetenciaDe(req.Data.Value);
            }

            if (req.FormaPagamento is not null)
            {
                if (!Enum.IsDefined(req.FormaPagamento.Value)) return Results.BadRequest(new { erro = "Forma de pagamento inválida." });
                transacao.FormaPagamento = req.FormaPagamento.Value;
            }

            // Campos opcionais precisam de um jeito de serem apagados: com `null`
            // significando "não mexer", string vazia é o sinal de limpar.
            if (req.Observacoes is not null)
            {
                var obs = req.Observacoes.Trim();
                transacao.Observacoes = obs.Length == 0 ? null : obs[..Math.Min(obs.Length, 500)];
            }
            if (req.LimparFormaPagamento == true) transacao.FormaPagamento = null;
            if (req.ForaDosTotais is not null) transacao.ForaDosTotais = req.ForaDosTotais.Value;

            List<string>? tags = null;
            if (req.Tags is not null)
            {
                tags = req.Tags.Select(n => n.Trim().Replace("|", "/")).Where(n => n.Length > 0)
                    .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                if (tags.Sum(n => n.Length + 1) > 500) return Results.BadRequest(new { erro = "Tags demais." });
                // Do banco, as tags são as da AUVP e quem grava é a escrita, depois
                // de saber quais existem lá.
                if (transacao.OrigemExterna is null) transacao.Tags = tags.Count == 0 ? null : string.Join('|', tags);
            }

            if (req.OrcamentoAuvp is not null)
            {
                if (transacao.Tipo != TipoTransacao.Despesa)
                    return Results.BadRequest(new { erro = "Só despesa pode ter orçamento." });
                transacao.OrcamentoAuvp = req.OrcamentoAuvp.Trim().ToUpperInvariant();
            }
            else if (req.LimparOrcamento == true) transacao.OrcamentoAuvp = null;

            // Uma correção manual do usuário é, por definição, confirmada — a menos
            // que o cliente explicitamente informe outro status.
            transacao.Status = req.Status ?? StatusTransacao.Confirmado;

            var mudouCategoria = transacao.Categoria != antes.Categoria;
            if (mudouCategoria)
                await RegrasCategoria.AprenderAsync(db, transacao.UserId, transacao.Descricao, transacao.Categoria, ct);

            var aviso = await auvp.EnviarAsync(transacao, new MudancaLocal(
                ForaDosTotais: transacao.ForaDosTotais != antes.ForaDosTotais ? transacao.ForaDosTotais : null,
                Descricao: transacao.Descricao != antes.Descricao ? transacao.Descricao : null,
                Observacoes: transacao.Observacoes != antes.Observacoes ? transacao.Observacoes ?? "" : null,
                Categoria: mudouCategoria ? transacao.Categoria : null,
                Tags: tags,
                OrcamentoAuvp: req.OrcamentoAuvp is not null ? transacao.OrcamentoAuvp : null,
                LimparOrcamento: req.OrcamentoAuvp is null && req.LimparOrcamento == true), ct);

            await db.SaveChangesAsync(ct);

            int? semelhantes = null;
            if (mudouCategoria)
            {
                var parecidos = await Semelhantes(db, transacao, ct);
                semelhantes = parecidos.Count;
            }

            return Results.Ok(TransacaoResponse.FromEntity(transacao) with { AvisoAuvp = aviso, Semelhantes = semelhantes });
        });

        // POST /api/financas/transacoes/{id}/aplicar-categoria — leva a categoria deste
        // lançamento aos parecidos (mesma loja) que ainda estão em outra.
        transacoes.MapPost("/{id:guid}/aplicar-categoria", async (Guid id, ClaimsPrincipal user, AppDbContext db,
            AuvpEscrita auvp, CancellationToken ct) =>
        {
            var modelo = await db.Transacoes.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id && t.UserId == user.UserId(), ct);
            if (modelo is null) return Results.NotFound();

            var parecidos = await Semelhantes(db, modelo, ct);
            var (falhas, primeira) = (0, (string?)null);
            foreach (var t in parecidos)
            {
                t.Categoria = modelo.Categoria;
                var aviso = await auvp.EnviarAsync(t, new MudancaLocal(Categoria: modelo.Categoria), ct);
                if (aviso is not null) { falhas++; primeira ??= aviso; }
            }
            await db.SaveChangesAsync(ct);
            return Results.Ok(new AtualizarLoteResponse(parecidos.Count, falhas, primeira));
        });

        // PATCH /api/financas/transacoes/lote — mesma mudança em vários de uma vez.
        transacoes.MapPatch("/lote", async (AtualizarLoteRequest req, ClaimsPrincipal user, AppDbContext db,
            AuvpEscrita auvp, CancellationToken ct) =>
        {
            if (req.Ids is not { Count: > 0 }) return Results.BadRequest(new { erro = "Nenhum lançamento selecionado." });
            if (req.Ids.Count > 500) return Results.BadRequest(new { erro = "Selecione no máximo 500 lançamentos." });
            if (req.Categoria is { } cat && !Enum.IsDefined(cat)) return Results.BadRequest(new { erro = "Categoria inválida." });

            var userId = user.UserId();
            var lista = await db.Transacoes.Where(t => t.UserId == userId && req.Ids.Contains(t.Id)).ToListAsync(ct);
            var orcamento = req.OrcamentoAuvp?.Trim().ToUpperInvariant();
            var (falhas, primeira) = (0, (string?)null);

            foreach (var t in lista)
            {
                var mudouCategoria = req.Categoria is { } c && c != t.Categoria;
                if (mudouCategoria) t.Categoria = req.Categoria!.Value;
                var mudouFora = req.ForaDosTotais is { } f && f != t.ForaDosTotais;
                if (mudouFora) t.ForaDosTotais = req.ForaDosTotais!.Value;

                List<string>? tags = null;
                if (req.AdicionarTags is { Count: > 0 } || req.RemoverTags is { Count: > 0 })
                {
                    var remover = (req.RemoverTags ?? []).Select(n => n.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
                    tags = t.ListaDeTags().Where(n => !remover.Contains(n))
                        .Concat((req.AdicionarTags ?? []).Select(n => n.Trim().Replace("|", "/")).Where(n => n.Length > 0))
                        .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                    if (t.OrigemExterna is null) t.Tags = tags.Count == 0 ? null : string.Join('|', tags);
                }

                var comOrcamento = orcamento is not null && t.Tipo == TipoTransacao.Despesa;
                if (comOrcamento) t.OrcamentoAuvp = orcamento;
                var limpar = orcamento is null && req.LimparOrcamento == true && t.OrcamentoAuvp is not null;
                if (limpar) t.OrcamentoAuvp = null;

                t.Status = StatusTransacao.Confirmado;

                var aviso = await auvp.EnviarAsync(t, new MudancaLocal(
                    ForaDosTotais: mudouFora ? t.ForaDosTotais : null,
                    Categoria: mudouCategoria ? t.Categoria : null,
                    Tags: tags,
                    OrcamentoAuvp: comOrcamento ? orcamento : null,
                    LimparOrcamento: limpar), ct);
                if (aviso is not null) { falhas++; primeira ??= aviso; }
            }

            await db.SaveChangesAsync(ct);
            return Results.Ok(new AtualizarLoteResponse(lista.Count, falhas, primeira));
        });

        transacoes.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var transacao = await db.Transacoes.FirstOrDefaultAsync(t => t.Id == id && t.UserId == user.UserId(), ct);
            if (transacao is null) return Results.NotFound();

            db.Transacoes.Remove(transacao);
            // Importado: lembra que foi apagado, senão a próxima sincronização traz de volta.
            if (transacao.OrigemExterna is { } origem && transacao.IdExterno is { } idExterno
                && !await db.TransacoesExcluidas.AnyAsync(x => x.UserId == transacao.UserId
                    && x.Origem == origem && x.IdExterno == idExterno, ct))
                db.TransacoesExcluidas.Add(new TransacaoExcluida
                    { UserId = transacao.UserId, Origem = origem, IdExterno = idExterno });
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        var dashboard = app.MapGroup("/api/financas/dashboard").RequireAuthorization();

        // GET /api/financas/dashboard/resumo?ano=2026&mes=8 — totais do período (padrão: mês atual no fuso do usuário).
        dashboard.MapGet("/resumo", async (ClaimsPrincipal user, AppDbContext db, FinancasClock clock,
            CancellationToken ct, int? ano, int? mes) =>
        {
            if (mes is < 1 or > 12) return Results.BadRequest(new { erro = $"Mês inválido: {mes}." });

            var userId = user.UserId();
            var (anoRef, mesRef) = clock.ResolverMes(ano, mes);

            var competencia = new DateOnly(anoRef, mesRef, 1);
            var competenciaAnterior = competencia.AddMonths(-1);

            var transacoesMes = await db.Transacoes.AsNoTracking()
                .Where(t => t.UserId == userId && !t.ForaDosTotais && t.Competencia == competencia)
                .ToListAsync(ct);

            var transacoesMesAnterior = await db.Transacoes.AsNoTracking()
                .Where(t => t.UserId == userId && !t.ForaDosTotais && t.Competencia == competenciaAnterior)
                .ToListAsync(ct);

            var totalReceitas = transacoesMes.Where(t => t.Tipo == TipoTransacao.Receita).Sum(t => t.Valor);
            var totalDespesas = transacoesMes.Where(t => t.Tipo == TipoTransacao.Despesa).Sum(t => t.Valor);
            var saldo = totalReceitas - totalDespesas;

            var saldoAnterior = transacoesMesAnterior.Where(t => t.Tipo == TipoTransacao.Receita).Sum(t => t.Valor)
                - transacoesMesAnterior.Where(t => t.Tipo == TipoTransacao.Despesa).Sum(t => t.Valor);

            var maiorGasto = transacoesMes
                .Where(t => t.Tipo == TipoTransacao.Despesa)
                .GroupBy(t => t.Categoria)
                .OrderByDescending(g => g.Sum(t => t.Valor))
                .Select(g => new { g.Key, Total = g.Sum(t => t.Valor) })
                .FirstOrDefault();

            // Sem mês anterior não existe variação: devolver 100% aqui faria um saldo
            // negativo aparecer como "+100%" (em verde) na interface.
            decimal? variacaoPercentual = null;
            if (transacoesMesAnterior.Count > 0 && saldoAnterior != 0)
            {
                variacaoPercentual = Math.Round((saldo - saldoAnterior) / Math.Abs(saldoAnterior) * 100, 2, MidpointRounding.AwayFromZero);
            }

            var pendentes = transacoesMes.Count(t => t.Status == StatusTransacao.PendenteRevisao);

            return Results.Ok(new ResumoResponse(
                anoRef, mesRef, totalReceitas, totalDespesas, saldo,
                maiorGasto?.Key.ToString(),
                maiorGasto is null ? null : CategoriaInfo.Rotulo(maiorGasto.Key),
                maiorGasto?.Total ?? 0m,
                saldoAnterior, variacaoPercentual,
                transacoesMes.Count, pendentes));
        });

        // GET /api/financas/dashboard/categorias?ano=&mes=&tipo=despesa — gastos agrupados por categoria (padrão: despesas do mês atual).
        dashboard.MapGet("/categorias", async (ClaimsPrincipal user, AppDbContext db, FinancasClock clock,
            CancellationToken ct, int? ano, int? mes, string? tipo) =>
        {
            if (mes is < 1 or > 12) return Results.BadRequest(new { erro = $"Mês inválido: {mes}." });
            if (!TryParseFiltro<TipoTransacao>(tipo, out var tipoFiltro))
                return Results.BadRequest(new { erro = $"Tipo inválido: '{tipo}'." });

            var userId = user.UserId();
            var (anoRef, mesRef) = clock.ResolverMes(ano, mes);
            var tipoRef = tipoFiltro ?? TipoTransacao.Despesa;

            var competencia = new DateOnly(anoRef, mesRef, 1);

            var transacoes = await db.Transacoes.AsNoTracking()
                .Where(t => t.UserId == userId && !t.ForaDosTotais && t.Competencia == competencia && t.Tipo == tipoRef)
                .ToListAsync(ct);

            var total = transacoes.Sum(t => t.Valor);

            var resultado = transacoes
                .GroupBy(t => t.Categoria)
                .Select(g => new CategoriaResumo(
                    g.Key.ToString(),
                    CategoriaInfo.Rotulo(g.Key),
                    g.Sum(t => t.Valor),
                    total > 0 ? Math.Round(g.Sum(t => t.Valor) / total * 100, 2, MidpointRounding.AwayFromZero) : 0,
                    g.Count()))
                .OrderByDescending(c => c.Total)
                .ToList();

            return Results.Ok(resultado);
        });

        // GET /api/financas/dashboard/tendencias?agrupamento=mensal|semanal&periodos=6 — evolução de receitas x despesas ao longo do tempo.
        dashboard.MapGet("/tendencias", async (ClaimsPrincipal user, AppDbContext db, FinancasClock clock,
            CancellationToken ct, string? agrupamento, int? periodos) =>
        {
            var userId = user.UserId();
            var semanal = string.Equals(agrupamento ?? "mensal", "semanal", StringComparison.OrdinalIgnoreCase);
            var periodosRef = Math.Clamp(periodos ?? 6, 1, semanal ? 52 : 24);

            var hoje = clock.Hoje();

            // A janela é alinhada ao início do período: sem isso o primeiro mês da
            // série viria pela metade e apareceria no gráfico como uma queda.
            var (inicio, chaves) = semanal
                ? JanelaSemanal(hoje, periodosRef)
                : JanelaMensal(hoje, periodosRef);

            // Mensal soma por competência, como o resumo; semanal não tem fatura e
            // segue a data da compra.
            var mesAtual = Transacao.CompetenciaDe(hoje);
            var transacoes = await db.Transacoes.AsNoTracking()
                .Where(t => t.UserId == userId && !t.ForaDosTotais)
                .Where(semanal
                    ? t => t.Data >= inicio && t.Data <= hoje
                    : t => t.Competencia >= inicio && t.Competencia <= mesAtual)
                .ToListAsync(ct);

            var porChave = transacoes
                .GroupBy(t => semanal ? ChaveSemanal(t.Data) : ChaveMensal(t.Competencia))
                .ToDictionary(g => g.Key, g => (
                    Receitas: g.Where(t => t.Tipo == TipoTransacao.Receita).Sum(t => t.Valor),
                    Despesas: g.Where(t => t.Tipo == TipoTransacao.Despesa).Sum(t => t.Valor)));

            // Períodos sem lançamento entram como zero: se sumissem, a linha do gráfico
            // ligaria dois meses distantes como se fossem consecutivos.
            var resultado = chaves
                .Select(c =>
                {
                    var v = porChave.GetValueOrDefault(c.Chave);
                    return new TendenciaPeriodo(c.Chave, c.Rotulo, v.Receitas, v.Despesas, v.Receitas - v.Despesas);
                })
                .ToList();

            return Results.Ok(resultado);
        });
    }

    // Lançamentos da mesma loja (mesma chave de descrição) em outra categoria.
    private static async Task<List<Transacao>> Semelhantes(AppDbContext db, Transacao modelo, CancellationToken ct)
    {
        var chave = RegrasCategoria.ChaveDeDescricao(modelo.Descricao);
        if (chave.Length < 3) return [];
        var candidatos = await db.Transacoes
            .Where(t => t.UserId == modelo.UserId && t.Id != modelo.Id && t.Categoria != modelo.Categoria
                        && t.Tipo == modelo.Tipo)
            .ToListAsync(ct);
        return candidatos.Where(t => RegrasCategoria.ChaveDeDescricao(t.Descricao) == chave).ToList();
    }

    // Ausente = sem filtro; presente e inválido = erro para o cliente, em vez de um
    // filtro silenciosamente ignorado.
    private static bool TryParseFiltro<T>(string? valor, out T? resultado) where T : struct, Enum
    {
        resultado = null;
        if (string.IsNullOrWhiteSpace(valor)) return true;

        if (!Enum.TryParse<T>(valor.Trim(), ignoreCase: true, out var convertido) || !Enum.IsDefined(convertido))
        {
            return false;
        }

        resultado = convertido;
        return true;
    }

    private static (DateOnly Inicio, List<(string Chave, string Rotulo)> Chaves) JanelaMensal(DateOnly hoje, int periodos)
    {
        var primeiroMes = new DateOnly(hoje.Year, hoje.Month, 1).AddMonths(-(periodos - 1));
        var chaves = Enumerable.Range(0, periodos)
            .Select(i => primeiroMes.AddMonths(i))
            .Select(d => (ChaveMensal(d), Services.CulturaBr.MesAbreviado(d)))
            .ToList();
        return (primeiroMes, chaves);
    }

    private static (DateOnly Inicio, List<(string Chave, string Rotulo)> Chaves) JanelaSemanal(DateOnly hoje, int periodos)
    {
        var inicioSemanaAtual = InicioDaSemana(hoje);
        var primeira = inicioSemanaAtual.AddDays(-7 * (periodos - 1));
        var chaves = Enumerable.Range(0, periodos)
            .Select(i => primeira.AddDays(7 * i))
            .Select(d => (ChaveSemanal(d), $"{d:dd/MM}"))
            .ToList();
        return (primeira, chaves);
    }


    private static DateOnly InicioDaSemana(DateOnly data) =>
        data.AddDays(-(((int)data.DayOfWeek + 6) % 7));

    private static string ChaveMensal(DateOnly data) => data.ToString("yyyy-MM", CultureInfo.InvariantCulture);

    // ISOWeek em vez de Calendar.GetWeekOfYear + data.Year: a combinação antiga
    // rotulava 01/01/2027 como "2027-W53" (a semana pertence a 2026), jogando o
    // período para o fim da série ordenada.
    private static string ChaveSemanal(DateOnly data)
    {
        var dt = data.ToDateTime(TimeOnly.MinValue);
        return $"{System.Globalization.ISOWeek.GetYear(dt)}-W{System.Globalization.ISOWeek.GetWeekOfYear(dt):D2}";
    }
}
