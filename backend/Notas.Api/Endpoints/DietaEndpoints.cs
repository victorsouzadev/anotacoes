using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Dtos;
using Notas.Api.Services.Dieta;

namespace Notas.Api.Endpoints;

/// <summary>
/// Ferramenta "Dieta". O app Android sincroniza como nas Tarefas: GET devolve tudo (ou só o que mudou
/// desde ?desde=), PUT /{id} grava se o UpdatedAt recebido for mais novo. Excluir = PUT com DeletedAt.
/// </summary>
public static class DietaEndpoints
{
    public static readonly string[] Refeicoes = ["cafe", "almoco", "lanche", "jantar", "ceia"];
    private const int MaxFotoBytes = 3 * 1024 * 1024;
    private static readonly string[] TiposFoto = ["image/jpeg", "image/png", "image/webp"];

    public static void MapDietaEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/dieta").RequireAuthorization();

        // ---------- Perfil e metas ----------
        g.MapGet("/perfil", async (ClaimsPrincipal user, DietaProgresso prog, CancellationToken ct) =>
        {
            var (perfil, peso, metas) = await prog.Metas(user.UserId(), ct);
            return Results.Ok(new DietaPerfilResposta(perfil is null ? null : ToDto(perfil), peso, metas,
                DietaMetas.Sugerir(perfil, peso, prog.Hoje())));
        });

        g.MapPut("/perfil", async (DietaPerfilDto req, ClaimsPrincipal user, AppDbContext db, DietaProgresso prog, CancellationToken ct) =>
        {
            if (req.AlturaCm is < 0 or > 260 || req.Atividade is < 1 or > 2.5
                || req.Sexo is not ("M" or "F") || req.Objetivo is not ("perder" or "manter" or "ganhar")
                || new[] { req.MetaKcal, req.MetaProteinaG, req.MetaCarboG, req.MetaGorduraG, req.MetaAguaMl }.Any(v => v is < 0 or > 20000))
                return Results.BadRequest(new { error = "Perfil inválido." });

            var userId = user.UserId();
            var perfil = await db.DietaPerfis.FirstOrDefaultAsync(p => p.UserId == userId, ct);
            if (perfil is null) db.DietaPerfis.Add(perfil = new DietaPerfil { UserId = userId });
            else if (req.UpdatedAt != default && perfil.UpdatedAt >= req.UpdatedAt) return Results.Ok(ToDto(perfil));

            perfil.AlturaCm = req.AlturaCm;
            perfil.Nascimento = req.Nascimento;
            perfil.Sexo = req.Sexo;
            perfil.Atividade = req.Atividade;
            perfil.Objetivo = req.Objetivo;
            perfil.MetaKcal = req.MetaKcal;
            perfil.MetaProteinaG = req.MetaProteinaG;
            perfil.MetaCarboG = req.MetaCarboG;
            perfil.MetaGorduraG = req.MetaGorduraG;
            perfil.MetaAguaMl = req.MetaAguaMl;
            perfil.UpdatedAt = req.UpdatedAt == default ? DateTime.UtcNow : req.UpdatedAt;
            await db.SaveChangesAsync(ct);
            return Results.Ok(ToDto(perfil));
        });

        // ---------- Alimentos ----------
        // Busca na TACO e nos alimentos próprios, sem acento e por palavras ("frango grelhado").
        g.MapGet("/alimentos", async (string? q, int? limite, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var userId = user.UserId();
            var todos = await db.DietaAlimentos.AsNoTracking()
                .Where(a => (a.UserId == null || a.UserId == userId) && a.DeletedAt == null).ToListAsync(ct);
            var termos = SemAcento(q ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var achados = termos.Length == 0
                ? todos.Where(a => a.UserId != null).OrderByDescending(a => a.Favorito).ThenBy(a => a.Nome)
                : todos.Where(a => termos.All(t => SemAcento(a.Nome).Contains(t)))
                    .OrderByDescending(a => a.Favorito).ThenByDescending(a => a.UserId != null)
                    .ThenBy(a => SemAcento(a.Nome).StartsWith(termos[0]) ? 0 : 1).ThenBy(a => a.Nome.Length);
            return Results.Ok(achados.Take(Math.Clamp(limite ?? 50, 1, 200)).Select(ToDto));
        });

        // Só os do usuário (com os excluídos), para o sync. A TACO o app já leva embutida.
        g.MapGet("/alimentos/meus", async (DateTime? desde, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
            await db.DietaAlimentos.AsNoTracking().Where(a => a.UserId == user.UserId() && (desde == null || a.UpdatedAt > desde))
                .OrderBy(a => a.UpdatedAt).Select(a => ToDto(a)).ToListAsync(ct));

        g.MapPut("/alimentos/{id}", async (string id, DietaAlimentoUpsert req, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var nome = req.Nome?.Trim() ?? "";
            if (nome.Length is 0 or > 200 || id.StartsWith("taco-") || Negativo(req.Kcal, req.Proteina, req.Carbo, req.Gordura, req.Fibra, req.Sodio) || req.PorcaoG <= 0)
                return Results.BadRequest(new { error = "Alimento inválido." });
            var userId = user.UserId();
            var a = await db.DietaAlimentos.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (a is not null && a.UserId != userId) return Results.Conflict(new { error = "Id em uso." });
            if (a is null) db.DietaAlimentos.Add(a = new DietaAlimento { Id = id, UserId = userId });
            else if (a.UpdatedAt >= req.UpdatedAt) return Results.Ok(ToDto(a));

            a.Nome = nome;
            (a.Kcal, a.Proteina, a.Carbo, a.Gordura, a.Fibra, a.Sodio) = (req.Kcal, req.Proteina, req.Carbo, req.Gordura, req.Fibra, req.Sodio);
            a.PorcaoG = req.PorcaoG;
            a.PorcaoNome = req.PorcaoNome?.Trim();
            a.CodigoBarras = req.CodigoBarras?.Trim();
            a.Fonte = req.Fonte is "off" or "receita" ? req.Fonte : "manual";
            a.Favorito = req.Favorito;
            a.Itens = req.Itens;
            a.UpdatedAt = req.UpdatedAt == default ? DateTime.UtcNow : req.UpdatedAt;
            a.DeletedAt = req.DeletedAt;
            if (a.Fonte == "receita" && !await CalcularReceita(a, userId, db, ct))
                return Results.BadRequest(new { error = "Itens da receita inválidos." });
            await db.SaveChangesAsync(ct);
            return Results.Ok(ToDto(a));
        });

        // Código de barras: primeiro nos alimentos do usuário, depois na Open Food Facts (e guarda).
        g.MapGet("/alimentos/codigo/{codigo}", async (string codigo, ClaimsPrincipal user, AppDbContext db, IOpenFoodFacts off, CancellationToken ct) =>
        {
            if (codigo.Length is < 6 or > 32 || !codigo.All(char.IsAsciiDigit)) return Results.BadRequest(new { error = "Código inválido." });
            var userId = user.UserId();
            var meu = await db.DietaAlimentos.AsNoTracking()
                .FirstOrDefaultAsync(a => a.UserId == userId && a.CodigoBarras == codigo && a.DeletedAt == null, ct);
            if (meu is not null) return Results.Ok(ToDto(meu));
            var p = await off.Buscar(codigo, ct);
            if (p is null) return Results.NotFound(new { error = "Produto não encontrado. Cadastre manualmente." });
            var a = new DietaAlimento
            {
                Id = Guid.NewGuid().ToString(), UserId = userId, Nome = p.Nome.Length > 200 ? p.Nome[..200] : p.Nome,
                Kcal = p.Kcal, Proteina = p.Proteina, Carbo = p.Carbo, Gordura = p.Gordura, Fibra = p.Fibra, Sodio = p.Sodio,
                PorcaoG = p.PorcaoG is > 0 ? p.PorcaoG.Value : 100, PorcaoNome = p.PorcaoG is > 0 ? "1 porção" : null,
                CodigoBarras = codigo, Fonte = "off", UpdatedAt = DateTime.UtcNow,
            };
            db.DietaAlimentos.Add(a);
            await db.SaveChangesAsync(ct);
            return Results.Ok(ToDto(a));
        });

        // ---------- Registros (diário) ----------
        g.MapGet("/registros", async (DateTime? desde, DateOnly? data, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
            await db.DietaRegistros.AsNoTracking()
                .Where(r => r.UserId == user.UserId() && (desde == null || r.UpdatedAt > desde) && (data == null || (r.Data == data && r.DeletedAt == null)))
                .OrderBy(r => r.UpdatedAt).Select(r => ToDto(r)).ToListAsync(ct));

        g.MapPut("/registros/{id}", async (string id, DietaRegistroUpsert req, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            if (!Refeicoes.Contains(req.Refeicao) || req.QuantidadeG is <= 0 or > 5000 || Negativo(req.Kcal, req.Proteina, req.Carbo, req.Gordura, req.Fibra))
                return Results.BadRequest(new { error = "Registro inválido." });
            var userId = user.UserId();
            var r = await db.DietaRegistros.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (r is not null && r.UserId != userId) return Results.Conflict(new { error = "Id em uso." });
            if (r is null) db.DietaRegistros.Add(r = new DietaRegistro { Id = id, UserId = userId, CreatedAt = req.CreatedAt == default ? DateTime.UtcNow : req.CreatedAt });
            else if (r.UpdatedAt >= req.UpdatedAt) return Results.Ok(ToDto(r));

            r.Data = req.Data;
            r.Refeicao = req.Refeicao;
            r.AlimentoId = req.AlimentoId;
            r.QuantidadeG = req.QuantidadeG;
            r.FotoId = req.FotoId;
            (r.Nome, r.Kcal, r.Proteina, r.Carbo, r.Gordura, r.Fibra) = (req.Nome?.Trim() ?? "", req.Kcal, req.Proteina, req.Carbo, req.Gordura, req.Fibra);
            // Sem valores (ex.: veio do MCP ou de um cliente simples): calcula pelo alimento.
            if (req.Kcal == 0 && req.Proteina == 0 && req.AlimentoId is { } aid)
            {
                var a = await db.DietaAlimentos.AsNoTracking().FirstOrDefaultAsync(x => x.Id == aid && (x.UserId == null || x.UserId == userId), ct);
                if (a is null) return Results.BadRequest(new { error = "Alimento não encontrado." });
                Aplicar(r, a, req.QuantidadeG);
            }
            if (r.Nome.Length is 0 or > 200) return Results.BadRequest(new { error = "Nome inválido." });
            r.UpdatedAt = req.UpdatedAt == default ? DateTime.UtcNow : req.UpdatedAt;
            r.DeletedAt = req.DeletedAt;
            await db.SaveChangesAsync(ct);
            return Results.Ok(ToDto(r));
        });

        // "Repetir refeição": copia os itens de uma refeição de outro dia.
        g.MapPost("/registros/repetir", async (DateOnly de, DateOnly para, string refeicao, string? paraRefeicao, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var destino = paraRefeicao ?? refeicao;
            if (!Refeicoes.Contains(refeicao) || !Refeicoes.Contains(destino)) return Results.BadRequest(new { error = "Refeição inválida." });
            var userId = user.UserId();
            var origem = await db.DietaRegistros.AsNoTracking()
                .Where(r => r.UserId == userId && r.Data == de && r.Refeicao == refeicao && r.DeletedAt == null).ToListAsync(ct);
            var agora = DateTime.UtcNow;
            var novos = origem.Select(r => new DietaRegistro
            {
                Id = Guid.NewGuid().ToString(), UserId = userId, Data = para, Refeicao = destino, AlimentoId = r.AlimentoId,
                Nome = r.Nome, QuantidadeG = r.QuantidadeG, Kcal = r.Kcal, Proteina = r.Proteina, Carbo = r.Carbo,
                Gordura = r.Gordura, Fibra = r.Fibra, CreatedAt = agora, UpdatedAt = agora,
            }).ToList();
            db.DietaRegistros.AddRange(novos);
            await db.SaveChangesAsync(ct);
            return Results.Ok(novos.Select(ToDto));
        });

        // ---------- Peso, água, plano ----------
        g.MapGet("/pesos", async (DateTime? desde, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
            await db.DietaPesos.AsNoTracking().Where(p => p.UserId == user.UserId() && (desde == null || p.UpdatedAt > desde))
                .OrderBy(p => p.Data).Select(p => new DietaPesoDto(p.Id, p.Data, p.Kg, p.UpdatedAt, p.DeletedAt)).ToListAsync(ct));

        g.MapPut("/pesos/{id}", async (string id, DietaPesoUpsert req, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            if (req.Kg is < 20 or > 400) return Results.BadRequest(new { error = "Peso inválido." });
            var userId = user.UserId();
            var p = await db.DietaPesos.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p is not null && p.UserId != userId) return Results.Conflict(new { error = "Id em uso." });
            if (p is null) db.DietaPesos.Add(p = new DietaPeso { Id = id, UserId = userId });
            else if (p.UpdatedAt >= req.UpdatedAt) return Results.Ok(new DietaPesoDto(p.Id, p.Data, p.Kg, p.UpdatedAt, p.DeletedAt));
            (p.Data, p.Kg, p.DeletedAt) = (req.Data, Math.Round(req.Kg, 2), req.DeletedAt);
            p.UpdatedAt = req.UpdatedAt == default ? DateTime.UtcNow : req.UpdatedAt;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new DietaPesoDto(p.Id, p.Data, p.Kg, p.UpdatedAt, p.DeletedAt));
        });

        g.MapGet("/agua", async (DateTime? desde, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
            await db.DietaAguas.AsNoTracking().Where(a => a.UserId == user.UserId() && (desde == null || a.UpdatedAt > desde))
                .OrderBy(a => a.UpdatedAt).Select(a => new DietaAguaDto(a.Id, a.Data, a.Ml, a.UpdatedAt, a.DeletedAt)).ToListAsync(ct));

        g.MapPut("/agua/{id}", async (string id, DietaAguaUpsert req, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            if (req.Ml is <= 0 or > 5000) return Results.BadRequest(new { error = "Quantidade inválida." });
            var userId = user.UserId();
            var a = await db.DietaAguas.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (a is not null && a.UserId != userId) return Results.Conflict(new { error = "Id em uso." });
            if (a is null) db.DietaAguas.Add(a = new DietaAgua { Id = id, UserId = userId });
            else if (a.UpdatedAt >= req.UpdatedAt) return Results.Ok(new DietaAguaDto(a.Id, a.Data, a.Ml, a.UpdatedAt, a.DeletedAt));
            (a.Data, a.Ml, a.DeletedAt) = (req.Data, req.Ml, req.DeletedAt);
            a.UpdatedAt = req.UpdatedAt == default ? DateTime.UtcNow : req.UpdatedAt;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new DietaAguaDto(a.Id, a.Data, a.Ml, a.UpdatedAt, a.DeletedAt));
        });

        g.MapGet("/plano", async (DateTime? desde, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
            await db.DietaPlano.AsNoTracking().Where(p => p.UserId == user.UserId() && (desde == null || p.UpdatedAt > desde))
                .OrderBy(p => p.DiaSemana).Select(p => ToDto(p)).ToListAsync(ct));

        g.MapPut("/plano/{id}", async (string id, DietaPlanoUpsert req, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var nome = req.Nome?.Trim() ?? "";
            if (req.DiaSemana is < -1 or > 6 || !Refeicoes.Contains(req.Refeicao) || nome.Length is 0 or > 200 || req.QuantidadeG is < 0 or > 5000)
                return Results.BadRequest(new { error = "Item do plano inválido." });
            var userId = user.UserId();
            var p = await db.DietaPlano.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p is not null && p.UserId != userId) return Results.Conflict(new { error = "Id em uso." });
            if (p is null) db.DietaPlano.Add(p = new DietaPlanoItem { Id = id, UserId = userId });
            else if (p.UpdatedAt >= req.UpdatedAt) return Results.Ok(ToDto(p));
            (p.DiaSemana, p.Refeicao, p.AlimentoId, p.Nome, p.QuantidadeG, p.DeletedAt) = (req.DiaSemana, req.Refeicao, req.AlimentoId, nome, req.QuantidadeG, req.DeletedAt);
            p.UpdatedAt = req.UpdatedAt == default ? DateTime.UtcNow : req.UpdatedAt;
            await db.SaveChangesAsync(ct);
            return Results.Ok(ToDto(p));
        });

        // ---------- Fotos ----------
        g.MapGet("/fotos", async (DateTime? desde, string? tipo, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
            await db.DietaFotos.AsNoTracking()
                .Where(f => f.UserId == user.UserId() && (desde == null || f.CreatedAt > desde || f.DeletedAt > desde) && (tipo == null || f.Tipo == tipo))
                .OrderByDescending(f => f.Data)
                .Select(f => new DietaFotoDto(f.Id, f.Data, f.Tipo, f.Rotulo, f.ContentType, f.SizeBytes, f.CreatedAt, f.DeletedAt))
                .ToListAsync(ct));

        // Multipart: id (UUID do app), data (yyyy-MM-dd), tipo, rotulo e o arquivo. Reenviar o mesmo id não duplica.
        g.MapPost("/fotos", async (HttpRequest http, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            if (!http.HasFormContentType) return Results.BadRequest(new { error = "Envie multipart/form-data." });
            var form = await http.ReadFormAsync(ct);
            var arquivo = form.Files.FirstOrDefault();
            var id = form["id"].FirstOrDefault() ?? Guid.NewGuid().ToString();
            var tipo = form["tipo"].FirstOrDefault() ?? "refeicao";
            var rotulo = form["rotulo"].FirstOrDefault();
            if (arquivo is null || arquivo.Length == 0 || arquivo.Length > MaxFotoBytes || !TiposFoto.Contains(arquivo.ContentType)
                || tipo is not ("refeicao" or "corpo") || id.Length > 64 || rotulo?.Length > 10
                || !DateOnly.TryParseExact(form["data"].FirstOrDefault(), "yyyy-MM-dd", out var data))
                return Results.BadRequest(new { error = "Foto inválida (JPEG/PNG/WebP até 3 MB, com data e tipo)." });

            var userId = user.UserId();
            var existente = await db.DietaFotos.AsNoTracking().FirstOrDefaultAsync(f => f.Id == id, ct);
            if (existente is not null)
                return existente.UserId == userId
                    ? Results.Ok(new DietaFotoDto(existente.Id, existente.Data, existente.Tipo, existente.Rotulo, existente.ContentType, existente.SizeBytes, existente.CreatedAt, existente.DeletedAt))
                    : Results.Conflict(new { error = "Id em uso." });

            using var ms = new MemoryStream();
            await arquivo.CopyToAsync(ms, ct);
            var f = new DietaFoto
            {
                Id = id, UserId = userId, Data = data, Tipo = tipo, Rotulo = rotulo, ContentType = arquivo.ContentType,
                Conteudo = ms.ToArray(), SizeBytes = (int)ms.Length, CreatedAt = DateTime.UtcNow,
            };
            db.DietaFotos.Add(f);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new DietaFotoDto(f.Id, f.Data, f.Tipo, f.Rotulo, f.ContentType, f.SizeBytes, f.CreatedAt, f.DeletedAt));
        }).DisableAntiforgery();

        g.MapGet("/fotos/{id}/arquivo", async (string id, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var f = await db.DietaFotos.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.UserId == user.UserId() && x.DeletedAt == null, ct);
            return f is null ? Results.NotFound() : Results.File(f.Conteudo, f.ContentType);
        });

        g.MapDelete("/fotos/{id}", async (string id, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var f = await db.DietaFotos.FirstOrDefaultAsync(x => x.Id == id && x.UserId == user.UserId(), ct);
            if (f is null) return Results.NotFound();
            // Tombstone para o sync, mas o conteúdo sai na hora: quem apaga uma foto quer ela fora do servidor.
            f.DeletedAt = DateTime.UtcNow;
            f.Conteudo = [];
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // ---------- Consultas ----------
        g.MapGet("/dia/{data}", async (DateOnly data, ClaimsPrincipal user, AppDbContext db, DietaProgresso prog, CancellationToken ct) =>
        {
            var userId = user.UserId();
            var (_, _, metas) = await prog.Metas(userId, ct);
            var totais = (await prog.Dias(userId, data, data, metas, ct))[0];
            var regs = await db.DietaRegistros.AsNoTracking().Where(r => r.UserId == userId && r.Data == data && r.DeletedAt == null)
                .OrderBy(r => r.CreatedAt).Select(r => ToDto(r)).ToListAsync(ct);
            var agua = await db.DietaAguas.AsNoTracking().Where(a => a.UserId == userId && a.Data == data && a.DeletedAt == null)
                .Select(a => new DietaAguaDto(a.Id, a.Data, a.Ml, a.UpdatedAt, a.DeletedAt)).ToListAsync(ct);
            var peso = await db.DietaPesos.AsNoTracking().Where(p => p.UserId == userId && p.Data == data && p.DeletedAt == null)
                .Select(p => (double?)p.Kg).FirstOrDefaultAsync(ct);
            return Results.Ok(new DietaDiaResposta(totais, metas, await prog.AdesaoAoPlano(userId, data, ct), regs, agua, peso));
        });

        g.MapGet("/progresso", async (ClaimsPrincipal user, DietaProgresso prog, CancellationToken ct) =>
            Results.Ok(await prog.Calcular(user.UserId(), ct)));

        g.MapGet("/export.csv", async (DateOnly? inicio, DateOnly? fim, ClaimsPrincipal user, AppDbContext db, DietaProgresso prog, CancellationToken ct) =>
            Results.File(await Csv(user.UserId(), inicio ?? prog.Hoje().AddDays(-30), fim ?? prog.Hoje(), db, ct),
                "text/csv; charset=utf-8", "dieta.csv"));

        // ---------- Compartilhamento ----------
        g.MapGet("/compartilhamentos", async (ClaimsPrincipal user, AppDbContext db, HttpRequest http, CancellationToken ct) =>
            (await db.DietaCompartilhamentos.AsNoTracking().Where(c => c.UserId == user.UserId())
                .OrderByDescending(c => c.CreatedAt).ToListAsync(ct)).Select(c => ToDto(c, http)));

        g.MapPost("/compartilhamentos", async (DietaCompartilhamentoCriar req, ClaimsPrincipal user, AppDbContext db, HttpRequest http, CancellationToken ct) =>
        {
            var escopos = (req.Escopos ?? []).Distinct().ToList();
            if (escopos.Count == 0 || escopos.Any(e => !DietaEscopos.Todos.Contains(e)) || req.DiasValidade is < 1 or > 3650)
                return Results.BadRequest(new { error = "Escolha o que compartilhar." });
            var c = new DietaCompartilhamento
            {
                Id = Guid.NewGuid().ToString(), UserId = user.UserId(),
                Token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant(),
                Titulo = string.IsNullOrWhiteSpace(req.Titulo) ? "Meu progresso" : req.Titulo.Trim()[..Math.Min(req.Titulo.Trim().Length, 100)],
                Escopos = string.Join(',', escopos),
                ExpiraEm = req.DiasValidade is { } d ? DateTime.UtcNow.AddDays(d) : null,
                CreatedAt = DateTime.UtcNow,
            };
            db.DietaCompartilhamentos.Add(c);
            await db.SaveChangesAsync(ct);
            return Results.Ok(ToDto(c, http));
        });

        g.MapDelete("/compartilhamentos/{id}", async (string id, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var c = await db.DietaCompartilhamentos.FirstOrDefaultAsync(x => x.Id == id && x.UserId == user.UserId(), ct);
            if (c is null) return Results.NotFound();
            c.RevogadoEm ??= DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // ---------- Página pública (sem login, pelo token) ----------
        var pub = app.MapGroup("/api/dieta/publico/{token}").AllowAnonymous();

        pub.MapGet("/", async (string token, AppDbContext db, DietaProgresso prog, CancellationToken ct) =>
        {
            if (await Valido(token, db, ct) is not { } c) return Results.NotFound();
            var html = await DietaPaginaPublica.Montar(c, db, prog, ct);
            return Results.Content(html, "text/html; charset=utf-8");
        });

        pub.MapGet("/fotos/{id}", async (string token, string id, AppDbContext db, CancellationToken ct) =>
        {
            if (await Valido(token, db, ct) is not { } c) return Results.NotFound();
            var escopos = c.Escopos.Split(',');
            var f = await db.DietaFotos.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.UserId == c.UserId && x.DeletedAt == null, ct);
            if (f is null || !escopos.Contains(f.Tipo == "corpo" ? DietaEscopos.FotosCorpo : DietaEscopos.FotosRefeicao)) return Results.NotFound();
            return Results.File(f.Conteudo, f.ContentType);
        });

        pub.MapGet("/export.csv", async (string token, AppDbContext db, DietaProgresso prog, CancellationToken ct) =>
        {
            if (await Valido(token, db, ct) is not { } c || !c.Escopos.Split(',').Contains(DietaEscopos.Exportar)) return Results.NotFound();
            return Results.File(await Csv(c.UserId, prog.Hoje().AddDays(-90), prog.Hoje(), db, ct), "text/csv; charset=utf-8", "dieta.csv");
        });
    }

    private static async Task<DietaCompartilhamento?> Valido(string token, AppDbContext db, CancellationToken ct)
    {
        if (token.Length != 32) return null;
        var c = await db.DietaCompartilhamentos.AsNoTracking().FirstOrDefaultAsync(x => x.Token == token, ct);
        return c is null || c.RevogadoEm is not null || c.ExpiraEm < DateTime.UtcNow ? null : c;
    }

    public static void Aplicar(DietaRegistro r, DietaAlimento a, double gramas)
    {
        var f = gramas / 100.0;
        if (string.IsNullOrWhiteSpace(r.Nome)) r.Nome = a.Nome;
        r.Kcal = Math.Round(a.Kcal * f, 1);
        r.Proteina = Math.Round(a.Proteina * f, 1);
        r.Carbo = Math.Round(a.Carbo * f, 1);
        r.Gordura = Math.Round(a.Gordura * f, 1);
        r.Fibra = Math.Round(a.Fibra * f, 1);
    }

    /// <summary>Recalcula os valores por 100 g da receita a partir dos itens (soma dos itens ÷ peso total).</summary>
    private static async Task<bool> CalcularReceita(DietaAlimento receita, string userId, AppDbContext db, CancellationToken ct)
    {
        List<ReceitaItem>? itens;
        try { itens = JsonSerializer.Deserialize<List<ReceitaItem>>(receita.Itens ?? "", new JsonSerializerOptions(JsonSerializerDefaults.Web)); }
        catch (JsonException) { return false; }
        if (itens is not { Count: > 0 } || itens.Any(i => i.Gramas <= 0 || i.AlimentoId is null)) return false;
        var ids = itens.Select(i => i.AlimentoId!).ToList();
        var alimentos = await db.DietaAlimentos.AsNoTracking()
            .Where(a => ids.Contains(a.Id) && (a.UserId == null || a.UserId == userId)).ToDictionaryAsync(a => a.Id, ct);
        if (itens.Any(i => !alimentos.ContainsKey(i.AlimentoId!))) return false;
        var total = itens.Sum(i => i.Gramas);
        double Soma(Func<DietaAlimento, double> v) => Math.Round(itens.Sum(i => v(alimentos[i.AlimentoId!]) * i.Gramas / 100) / total * 100, 2);
        receita.Kcal = Soma(a => a.Kcal);
        receita.Proteina = Soma(a => a.Proteina);
        receita.Carbo = Soma(a => a.Carbo);
        receita.Gordura = Soma(a => a.Gordura);
        receita.Fibra = Soma(a => a.Fibra);
        receita.Sodio = Soma(a => a.Sodio);
        return true;
    }

    private static async Task<byte[]> Csv(string userId, DateOnly inicio, DateOnly fim, AppDbContext db, CancellationToken ct)
    {
        var regs = await db.DietaRegistros.AsNoTracking()
            .Where(r => r.UserId == userId && r.DeletedAt == null && r.Data >= inicio && r.Data <= fim)
            .OrderBy(r => r.Data).ThenBy(r => r.CreatedAt).ToListAsync(ct);
        var inv = CultureInfo.InvariantCulture;
        var sb = new StringBuilder("data;refeicao;alimento;gramas;kcal;proteina_g;carbo_g;gordura_g;fibra_g\n");
        foreach (var r in regs)
            sb.Append(string.Join(';', r.Data.ToString("yyyy-MM-dd"), r.Refeicao, r.Nome.Replace(';', ','),
                r.QuantidadeG.ToString(inv), r.Kcal.ToString(inv), r.Proteina.ToString(inv), r.Carbo.ToString(inv),
                r.Gordura.ToString(inv), r.Fibra.ToString(inv))).Append('\n');
        // BOM para o Excel abrir os acentos certo.
        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(sb.ToString())];
    }

    public static string SemAcento(string s)
    {
        var norm = s.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(norm.Length);
        foreach (var ch in norm)
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark) sb.Append(char.ToLowerInvariant(ch));
        return sb.ToString().Replace(',', ' ');
    }

    private static bool Negativo(params double[] v) => v.Any(x => x < 0 || double.IsNaN(x) || x > 100000);

    private static DietaPerfilDto ToDto(DietaPerfil p) => new(p.AlturaCm, p.Nascimento, p.Sexo, p.Atividade, p.Objetivo,
        p.MetaKcal, p.MetaProteinaG, p.MetaCarboG, p.MetaGorduraG, p.MetaAguaMl, p.UpdatedAt);

    public static DietaAlimentoDto ToDto(DietaAlimento a) => new(a.Id, a.Nome, a.Kcal, a.Proteina, a.Carbo, a.Gordura, a.Fibra, a.Sodio,
        a.PorcaoG, a.PorcaoNome, a.CodigoBarras, a.Fonte, a.Itens, a.Favorito, a.UserId != null, a.UpdatedAt, a.DeletedAt);

    public static DietaRegistroDto ToDto(DietaRegistro r) => new(r.Id, r.Data, r.Refeicao, r.AlimentoId, r.Nome, r.QuantidadeG,
        r.Kcal, r.Proteina, r.Carbo, r.Gordura, r.Fibra, r.FotoId, r.CreatedAt, r.UpdatedAt, r.DeletedAt);

    private static DietaPlanoDto ToDto(DietaPlanoItem p) => new(p.Id, p.DiaSemana, p.Refeicao, p.AlimentoId, p.Nome, p.QuantidadeG, p.UpdatedAt, p.DeletedAt);

    private static DietaCompartilhamentoDto ToDto(DietaCompartilhamento c, HttpRequest http) => new(c.Id, c.Titulo,
        c.Escopos.Split(',', StringSplitOptions.RemoveEmptyEntries).ToList(),
        $"{http.Scheme}://{http.Host}/api/dieta/publico/{c.Token}/", c.ExpiraEm, c.RevogadoEm, c.CreatedAt);
}
