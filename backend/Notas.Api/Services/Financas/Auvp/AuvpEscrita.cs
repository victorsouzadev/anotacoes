using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;
using Notas.Api.Services.Seguranca;

namespace Notas.Api.Services.Financas.Auvp;

/// <summary>O que mudou num lançamento importado e precisa ir para a AUVP.</summary>
public record MudancaLocal(
    bool? ForaDosTotais = null,
    string? Descricao = null,
    string? Observacoes = null,
    Categoria? Categoria = null,
    IReadOnlyList<string>? Tags = null,
    string? OrcamentoAuvp = null,
    bool LimparOrcamento = false);

// Leva para a AUVP o que o usuário mudou aqui num lançamento que veio de lá.
//
// Falha na AUVP não desfaz a mudança local: o dado do usuário já está salvo, e a
// falha volta como aviso para a tela dizer que lá não atualizou.
public class AuvpEscrita(AppDbContext db, IAuvpCliente cliente, IProtetorDeSegredos protetor)
{
    private List<AuvpTag>? _tags;
    private List<AuvpOrcamento>? _orcamentos;
    private string? _chave;
    private bool _chaveCarregada;

    public async Task<string?> ChaveAsync(string userId, CancellationToken ct)
    {
        if (_chaveCarregada) return _chave;
        _chaveCarregada = true;
        if (!cliente.Habilitado) return null;
        var cifrada = await db.ConfiguracoesAuvp.AsNoTracking()
            .Where(c => c.UserId == userId)
            .Select(c => c.ChaveCifrada)
            .FirstOrDefaultAsync(ct);
        _chave = cifrada is { Length: > 0 } ? protetor.Desproteger(cifrada) : null;
        return _chave;
    }

    /// <summary>Envia a mudança; devolve null se deu certo ou não se aplica, ou o motivo da falha.</summary>
    public async Task<string?> EnviarAsync(Transacao t, MudancaLocal m, CancellationToken ct)
    {
        if (t.OrigemExterna != AuvpSincronizador.Origem
            || !long.TryParse(t.IdExterno, NumberStyles.None, CultureInfo.InvariantCulture, out var id))
            return null;

        var chave = await ChaveAsync(t.UserId, ct);
        if (chave is null) return null;

        try
        {
            int? orcamentoId = null;
            if (m.OrcamentoAuvp is not null)
            {
                _orcamentos ??= await cliente.ListarOrcamentosAsync(chave, ct);
                orcamentoId = _orcamentos.FirstOrDefault(o => o.Key == m.OrcamentoAuvp)?.Id
                    ?? throw new AuvpIndisponivelException($"Orçamento '{m.OrcamentoAuvp}' não existe na AUVP.");
            }

            var alteracao = new AuvpAlteracao(
                Ignorar: m.ForaDosTotais,
                DescricaoExibida: m.Descricao,
                Observacoes: m.Observacoes,
                OrcamentoId: orcamentoId,
                LimparOrcamento: m.LimparOrcamento);
            if (!alteracao.Vazia) await cliente.AtualizarTransacaoAsync(chave, id, alteracao, ct);

            if (m.Tags is not null || m.Categoria is not null)
                await SincronizarTagsAsync(chave, id, t, m, ct);

            return null;
        }
        catch (AuvpIndisponivelException ex)
        {
            return ex.Message;
        }
    }

    // A AUVP não tem categoria do usuário — o equivalente lá é a tag. Mudar a
    // categoria aqui troca a "tag de categoria" (Alimentação, Casa…) e preserva
    // as outras (Pai, Manu…). Tags editadas explicitamente vão como estão.
    private async Task SincronizarTagsAsync(string chave, long id, Transacao t, MudancaLocal m, CancellationToken ct)
    {
        _tags ??= (await cliente.ListarTagsAsync(chave, ct))
            .Where(x => x.Status is null or "ACTIVE")
            .ToList();
        var porNome = _tags
            .GroupBy(x => AuvpCategorias.Normalizar(x.Name ?? ""))
            .ToDictionary(g => g.Key, g => g.First());

        var atuais = t.ListaDeTags().ToList();
        var desejadas = m.Tags?.ToList() ?? [.. atuais];

        if (m.Categoria is { } categoria)
        {
            desejadas.RemoveAll(n => AuvpCategorias.DaTag(n) is { } c && c != categoria);
            var daCategoria = _tags.FirstOrDefault(x => AuvpCategorias.DaTag(x.Name) == categoria);
            if (daCategoria?.Name is { } nome
                && !desejadas.Any(n => AuvpCategorias.Normalizar(n) == AuvpCategorias.Normalizar(nome)))
                desejadas.Add(nome);
        }

        long? IdDe(string nome) => porNome.TryGetValue(AuvpCategorias.Normalizar(nome), out var tag) ? tag.Id : null;
        var idsAtuais = atuais.Select(IdDe).OfType<long>().ToHashSet();
        var idsDesejados = desejadas.Select(IdDe).OfType<long>().ToHashSet();

        await cliente.AdicionarTagsAsync(chave, id, idsDesejados.Except(idsAtuais).ToList(), ct);
        await cliente.RemoverTagsAsync(chave, id, idsAtuais.Except(idsDesejados).ToList(), ct);

        // Só guarda as que existem na AUVP: uma tag inventada aqui não teria par lá.
        t.Tags = idsDesejados.Count == 0
            ? null
            : string.Join('|', _tags.Where(x => idsDesejados.Contains(x.Id)).Select(x => x.Name!.Replace("|", "/")));
    }
}
