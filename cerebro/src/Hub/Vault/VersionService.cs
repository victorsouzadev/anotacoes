using Hub.Core;
using Hub.Index;

namespace Hub.Vault;

public sealed record RestoreReport(int Restored, int Trashed, IReadOnlyList<string> Paths);

/// <summary>
/// Restaura versões a partir do histórico git. Antes de qualquer restauração o estado atual é
/// commitado, então restaurar também pode ser desfeito (restaurando a versão anterior a ela).
/// Só mexe em notas .md: anexos e configurações do Obsidian ficam como estão.
/// </summary>
public sealed class VersionService
{
    private readonly GitSnapshotter _git;
    private readonly VaultStore _vault;
    private readonly NoteIndex _index;

    public VersionService(GitSnapshotter git, VaultStore vault, NoteIndex index)
    {
        _git = git;
        _vault = vault;
        _index = index;
    }

    private void RequireReady()
    {
        if (!_git.Ready) throw new InvalidOperationException("Histórico indisponível (git desligado ou ainda iniciando).");
    }

    /// <summary>Volta UMA nota para o conteúdo que ela tinha numa versão (recria se tiver sido apagada).</summary>
    public async Task<string> RestoreNoteAsync(string commit, string path, string by, CancellationToken ct = default)
    {
        RequireReady();
        var rel = VaultLayout.NormalizeRelative(path);
        if (!rel.EndsWith(".md", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Só notas .md podem ser restauradas.");
        var content = await _git.ShowAsync(commit, rel, ct)
            ?? throw new FileNotFoundException($"A nota {rel} não existia nessa versão.");

        await _git.SnapshotNowAsync($"hub: antes de restaurar {rel}", ct);
        await _vault.UserRestoreAsync(rel, content, $"restaurada {by} para a versão {commit[..7]}", ct);
        await _index.UpsertAsync(rel, ct);
        await _git.SnapshotNowAsync($"hub: {rel} restaurada {by} para a versão {commit[..7]}", ct);
        return rel;
    }

    /// <summary>
    /// Volta o Cérebro inteiro para uma versão: notas alteradas ou apagadas depois dela voltam ao
    /// conteúdo de então, e notas criadas depois vão para a lixeira (nada é apagado de vez).
    /// </summary>
    public async Task<RestoreReport> RestoreVaultAsync(string commit, string by, CancellationToken ct = default)
    {
        RequireReady();
        await _git.SnapshotNowAsync($"hub: antes de restaurar o Cérebro para {commit[..Math.Min(7, commit.Length)]}", ct);

        var restored = 0;
        var trashed = 0;
        var paths = new List<string>();
        foreach (var change in await _git.ChangedSinceAsync(commit, ct))
        {
            var rel = change.Path;
            if (!rel.EndsWith(".md", StringComparison.OrdinalIgnoreCase) || rel.Split('/').Any(p => p.StartsWith('.'))) continue;
            if (VaultLayout.IsUnder(rel, VaultLayout.Trash)) continue;

            if (change.Status == "A")
            {
                // Criada depois da versão: sai de cena, mas fica na lixeira.
                if (!_vault.Exists(rel) || !VaultLayout.UserCanEdit(rel)) continue;
                await _vault.UserTrashAsync(rel, by, ct);
                await _index.RemoveAsync(rel, ct);
                trashed++;
            }
            else
            {
                var content = await _git.ShowAsync(commit, rel, ct);
                if (content is null) continue;
                await _vault.UserRestoreAsync(rel, content, $"restaurada {by}", ct);
                await _index.UpsertAsync(rel, ct);
                restored++;
            }
            paths.Add(rel);
        }

        await _git.SnapshotNowAsync($"hub: Cérebro restaurado {by} para a versão {commit[..Math.Min(7, commit.Length)]} ({restored} notas voltaram, {trashed} para a lixeira)", ct);
        return new RestoreReport(restored, trashed, paths);
    }
}
