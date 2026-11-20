using System.Text.Json;

namespace Notas.Api.Services.Sistema;

public class SistemaOptions
{
    public const string SectionName = "Sistema";

    /// <summary>Arquivo que o scripts/backup.sh grava ao terminar sem erro (montado em /data/db na VPS).</summary>
    public string BackupStatus { get; set; } = "../../data/db/backup-status.json";

    /// <summary>Arquivo da cópia fora da VPS e da conferência semanal (spec 036), gravado pelos scripts do host.</summary>
    public string BackupExterno { get; set; } = "../../data/db/backup-externo.json";
}

public record BackupArquivo(string Nome, long Bytes);

public record BackupFalha(DateTime Em, string Erro);

/// <summary>Cópia fora da VPS (spec 036). <c>ConcluidoEm</c> é sempre o último sucesso.</summary>
public record BackupExternoEstado(bool Registrado, DateTime? ConcluidoEm, double? IdadeHoras, bool Atrasado,
    BackupFalha? UltimaFalha, long BytesTotal);

/// <summary>Conferência semanal da restauração (spec 036).</summary>
public record BackupConferenciaEstado(bool Registrado, DateTime? ConcluidoEm, double? IdadeHoras, bool Atrasado, bool Ok);

public record BackupEstado(bool Registrado, DateTime? ConcluidoEm, double? IdadeHoras, bool Atrasado,
    IReadOnlyList<BackupArquivo> Arquivos, long TotalBytes,
    BackupExternoEstado? Externo = null, BackupConferenciaEstado? Conferencia = null);

/// <summary>
/// Lê o estado do último backup. Ausente, ilegível ou mais velho que <see cref="LimiteHoras"/>
/// conta como atrasado: o cron diário roda às 04:00 e uma falha do script não atualiza o arquivo.
/// </summary>
public static class BackupStatus
{
    public const double LimiteHoras = 36;

    /// <summary>A conferência roda aos domingos; mais de 8 dias sem ela é atraso.</summary>
    public const double LimiteConferenciaHoras = 8 * 24;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private record ParteExterna(DateTime? ConcluidoEm, bool? Ok, long? BytesTotal, DateTime? FalhaEm, string? Erro);
    private record ArquivoExterno(ParteExterna? Copia, ParteExterna? Conferencia);

    private static T? LerJson<T>(string caminho) where T : class
    {
        try
        {
            return File.Exists(caminho) ? JsonSerializer.Deserialize<T>(File.ReadAllText(caminho), Json) : null;
        }
        catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>Mensagem de erro do script, limitada; o script já não grava segredos (FR-012).</summary>
    private static string Curto(string? erro)
    {
        var m = string.IsNullOrWhiteSpace(erro) ? "erro sem mensagem" : erro.Trim();
        return m.Length > 300 ? m[..300] : m;
    }

    private static DateTime Utc(DateTime d) => d.Kind == DateTimeKind.Utc ? d : d.ToUniversalTime();

    /// <summary>Estado local (025) mais a cópia externa e a conferência (036).</summary>
    public static BackupEstado LerCompleto(SistemaOptions o, DateTime agoraUtc)
    {
        var local = Ler(o.BackupStatus, agoraUtc);
        var ext = LerJson<ArquivoExterno>(o.BackupExterno);

        BackupExternoEstado externo = new(false, null, null, true, null, 0);
        if (ext?.Copia is { } c)
        {
            var falha = c.Ok == false && c.FalhaEm is { } f
                ? new BackupFalha(Utc(f), Curto(c.Erro))
                : null;
            if (c.ConcluidoEm is { } ok && ok != default)
            {
                var idade = Math.Max(0, (agoraUtc - Utc(ok)).TotalHours);
                externo = new(true, Utc(ok), Math.Round(idade, 1), idade > LimiteHoras, falha, c.BytesTotal ?? 0);
            }
            else externo = externo with { UltimaFalha = falha };
        }

        BackupConferenciaEstado conferencia = new(false, null, null, true, false);
        if (ext?.Conferencia is { ConcluidoEm: { } feita } cf && feita != default)
        {
            var idade = Math.Max(0, (agoraUtc - Utc(feita)).TotalHours);
            var ok = cf.Ok == true;
            conferencia = new(true, Utc(feita), Math.Round(idade, 1), !ok || idade > LimiteConferenciaHoras, ok);
        }

        return local with { Externo = externo, Conferencia = conferencia };
    }

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

    /// <summary>Linhas para resumos (MCP / Segundo Cérebro): uma por problema, ou uma só quando está tudo em dia.</summary>
    public static string Linha(BackupEstado e)
    {
        var local = LinhaLocal(e);
        if (e.Externo is null || e.Conferencia is null) return local;

        var problemas = new List<string>();
        if (e.Atrasado) problemas.Add(local);
        var x = e.Externo;
        if (!x.Registrado) problemas.Add("Backup: ⚠️ cópia externa nunca registrada (confira o scripts/backup-externo.sh).");
        else if (x.Atrasado) problemas.Add($"Backup: ⚠️ cópia externa atrasada, a última terminou há {Idade(x.IdadeHoras ?? 0)}.");
        var c = e.Conferencia;
        if (!c.Registrado) problemas.Add("Backup: ⚠️ restauração nunca conferida (confira o scripts/backup-conferir.sh).");
        else if (!c.Ok) problemas.Add("Backup: ⚠️ a última conferência da restauração falhou.");
        else if (c.Atrasado) problemas.Add($"Backup: ⚠️ restauração não conferida há {Idade(c.IdadeHoras ?? 0)}.");
        if (problemas.Count > 0) return string.Join('\n', problemas);

        return $"Backup: ok, local há {Idade(e.IdadeHoras ?? 0)}, cópia externa há {Idade(x.IdadeHoras ?? 0)}, " +
               $"restauração conferida há {Idade(c.IdadeHoras ?? 0)}.";
    }

    private static string LinhaLocal(BackupEstado e)
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
