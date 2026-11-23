namespace Notas.Api.Services.Agente;

/// <summary>
/// Tira dos logs as linhas que podem ter segredo antes de mandá-los ao agente (spec 039). Função pura: a linha
/// inteira sai, trocada por um aviso, para não sobrar pedaço do valor.
/// </summary>
public static class LimpezaDeLog
{
    public static readonly string[] Marcas = ["Password=", "Bearer ", "ApiKey"];
    public const string Aviso = "[linha removida: pode ter segredo]";

    public static string Limpar(string texto) =>
        string.Join('\n', texto.Split('\n').Select(l =>
            Marcas.Any(m => l.Contains(m, StringComparison.OrdinalIgnoreCase)) ? Aviso : l));
}
