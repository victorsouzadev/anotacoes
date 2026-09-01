using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Dtos;
using Notas.Api.Services.Financas.Llm;
using Notas.Api.Services.Seguranca;

namespace Notas.Api.Endpoints;

// Configuração de IA pela interface: provedor, modelo e chave de API do próprio
// usuário — para não ser preciso entrar na VPS e editar o .env a cada troca.
public static class ConfiguracaoIaEndpoints
{
    public static void MapConfiguracaoIaEndpoints(this IEndpointRouteBuilder app)
    {
        var grupo = app.MapGroup("/api/configuracoes/ia").RequireAuthorization();

        grupo.MapGet("/", async (ClaimsPrincipal user, AppDbContext db, ILlmExtractorFactory factory,
            CancellationToken ct) =>
        {
            var userId = user.UserId();
            var config = await db.ConfiguracoesIa.AsNoTracking().FirstOrDefaultAsync(c => c.UserId == userId, ct);
            var efetiva = await factory.ResolverAsync(userId, ct);

            return Results.Ok(Montar(config, efetiva));
        });

        grupo.MapPut("/", async (SalvarConfiguracaoIaRequest req, ClaimsPrincipal user, AppDbContext db,
            IProtetorDeSegredos protetor, ILlmExtractorFactory factory, CancellationToken ct) =>
        {
            var provedor = (req.Provedor ?? "").Trim().ToLowerInvariant();
            if (provedor.Length > 0 && !LlmExtractorFactory.ProvedoresValidos.Contains(provedor))
            {
                return Results.BadRequest(new { erro = $"Provedor inválido: '{req.Provedor}'." });
            }

            var modelo = (req.Modelo ?? "").Trim();
            if (modelo.Length > 120)
            {
                return Results.BadRequest(new { erro = "O identificador do modelo passa de 120 caracteres." });
            }

            var userId = user.UserId();
            var config = await db.ConfiguracoesIa.FirstOrDefaultAsync(c => c.UserId == userId, ct);
            if (config is null)
            {
                config = new ConfiguracaoIa { UserId = userId };
                db.ConfiguracoesIa.Add(config);
            }

            config.Provedor = provedor;
            config.Modelo = modelo.Length == 0 ? null : modelo;

            // null = manter a chave atual (o cliente nunca a recebe de volta, então
            // não teria como reenviá-la ao salvar só o modelo).
            if (req.ChaveApi is not null)
            {
                var chave = req.ChaveApi.Trim();
                if (chave.Length == 0)
                {
                    config.ChaveApiCifrada = null;
                    config.ChaveApiSufixo = null;
                }
                else
                {
                    if (chave.Length is < 8 or > 400)
                    {
                        return Results.BadRequest(new { erro = "A chave de API não parece válida." });
                    }

                    config.ChaveApiCifrada = protetor.Proteger(chave);
                    config.ChaveApiSufixo = chave[^4..];
                }
            }

            config.AtualizadoEm = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);

            var efetiva = await factory.ResolverAsync(userId, ct);
            return Results.Ok(Montar(config, efetiva));
        });

        grupo.MapDelete("/chave", async (ClaimsPrincipal user, AppDbContext db, ILlmExtractorFactory factory,
            CancellationToken ct) =>
        {
            var userId = user.UserId();
            var config = await db.ConfiguracoesIa.FirstOrDefaultAsync(c => c.UserId == userId, ct);
            if (config is null) return Results.NotFound();

            config.ChaveApiCifrada = null;
            config.ChaveApiSufixo = null;
            config.AtualizadoEm = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);

            var efetiva = await factory.ResolverAsync(userId, ct);
            return Results.Ok(Montar(config, efetiva));
        });

        // Faz uma extração de verdade com a configuração informada, antes de salvar:
        // uma chave com um caractere a menos ou um modelo que não existe só
        // apareceria na primeira tentativa de lançar algo, sem dizer o motivo.
        grupo.MapPost("/testar", async (TestarConfiguracaoIaRequest req, ClaimsPrincipal user,
            ILlmExtractorFactory factory, IProtetorDeSegredos protetor, AppDbContext db,
            Services.Financas.FinancasClock clock, ILoggerFactory loggerFactory, CancellationToken ct) =>
        {
            var logger = loggerFactory.CreateLogger("ConfiguracaoIa.Testar");
            var provedor = LlmExtractorFactory.Normalizar(
                string.IsNullOrWhiteSpace(req.Provedor) ? null : req.Provedor);

            // Se o cliente não mandou chave, testa com a que já está salva — é o
            // caso de quem só quer conferir se a configuração atual funciona.
            var chave = req.ChaveApi;
            if (string.IsNullOrWhiteSpace(chave))
            {
                var userId = user.UserId();
                var salva = await db.ConfiguracoesIa.AsNoTracking()
                    .FirstOrDefaultAsync(c => c.UserId == userId, ct);
                if (salva?.ChaveApiCifrada is { Length: > 0 })
                {
                    chave = protetor.Desproteger(salva.ChaveApiCifrada);
                }
            }

            var extrator = factory.CriarAvulso(provedor, chave, req.Modelo);

            try
            {
                var resultado = await extrator.ExtrairAsync(
                    EntradaExtracao.DeTexto("gastei 42,50 no mercado hoje"), clock.Hoje(), ct);

                var primeiro = resultado[0];
                // Formato brasileiro: o exemplo é lido por quem está na tela, e
                // "R$ 42.50" pareceria um valor diferente.
                var valor = (primeiro.Valor ?? 0m).ToString("N2", CulturaBr);
                var exemplo = $"{primeiro.Descricao} — R$ {valor} ({primeiro.Categoria})";

                return Results.Ok(new TestarConfiguracaoIaResponse(
                    true, $"Conexão bem-sucedida usando {extrator.Provedor}.", exemplo));
            }
            catch (LlmIndisponivelException ex)
            {
                return Results.Ok(new TestarConfiguracaoIaResponse(false, ex.Message, null));
            }
            catch (ExtracaoInvalidaException ex)
            {
                // O provedor respondeu, mas o conteúdo não serviu: a conexão está de
                // pé e o problema é o modelo escolhido.
                return Results.Ok(new TestarConfiguracaoIaResponse(
                    false, $"O provedor respondeu, mas a resposta não pôde ser interpretada: {ex.Message}", null));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Este endpoint existe para diagnosticar: devolver 500 faria a tela
                // mostrar "não foi possível testar" e esconder justamente a causa
                // que o usuário veio descobrir.
                logger.LogError(ex, "Falha inesperada ao testar a configuração de IA.");
                return Results.Ok(new TestarConfiguracaoIaResponse(
                    false, $"Falha inesperada ao testar: {ex.GetType().Name} — {ex.Message}", null));
            }
        }).RequireRateLimiting("financas-ia");
    }

    private static readonly System.Globalization.CultureInfo CulturaBr =
        System.Globalization.CultureInfo.GetCultureInfo("pt-BR");

    private static ConfiguracaoIaResponse Montar(ConfiguracaoIa? config, ConfiguracaoEfetiva efetiva)
    {
        var sufixo = config?.ChaveApiSufixo;

        return new ConfiguracaoIaResponse(
            config?.Provedor ?? "",
            config?.Modelo,
            efetiva.Provedor,
            efetiva.Modelo,
            efetiva.SuportaAnexos,
            ChaveConfigurada: !string.IsNullOrEmpty(sufixo),
            ChaveMascarada: sufixo is null ? null : $"••••••••{sufixo}",
            UsandoChaveDoServidor: efetiva.TemChave && !efetiva.ChavePropria,
            ModelosSugeridos.Para(efetiva.Provedor)
                .Select(m => new ModeloSugeridoResponse(m.Id, m.Nome, m.Descricao, m.LeImagens))
                .ToList(),
            config?.AtualizadoEm);
    }
}
