using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Endpoints;
using Notas.Api.Services.Financas.Chat;

namespace Notas.Api.Services.Dieta.Ia;

/// <summary>
/// O que o chat da Dieta pode fazer com os dados do usuário: consultar (perfil, metas, dias, plano, alimentos) e
/// alterar (metas, plano alimentar, registros, alimentos novos). As alterações gravam com UpdatedAt de agora, então
/// o app recebe tudo no próximo sync.
/// </summary>
public class FerramentasDieta(AppDbContext db, DietaProgresso prog)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const int LimiteResultado = 30_000;

    /// <summary>Ferramentas que gravam: se o modelo chamou alguma, o app sincroniza depois da resposta.</summary>
    public static readonly HashSet<string> Escrita =
        ["definir_metas", "definir_plano", "adicionar_item_plano", "remover_item_plano", "registrar_refeicao", "criar_alimento", "salvar_preferencias"];

    private static readonly string Refeicoes = string.Join(", ", DietaEndpoints.Refeicoes);

    public static readonly IReadOnlyList<DefinicaoFerramenta> Definicoes =
    [
        new("perfil_e_metas", "Perfil (altura, idade, sexo, atividade, objetivo), peso atual, metas em vigor e a sugestão calculada.", Schema(new())),
        new("resumo_periodo", "Totais por dia (kcal, proteína, carbo, gordura, fibra, água, metas batidas) entre duas datas, até 92 dias.",
            Schema(new() { ["de"] = Texto("Data inicial AAAA-MM-DD"), ["ate"] = Texto("Data final AAAA-MM-DD") }, "de", "ate")),
        new("dia", "O que foi registrado num dia, por refeição, com os valores de cada item.",
            Schema(new() { ["data"] = Texto("AAAA-MM-DD") }, "data")),
        new("plano_atual", "O plano alimentar (cardápio previsto) com ids, dia da semana (-1 = todos, 0 = domingo … 6 = sábado), refeição, opção (variação), gramas e observação.", Schema(new())),
        new("salvar_preferencias",
            "Guarda no perfil, em texto corrido, o que a pessoa contou sobre rotina, horários, gostos, aversões, restrições, alergias, "
            + "orçamento, onde come, tempo de preparo e treino. Substitui o texto anterior: inclua o que já havia e continua valendo.",
            Schema(new() { ["texto"] = Texto("Resumo objetivo das preferências, até ~1500 caracteres") }, "texto")),
        new("buscar_alimento",
            "Procura alimentos na tabela TACO e nos cadastrados pelo usuário. Devolve id e valores por 100 g. "
            + "Use antes de montar plano ou registrar, para usar ids reais.",
            Schema(new() { ["texto"] = Texto("Palavras do nome, ex.: 'frango grelhado', 'arroz integral'") }, "texto")),
        new("definir_metas", "Grava as metas diárias. Campo omitido fica como está; 0 volta a usar a sugestão calculada.",
            Schema(new()
            {
                ["kcal"] = Inteiro("Calorias"), ["proteina_g"] = Inteiro("Proteína em g"), ["carbo_g"] = Inteiro("Carboidrato em g"),
                ["gordura_g"] = Inteiro("Gordura em g"), ["agua_ml"] = Inteiro("Água em ml"),
            })),
        new("definir_plano",
            "Substitui o plano alimentar. Com dia_semana, troca só os itens daquele dia; sem, troca o plano inteiro. "
            + $"Refeições: {Refeicoes}. Use alimento_id de buscar_alimento sempre que houver. Cada refeição pode ter "
            + "variações: itens com a mesma opcao formam uma opção completa (1, 2, 3…), e as opções devem ser equivalentes em calorias e proteína.",
            Schema(new()
            {
                ["dia_semana"] = Inteiro("Opcional: -1 todos os dias, 0 domingo … 6 sábado"),
                ["itens"] = new JsonObject
                {
                    ["type"] = "array",
                    ["items"] = Schema(new()
                    {
                        ["dia_semana"] = Inteiro("-1 todos os dias, 0 domingo … 6 sábado"),
                        ["refeicao"] = Texto(Refeicoes), ["alimento_id"] = Texto("Id de buscar_alimento"),
                        ["nome"] = Texto("Nome do alimento"), ["gramas"] = new JsonObject { ["type"] = "number" },
                        ["opcao"] = Inteiro("Variação da refeição: 1, 2, 3… (padrão 1)"),
                        ["observacao"] = Texto("Opcional: troca ou preparo, ex.: 'pode trocar por batata-doce'"),
                    }, "dia_semana", "refeicao", "nome", "gramas"),
                },
            }, "itens")),
        new("adicionar_item_plano", "Acrescenta um item ao plano alimentar.",
            Schema(new()
            {
                ["dia_semana"] = Inteiro("-1 todos os dias, 0 domingo … 6 sábado"), ["refeicao"] = Texto(Refeicoes),
                ["alimento_id"] = Texto("Id de buscar_alimento"), ["nome"] = Texto("Nome"), ["gramas"] = new JsonObject { ["type"] = "number" },
                ["opcao"] = Inteiro("Variação da refeição (padrão 1)"), ["observacao"] = Texto("Opcional: troca ou preparo"),
            }, "dia_semana", "refeicao", "nome", "gramas")),
        new("remover_item_plano", "Remove um item do plano pelo id (de plano_atual).", Schema(new() { ["id"] = Texto("Id do item") }, "id")),
        new("registrar_refeicao", "Registra no diário um alimento comido. Os valores saem do alimento pela quantidade.",
            Schema(new()
            {
                ["alimento_id"] = Texto("Id de buscar_alimento"), ["gramas"] = new JsonObject { ["type"] = "number" },
                ["refeicao"] = Texto(Refeicoes), ["data"] = Texto("AAAA-MM-DD; padrão hoje"),
            }, "alimento_id", "gramas", "refeicao")),
        new("criar_alimento", "Cadastra um alimento do usuário com valores por 100 g, quando não existe na busca.",
            Schema(new()
            {
                ["nome"] = Texto("Nome"), ["kcal"] = new JsonObject { ["type"] = "number" }, ["proteina"] = new JsonObject { ["type"] = "number" },
                ["carbo"] = new JsonObject { ["type"] = "number" }, ["gordura"] = new JsonObject { ["type"] = "number" },
                ["fibra"] = new JsonObject { ["type"] = "number" }, ["porcao_g"] = new JsonObject { ["type"] = "number" },
                ["porcao_nome"] = Texto("Ex.: '1 fatia'"),
            }, "nome", "kcal", "proteina", "carbo", "gordura")),
    ];

    public async Task<string> ExecutarAsync(string userId, string nome, JsonObject? a, CancellationToken ct)
    {
        try
        {
            object r = nome switch
            {
                "perfil_e_metas" => await PerfilEMetas(userId, ct),
                "resumo_periodo" => await Periodo(userId, Data(a, "de"), Data(a, "ate"), ct),
                "dia" => await Dia(userId, Data(a, "data"), ct),
                "plano_atual" => await Plano(userId, ct),
                "buscar_alimento" => (await Buscar(db, userId, Str(a, "texto") ?? "", 15, ct)).Select(Alimento),
                "definir_metas" => await DefinirMetas(userId, a, ct),
                "definir_plano" => await DefinirPlano(userId, a, ct),
                "adicionar_item_plano" => await AdicionarPlano(userId, a!, ct),
                "remover_item_plano" => await RemoverPlano(userId, Str(a, "id") ?? "", ct),
                "registrar_refeicao" => await Registrar(userId, a!, ct),
                "criar_alimento" => await CriarAlimento(userId, a!, ct),
                "salvar_preferencias" => await SalvarPreferencias(userId, Str(a, "texto") ?? "", ct),
                _ => new { erro = $"ferramenta desconhecida: {nome}" },
            };
            var json = JsonSerializer.Serialize(r, Json);
            return json.Length > LimiteResultado ? json[..LimiteResultado] + "… [cortado]" : json;
        }
        catch (Exception e) when (e is ArgumentException or FormatException or InvalidOperationException or NullReferenceException)
        {
            return JsonSerializer.Serialize(new { erro = e.Message }, Json);
        }
    }

    /// <summary>Busca sem acento e por palavras, preferindo favoritos, alimentos próprios e nomes curtos.</summary>
    public static async Task<List<DietaAlimento>> Buscar(AppDbContext db, string userId, string texto, int limite, CancellationToken ct)
    {
        var termos = DietaEndpoints.SemAcento(texto).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (termos.Length == 0) return [];
        var todos = await db.DietaAlimentos.AsNoTracking()
            .Where(x => (x.UserId == null || x.UserId == userId) && x.DeletedAt == null).ToListAsync(ct);
        return todos.Where(x => termos.All(t => DietaEndpoints.SemAcento(x.Nome).Contains(t)))
            .OrderByDescending(x => x.Favorito).ThenByDescending(x => x.UserId != null)
            .ThenBy(x => DietaEndpoints.SemAcento(x.Nome).StartsWith(termos[0]) ? 0 : 1).ThenBy(x => x.Nome.Length)
            .Take(limite).ToList();
    }

    private static object Alimento(DietaAlimento x) => new
    {
        id = x.Id, nome = x.Nome, kcal = x.Kcal, proteina = x.Proteina, carbo = x.Carbo, gordura = x.Gordura, fibra = x.Fibra,
        porcao = x.PorcaoNome is null ? null : $"{x.PorcaoNome} = {x.PorcaoG:0} g",
    };

    private async Task<object> PerfilEMetas(string userId, CancellationToken ct)
    {
        var (perfil, peso, metas) = await prog.Metas(userId, ct);
        var idade = perfil?.Nascimento is { } n ? prog.Hoje().Year - n.Year - (prog.Hoje() < n.AddYears(prog.Hoje().Year - n.Year) ? 1 : 0) : (int?)null;
        return new
        {
            perfil = perfil is null ? null : new { perfil.AlturaCm, idade, perfil.Sexo, perfil.Atividade, perfil.Objetivo },
            preferencias = perfil?.Preferencias,
            pesoAtualKg = peso, metas, sugestao = DietaMetas.Sugerir(perfil, peso, prog.Hoje()),
            metasFixadasPeloUsuario = perfil is null ? null : new { perfil.MetaKcal, perfil.MetaProteinaG, perfil.MetaCarboG, perfil.MetaGorduraG, perfil.MetaAguaMl },
        };
    }

    private async Task<object> Periodo(string userId, DateOnly de, DateOnly ate, CancellationToken ct)
    {
        if (ate < de) (de, ate) = (ate, de);
        if (ate.DayNumber - de.DayNumber > 92) de = ate.AddDays(-92);
        var (_, _, metas) = await prog.Metas(userId, ct);
        var dias = (await prog.Dias(userId, de, ate, metas, ct)).Where(d => d.Registros > 0).ToList();
        return new { metas, dias, diasComRegistro = dias.Count };
    }

    private async Task<object> Dia(string userId, DateOnly data, CancellationToken ct) => new
    {
        data,
        itens = await db.DietaRegistros.AsNoTracking().Where(r => r.UserId == userId && r.Data == data && r.DeletedAt == null)
            .OrderBy(r => r.CreatedAt)
            .Select(r => new { r.Refeicao, r.Nome, r.QuantidadeG, r.Kcal, r.Proteina, r.Carbo, r.Gordura }).ToListAsync(ct),
    };

    private async Task<object> Plano(string userId, CancellationToken ct) =>
        await db.DietaPlano.AsNoTracking().Where(p => p.UserId == userId && p.DeletedAt == null)
            .OrderBy(p => p.DiaSemana).ThenBy(p => p.Refeicao).ThenBy(p => p.Opcao)
            .Select(p => new { p.Id, p.DiaSemana, p.Refeicao, p.Opcao, p.AlimentoId, p.Nome, gramas = p.QuantidadeG, p.Observacao })
            .ToListAsync(ct);

    private async Task<object> DefinirMetas(string userId, JsonObject? a, CancellationToken ct)
    {
        var perfil = await db.DietaPerfis.FirstOrDefaultAsync(p => p.UserId == userId, ct);
        if (perfil is null) db.DietaPerfis.Add(perfil = new DietaPerfil { UserId = userId });
        int? V(string k) => Int(a, k) is { } v ? Math.Clamp(v, 0, 20000) : null;
        perfil.MetaKcal = V("kcal") ?? perfil.MetaKcal;
        perfil.MetaProteinaG = V("proteina_g") ?? perfil.MetaProteinaG;
        perfil.MetaCarboG = V("carbo_g") ?? perfil.MetaCarboG;
        perfil.MetaGorduraG = V("gordura_g") ?? perfil.MetaGorduraG;
        perfil.MetaAguaMl = V("agua_ml") ?? perfil.MetaAguaMl;
        perfil.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return new { ok = true, metas = (await prog.Metas(userId, ct)).Metas };
    }

    private async Task<object> DefinirPlano(string userId, JsonObject? a, CancellationToken ct)
    {
        var itens = a?["itens"] as JsonArray ?? throw new ArgumentException("itens é obrigatório");
        var dia = Int(a, "dia_semana");
        var agora = DateTime.UtcNow;
        var antigos = await db.DietaPlano.Where(p => p.UserId == userId && p.DeletedAt == null && (dia == null || p.DiaSemana == dia)).ToListAsync(ct);
        foreach (var p in antigos) { p.DeletedAt = agora; p.UpdatedAt = agora; }
        var novos = new List<DietaPlanoItem>();
        foreach (var i in itens.OfType<JsonObject>())
            novos.Add(await NovoItemPlano(userId, i, agora, ct));
        db.DietaPlano.AddRange(novos);
        await db.SaveChangesAsync(ct);
        return new { ok = true, removidos = antigos.Count, adicionados = novos.Count };
    }

    private async Task<object> AdicionarPlano(string userId, JsonObject a, CancellationToken ct)
    {
        var item = await NovoItemPlano(userId, a, DateTime.UtcNow, ct);
        db.DietaPlano.Add(item);
        await db.SaveChangesAsync(ct);
        return new { ok = true, id = item.Id };
    }

    private async Task<DietaPlanoItem> NovoItemPlano(string userId, JsonObject a, DateTime agora, CancellationToken ct)
    {
        var refeicao = Str(a, "refeicao") ?? "";
        if (!DietaEndpoints.Refeicoes.Contains(refeicao)) throw new ArgumentException($"refeição inválida: {refeicao}");
        var dia = Int(a, "dia_semana") ?? -1;
        if (dia is < -1 or > 6) throw new ArgumentException("dia_semana deve ir de -1 a 6");
        var gramas = Num(a, "gramas") ?? 0;
        if (gramas is <= 0 or > 5000) throw new ArgumentException("gramas inválido");
        var alimentoId = Str(a, "alimento_id");
        var nome = Str(a, "nome")?.Trim() ?? "";
        if (alimentoId is not null)
        {
            var al = await db.DietaAlimentos.AsNoTracking().FirstOrDefaultAsync(x => x.Id == alimentoId && (x.UserId == null || x.UserId == userId), ct);
            if (al is null) alimentoId = null;
            else if (nome.Length == 0) nome = al.Nome;
        }
        if (nome.Length is 0 or > 200) throw new ArgumentException("nome inválido");
        return new DietaPlanoItem
        {
            Id = Guid.NewGuid().ToString(), UserId = userId, DiaSemana = dia, Refeicao = refeicao, AlimentoId = alimentoId,
            Nome = nome, QuantidadeG = gramas, UpdatedAt = agora,
            Opcao = Math.Clamp(Int(a, "opcao") ?? 1, 1, 9),
            Observacao = Str(a, "observacao") is { } o ? (o.Length > 300 ? o[..300] : o.Trim()) : null,
        };
    }

    private async Task<object> SalvarPreferencias(string userId, string texto, CancellationToken ct)
    {
        if (texto.Trim().Length == 0) throw new ArgumentException("texto vazio");
        var perfil = await db.DietaPerfis.FirstOrDefaultAsync(p => p.UserId == userId, ct);
        if (perfil is null) db.DietaPerfis.Add(perfil = new DietaPerfil { UserId = userId });
        perfil.Preferencias = texto.Length > 4000 ? texto[..4000] : texto.Trim();
        perfil.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return new { ok = true };
    }

    private async Task<object> RemoverPlano(string userId, string id, CancellationToken ct)
    {
        var p = await db.DietaPlano.FirstOrDefaultAsync(x => x.Id == id && x.UserId == userId && x.DeletedAt == null, ct);
        if (p is null) return new { erro = "item não encontrado" };
        p.DeletedAt = p.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return new { ok = true };
    }

    private async Task<object> Registrar(string userId, JsonObject a, CancellationToken ct)
    {
        var refeicao = Str(a, "refeicao") ?? "";
        if (!DietaEndpoints.Refeicoes.Contains(refeicao)) throw new ArgumentException($"refeição inválida: {refeicao}");
        var gramas = Num(a, "gramas") ?? 0;
        if (gramas is <= 0 or > 5000) throw new ArgumentException("gramas inválido");
        var id = Str(a, "alimento_id");
        var al = await db.DietaAlimentos.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && (x.UserId == null || x.UserId == userId) && x.DeletedAt == null, ct)
            ?? throw new ArgumentException("alimento não encontrado; use buscar_alimento");
        var data = Str(a, "data") is null ? prog.Hoje() : Data(a, "data");
        var agora = DateTime.UtcNow;
        var r = new DietaRegistro { Id = Guid.NewGuid().ToString(), UserId = userId, Data = data, Refeicao = refeicao, AlimentoId = al.Id, QuantidadeG = gramas, CreatedAt = agora, UpdatedAt = agora };
        DietaEndpoints.Aplicar(r, al, gramas);
        db.DietaRegistros.Add(r);
        await db.SaveChangesAsync(ct);
        return new { ok = true, r.Nome, r.Kcal, data };
    }

    private async Task<object> CriarAlimento(string userId, JsonObject a, CancellationToken ct)
    {
        var nome = Str(a, "nome")?.Trim() ?? "";
        if (nome.Length is 0 or > 200) throw new ArgumentException("nome inválido");
        double N(string k) => Math.Clamp(Num(a, k) ?? 0, 0, 1000);
        var al = new DietaAlimento
        {
            Id = Guid.NewGuid().ToString(), UserId = userId, Nome = nome, Kcal = N("kcal"), Proteina = N("proteina"), Carbo = N("carbo"),
            Gordura = N("gordura"), Fibra = N("fibra"), PorcaoG = Num(a, "porcao_g") is { } g and > 0 ? g : 100,
            PorcaoNome = Str(a, "porcao_nome"), Fonte = "manual", UpdatedAt = DateTime.UtcNow,
        };
        db.DietaAlimentos.Add(al);
        await db.SaveChangesAsync(ct);
        return new { ok = true, id = al.Id };
    }

    private static string? Str(JsonObject? a, string k) => a?[k] is JsonValue v && v.TryGetValue<string>(out var s) && !string.IsNullOrWhiteSpace(s) ? s : null;
    private static double? Num(JsonObject? a, string k) => a?[k] is JsonValue v ? (v.TryGetValue<double>(out var d) ? d : v.TryGetValue<string>(out var s) && double.TryParse(s, CultureInfo.InvariantCulture, out d) ? d : null) : null;
    private static int? Int(JsonObject? a, string k) => Num(a, k) is { } d ? (int)Math.Round(d) : null;
    private static DateOnly Data(JsonObject? a, string k) =>
        DateOnly.TryParseExact(Str(a, k), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : throw new ArgumentException($"{k} deve ser AAAA-MM-DD");

    private static JsonObject Texto(string d) => new() { ["type"] = "string", ["description"] = d };
    private static JsonObject Inteiro(string d) => new() { ["type"] = "integer", ["description"] = d };
    private static JsonObject Schema(JsonObject props, params string[] obrigatorios) => new()
    {
        ["type"] = "object", ["properties"] = props,
        ["required"] = new JsonArray(obrigatorios.Select(o => (JsonNode)o).ToArray()),
    };
}
