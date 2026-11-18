using System.Text.Json;

namespace Notas.Api.Services.Sistema;

public class SistemaOptions
{
    public const string SectionName = "Sistema";

    /// <summary>Arquivo que o scripts/backup.sh grava ao terminar sem erro (montado em /data/db na VPS).</summary>
    public string BackupStatus { get; set; } = "../../data/db/backup-status.json";
}

public record BackupArquivo(string Nome, long Bytes);

public record BackupEstado(bool Registrado, DateTime? ConcluidoEm, double? IdadeHoras, bool Atrasado,
    IReadOnlyList<BackupArquivo> Arquivos, long TotalBytes);

/// <summary>
/// Lê o estado do último backup. Ausente, ilegível ou mais velho que <see cref="LimiteHoras"/>
/// conta como atrasado: o cron diário roda às 04:00 e uma falha do script não atualiza o arquivo.
/// </summary>
public static class BackupStatus
{
    public const double LimiteHoras = 36;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private record Arquivo(DateTime ConcluidoEm, List<BackupArquivo>? Arquivos, long TotalBytes);

    public static BackupEstado Ler(string caminho, DateTime agoraUtc)
    {
        Arquivo? lido = null;
        try
        {
            if (File.Exists(caminho)) lido = JsonSerializer.Deserialize<Arquivo>(File.ReadAllText(caminho), Json);
        }
        catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException)
        {
            lido = null;
        }
        if (lido is null || lido.ConcluidoEm == default)
            return new BackupEstado(false, null, null, true, [], 0);

        var concluido = lido.ConcluidoEm.Kind == DateTimeKind.Utc ? lido.ConcluidoEm : lido.ConcluidoEm.ToUniversalTime();
        var idade = Math.Max(0, (agoraUtc - concluido).TotalHours);
        return new BackupEstado(true, concluido, Math.Round(idade, 1), idade > LimiteHoras, lido.Arquivos ?? [], lido.TotalBytes);
    }

    /// <summary>Uma linha para resumos (MCP / Segundo Cérebro).</summary>
    public static string Linha(BackupEstado e)
    {
        if (!e.Registrado) return "Backup: ⚠️ nenhum backup registrado (confira o cron do scripts/backup.sh).";
        var idade = Idade(e.IdadeHoras ?? 0);
        return e.Atrasado ? $"Backup: ⚠️ atrasado, o último terminou há {idade}." : $"Backup: ok, o último terminou há {idade}.";
    }

    public static string Idade(double horas)
    {
        if (horas < 1) return "menos de 1 h";
        var h = (int)Math.Floor(horas);
        if (h < 24) return $"{h} h";
        var dias = h / 24;
        var resto = h % 24;
        return (dias == 1 ? "1 dia" : $"{dias} dias") + (resto > 0 ? $" e {resto} h" : "");
    }
}
