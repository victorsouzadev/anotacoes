using Hub.Plugin;

namespace Notas.Api.Services.Painel;

/// <summary>Estados de uma etapa (data-model da spec 040).</summary>
public static class Etapas
{
    public const string Feita = "feita";
    public const string Pendente = "pendente";
    public const string Falhou = "falhou";
    public const string NaoConferida = "nao-conferida";
}

/// <summary>Uma etapa até o plug-in ficar no ar. O detalhe nunca leva segredo.</summary>
public record EtapaDoPlugin(string Nome, string Estado, string? Detalhe = null);

/// <summary>Linha do painel: calculada na leitura, nunca gravada.</summary>
public record PluginNoPainel(string Id, string Nome, string Situacao, string? Versao, string? VersaoAnterior, bool? Health,
    string? UltimaFalha, bool Congelado, int? MemoriaMb, int? LimiteMb, List<EtapaDoPlugin> Etapas);

/// <summary>Linha do <c>plugins.lock</c>: comentada = desligada.</summary>
public record LinhaDoLock(string Id, string Versao, bool Ativo);

/// <summary>O que o deployer gravou sobre o plug-in. Manifesto nulo = a primeira subida falhou.</summary>
public record EstadoDoDeployer(string Id, string Versao, string? VersaoAnterior, Manifesto? Manifesto, bool NoAr, string? UltimaFalha, bool Ativo);

/// <summary>Resposta de <c>GET /plugins/{id}/preparo</c> do deployer.</summary>
public record PreparoDoPlugin(bool Papel, bool Schema, string? DonoDoSchema, bool Conexao, bool Permissoes, bool? Conecta);

/// <summary>O que as fontes disseram de um plug-in. Nulo numa fonte = não deu para conferir.</summary>
public record FontesDoPlugin(string Id)
{
    public LinhaDoLock? Lock { get; init; }
    public bool LockLido { get; init; } = true;
    public EstadoDoDeployer? Estado { get; init; }
    /// <summary>Último health guardado pelo núcleo; nulo = nunca conferido.</summary>
    public bool? Health { get; init; }
    /// <summary>Commit candidato (a ponta da <c>main</c>), para quem está fora do registro.</summary>
    public string? Candidato { get; init; }
    /// <summary>Estado da CI do candidato; nulo = GitHub fora do ar.</summary>
    public string? Ci { get; init; }
    public bool ManifestoLido { get; init; }
    public Manifesto? Manifesto { get; init; }
    public List<string> ProblemasDoManifesto { get; init; } = [];
    public bool? Imagem { get; init; }
    public PreparoDoPlugin? Preparo { get; init; }
    public int? MemoriaMb { get; init; }
    public int? LimiteMb { get; init; }
}

/// <summary>Etapas e situação de cada plug-in (spec 040, R6): função pura.</summary>
public static class SituacaoDoPlugin
{
    public const string NoAr = "no-ar";
    public const string ComFalha = "com-falha";
    public const string Desligado = "desligado";
    public const string Pronto = "pronto";
    public const string Incompleto = "incompleto";

    public static PluginNoPainel Calcular(FontesDoPlugin f)
    {
        var m = f.Estado?.Manifesto ?? f.Manifesto;
        var etapas = f.Lock is { Ativo: true } ? EtapasDoAtivo(f) : EtapasDoCandidato(f);
        var situacao = f.Lock switch
        {
            { Ativo: true } => EstaNoAr(f) && f.Estado?.UltimaFalha is null && f.Estado?.Versao == f.Lock.Versao ? NoAr : ComFalha,
            { Ativo: false } => Desligado,
            _ => etapas.Where(e => e.Nome is not ("registro" or "no-ar")).All(e => e.Estado == Etapas.Feita) ? Pronto : Incompleto,
        };
        // Só vale a versão que está de pé; a do registro aparece na etapa quando é outra.
        var versao = f.Estado?.Versao ?? f.Lock?.Versao ?? f.Candidato;
        var health = f.Lock is { Ativo: true } ? f.Health ?? f.Estado?.NoAr : null;
        return new PluginNoPainel(f.Id, m?.Nome is { Length: > 0 } n ? n : f.Id, situacao, versao, f.Estado?.VersaoAnterior, health,
            f.Estado?.UltimaFalha, m?.Congelado ?? false, f.MemoriaMb, f.LimiteMb, etapas);
    }

    private static bool EstaNoAr(FontesDoPlugin f) => f.Health ?? f.Estado?.NoAr ?? false;

    private static List<EtapaDoPlugin> EtapasDoAtivo(FontesDoPlugin f)
    {
        var e = new List<EtapaDoPlugin>();
        if (!EstaNoAr(f)) e.AddRange(EtapasDoBanco(f.Id, f.Preparo));
        e.Add(new("registro", Etapas.Feita, f.Estado is { } s && s.Versao != f.Lock!.Versao ? $"o registro pede {f.Lock.Versao}" : null));
        e.Add(f.Estado switch
        {
            null => new("no-ar", Etapas.Pendente, "o deployer ainda não leu esta linha do registro"),
            { UltimaFalha: { } falha } => new("no-ar", Etapas.Falhou, falha),
            { } outra when outra.Versao != f.Lock!.Versao => new("no-ar", Etapas.Pendente, "o deployer ainda não trocou a versão"),
            _ => EstaNoAr(f) ? new("no-ar", Etapas.Feita) : new("no-ar", Etapas.Falhou, "o health não responde"),
        });
        return e;
    }

    private static List<EtapaDoPlugin> EtapasDoCandidato(FontesDoPlugin f)
    {
        var e = new List<EtapaDoPlugin>
        {
            f.Ci is null ? new("ci", Etapas.NaoConferida) : new("ci", f.Ci, f.Ci switch
            {
                Etapas.Falhou => "a CI da main falhou",
                Etapas.Pendente => "a CI da main ainda não terminou",
                _ => null,
            }),
            !f.ManifestoLido ? new("manifesto", Etapas.NaoConferida)
                : f.ProblemasDoManifesto.Count > 0 ? new("manifesto", Etapas.Falhou, string.Join("; ", f.ProblemasDoManifesto))
                : new("manifesto", Etapas.Feita),
            new("imagem", f.Imagem switch { true => Etapas.Feita, false => Etapas.Pendente, null => Etapas.NaoConferida },
                f.Imagem == false ? "a imagem deste commit não foi publicada" : null),
        };
        e.AddRange(EtapasDoBanco(f.Id, f.Preparo));
        e.Add(new("registro", f.LockLido ? Etapas.Pendente : Etapas.NaoConferida, f.Lock is { Ativo: false } ? "desligado no registro" : null));
        e.Add(new("no-ar", Etapas.Pendente));
        return e;
    }

    private static List<EtapaDoPlugin> EtapasDoBanco(string id, PreparoDoPlugin? p)
    {
        if (p is null) return [.. new[] { "papel", "schema", "conexao", "permissoes" }.Select(n => new EtapaDoPlugin(n, Etapas.NaoConferida))];
        static string Sim(bool v) => v ? Etapas.Feita : Etapas.Pendente;
        return
        [
            new("papel", Sim(p.Papel)),
            p.Schema && p.DonoDoSchema != id ? new("schema", Etapas.Falhou, "o dono do schema é outro") : new("schema", Sim(p.Schema)),
            p.Conecta == false ? new("conexao", Etapas.Falhou, "o arquivo existe, mas a conexão não abre") : new("conexao", Sim(p.Conexao),
                    p is { Papel: true, Conexao: false } ? "o papel existe, mas falta o arquivo de conexão" : null),
            new("permissoes", Sim(p.Permissoes)),
        ];
    }
}
