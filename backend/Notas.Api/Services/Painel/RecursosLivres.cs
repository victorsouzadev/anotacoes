namespace Notas.Api.Services.Painel;

public record MemoriaLida(string Id, int MemoriaMb, int LimiteMb);

/// <summary>Resposta de <c>GET /recursos</c> do deployer. Nulo = não deu para ler.</summary>
public record RecursosDoDeployer(int? MemoriaTotalMb, int? MemoriaLivreMb, List<MemoriaLida>? Plugins, int? Conexoes, int? ConexoesMaximas);

/// <summary>Recursos e avisos que a tela mostra (spec 040, R8). O aviso não bloqueia nada.</summary>
public record RecursosDoPainel(int? MemoriaLivreMb, int? MemoriaTotalMb, int LimiteDoPluginMb, int? ConexoesLivres, int PoolsSomados, List<string> Avisos);

public static class RecursosLivres
{
    public const int LimiteDoPluginMb = 256;
    private const int PoolDoPlugin = 3;
    private const int PoolDoNucleo = 10;
    private const int Reserva = 6;

    /// <param name="ligados">Plug-ins ligados no registro; o cálculo já soma mais um.</param>
    public static RecursosDoPainel Calcular(RecursosDoDeployer? r, int ligados)
    {
        var pools = PoolDoNucleo + PoolDoPlugin * (ligados + 1);
        int? livres = r is { Conexoes: { } c, ConexoesMaximas: { } max } ? Math.Max(0, max - c) : null;
        var avisos = new List<string>();
        if (r?.MemoriaLivreMb is { } mem && mem < LimiteDoPluginMb)
            avisos.Add($"Memória livre: {mem} MB. Um plug-in novo pode usar até {LimiteDoPluginMb} MB.");
        if (r?.ConexoesMaximas is { } m && pools > m - Reserva)
            avisos.Add($"Com mais um plug-in, as conexões reservadas somam {pools} de {m} do banco.");
        return new RecursosDoPainel(r?.MemoriaLivreMb, r?.MemoriaTotalMb, LimiteDoPluginMb, livres, pools, avisos);
    }
}
