namespace Notas.Api.Data;

// Ferramenta "Dieta". Ids gerados no cliente (UUID), como nas Tarefas: o app Android é local-first e
// sincroniza por PUT idempotente com "quem editou por último vence" (UpdatedAt). DeletedAt é o tombstone.

/// <summary>Perfil e metas. Uma linha por usuário. Meta zerada = usar a sugestão calculada.</summary>
public class DietaPerfil
{
    public string UserId { get; set; } = "";
    public double AlturaCm { get; set; }
    public DateOnly? Nascimento { get; set; }
    /// <summary>"M" ou "F" — só entra na fórmula de Mifflin-St Jeor.</summary>
    public string Sexo { get; set; } = "M";
    /// <summary>Fator de atividade (1.2 sedentário … 1.9 muito ativo).</summary>
    public double Atividade { get; set; } = 1.375;
    /// <summary>perder, manter ou ganhar.</summary>
    public string Objetivo { get; set; } = "manter";
    public int MetaKcal { get; set; }
    public int MetaProteinaG { get; set; }
    public int MetaCarboG { get; set; }
    public int MetaGorduraG { get; set; }
    public int MetaAguaMl { get; set; }
    /// <summary>
    /// O que a pessoa contou na entrevista do plano (rotina, gostos, aversões, restrições, orçamento…), em texto livre.
    /// O chat lê antes de sugerir qualquer coisa, para não repetir perguntas.
    /// </summary>
    public string? Preferencias { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// Alimento com valores por 100 g. UserId nulo = base TACO (compartilhada, só leitura). Receita é um
/// alimento com Itens (JSON [{alimentoId, nome, gramas}]): o servidor recalcula os valores por 100 g.
/// </summary>
public class DietaAlimento
{
    public string Id { get; set; } = "";
    public string? UserId { get; set; }
    public string Nome { get; set; } = "";
    public double Kcal { get; set; }
    public double Proteina { get; set; }
    public double Carbo { get; set; }
    public double Gordura { get; set; }
    public double Fibra { get; set; }
    public double Sodio { get; set; }
    /// <summary>Porção de referência (ex.: "1 unidade" = 50 g). Só atalho de digitação.</summary>
    public double PorcaoG { get; set; } = 100;
    public string? PorcaoNome { get; set; }
    public string? CodigoBarras { get; set; }
    /// <summary>taco, off (Open Food Facts), manual ou receita.</summary>
    public string Fonte { get; set; } = "manual";
    public string? Itens { get; set; }
    public bool Favorito { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}

/// <summary>Um alimento comido. Nome e valores ficam copiados: editar o alimento não reescreve o passado.</summary>
public class DietaRegistro
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public DateOnly Data { get; set; }
    /// <summary>cafe, almoco, lanche, jantar ou ceia.</summary>
    public string Refeicao { get; set; } = "almoco";
    public string? AlimentoId { get; set; }
    public string Nome { get; set; } = "";
    public double QuantidadeG { get; set; }
    public double Kcal { get; set; }
    public double Proteina { get; set; }
    public double Carbo { get; set; }
    public double Gordura { get; set; }
    public double Fibra { get; set; }
    public string? FotoId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}

public class DietaPeso
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public DateOnly Data { get; set; }
    public double Kg { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}

/// <summary>Um copo/garrafa. O total do dia é a soma.</summary>
public class DietaAgua
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public DateOnly Data { get; set; }
    public int Ml { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}

/// <summary>Item do plano alimentar (cardápio previsto). DiaSemana -1 = todos os dias; 0 = domingo.</summary>
public class DietaPlanoItem
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public int DiaSemana { get; set; } = -1;
    public string Refeicao { get; set; } = "almoco";
    public string? AlimentoId { get; set; }
    public string Nome { get; set; } = "";
    public double QuantidadeG { get; set; }
    /// <summary>Variação da refeição (1, 2, 3…): cada opção é um conjunto de itens equivalente nas metas; a pessoa escolhe uma por dia.</summary>
    public int Opcao { get; set; } = 1;
    /// <summary>Dica de troca ou preparo, ex.: "pode trocar por batata-doce".</summary>
    public string? Observacao { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}

/// <summary>Foto de refeição ou de progresso corporal. Só registro: nenhuma análise da imagem.</summary>
public class DietaFoto
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public DateOnly Data { get; set; }
    /// <summary>refeicao ou corpo.</summary>
    public string Tipo { get; set; } = "refeicao";
    /// <summary>Refeição (cafe, almoco…) ou pose (frente, lado, costas), conforme o tipo.</summary>
    public string? Rotulo { get; set; }
    public string ContentType { get; set; } = "image/jpeg";
    public int SizeBytes { get; set; }
    // BLOB no próprio SQLite: escala pessoal, e a foto entra no backup do banco sem passo extra.
    public byte[] Conteudo { get; set; } = [];
    public DateTime CreatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}

/// <summary>Link público de progresso. Escopos separados por vírgula (ver DietaEscopos).</summary>
public class DietaCompartilhamento
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Token { get; set; } = "";
    public string Titulo { get; set; } = "";
    public string Escopos { get; set; } = "";
    public DateTime? ExpiraEm { get; set; }
    public DateTime? RevogadoEm { get; set; }
    public DateTime CreatedAt { get; set; }
}

public static class DietaEscopos
{
    public const string Peso = "peso";
    public const string Macros = "macros";
    public const string Diario = "diario";
    public const string FotosRefeicao = "fotos_refeicao";
    public const string FotosCorpo = "fotos_corpo";
    public const string Conquistas = "conquistas";
    public const string Exportar = "exportar";
    /// <summary>Só o dia atual: totais contra a meta, refeições item a item e as fotos de refeição do dia.</summary>
    public const string Hoje = "hoje";

    public static readonly string[] Todos = [Hoje, Peso, Macros, Diario, FotosRefeicao, FotosCorpo, Conquistas, Exportar];
}
