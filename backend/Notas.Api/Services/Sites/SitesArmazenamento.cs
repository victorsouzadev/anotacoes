using System.Runtime.InteropServices;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Options;

namespace Notas.Api.Services.Sites;

/// <summary>
/// O disco de cada site:
/// <code>
/// &lt;Raiz&gt;/&lt;slug&gt;/
///   deploys/&lt;deployId&gt;/api|web   pacote extraído (imutável)
///   current -> deploys/&lt;deployId&gt;  o que o Caddy serve (link relativo, trocado de forma atômica)
///   data/app.db                    banco do app; montado em /data; sobrevive a republicações
///   backups/&lt;deployId&gt;.db         cópia do banco feita logo antes daquela versão entrar no ar
/// </code>
/// </summary>
public class SitesArmazenamento(IOptions<SitesOptions> options)
{
    // rename(2) troca o link de uma vez: quem está lendo "current" vê a versão velha
    // ou a nova, nunca um intervalo sem nada. File.Move não serve — ele recusa um
    // link que aponta para pasta.
    [DllImport("libc", EntryPoint = "rename", SetLastError = true)]
    private static extern int Rename(string origem, string destino);

    private readonly SitesOptions _opt = options.Value;

    public string Raiz => Path.GetFullPath(_opt.Raiz);
    public string PastaSite(string slug) => Path.Combine(Raiz, slug);
    public string PastaDeploy(string slug, string deployId) => Path.Combine(PastaSite(slug), "deploys", deployId);
    public string PastaDados(string slug) => Path.Combine(PastaSite(slug), "data");
    public string ArquivoBanco(string slug) => Path.Combine(PastaDados(slug), "app.db");
    public string ArquivoBackup(string slug, string deployId) => Path.Combine(PastaSite(slug), "backups", deployId + ".db");
    private string LinkAtual(string slug) => Path.Combine(PastaSite(slug), "current");

    /// <summary>Cria a pasta de dados com permissão para o usuário do container (uid 1000).</summary>
    public void PrepararDados(string slug)
    {
        var dados = PastaDados(slug);
        Directory.CreateDirectory(dados);
        if (!OperatingSystem.IsWindows())
        {
            // A API roda como root e o app como uid 1000: sem isso o SQLite do app não
            // consegue criar o arquivo nem o -wal. A pasta só é montada no container do
            // próprio site, então liberar escrita aqui não abre nada para os outros.
            File.SetUnixFileMode(dados, (UnixFileMode)0b111_111_111);
            foreach (var f in Directory.GetFiles(dados))
                File.SetUnixFileMode(f, (UnixFileMode)0b110_110_110);
        }
    }

    /// <summary>Aponta "current" para a versão, trocando o link de uma vez (rename).</summary>
    public void Ativar(string slug, string deployId)
    {
        var link = LinkAtual(slug);
        var temporario = link + ".tmp-" + Guid.NewGuid().ToString("N");
        // Relativo: o mesmo link funciona dentro do container da API e do Caddy, que
        // montam a pasta em caminhos diferentes.
        File.CreateSymbolicLink(temporario, Path.Combine("deploys", deployId));
        if (Rename(temporario, link) != 0)
        {
            var errno = Marshal.GetLastPInvokeError();
            File.Delete(temporario);
            throw new IOException($"Não consegui ativar a versão (rename falhou, errno {errno}).");
        }
    }

    public void Desativar(string slug)
    {
        var link = LinkAtual(slug);
        if (File.Exists(link) || new FileInfo(link).LinkTarget is not null) File.Delete(link);
    }

    /// <summary>Cópia consistente do banco do app (API de backup do SQLite; segura com WAL).</summary>
    public bool CopiarBanco(string slug, string deployId)
    {
        var origem = ArquivoBanco(slug);
        if (!File.Exists(origem)) return false;
        var destino = ArquivoBackup(slug, deployId);
        Directory.CreateDirectory(Path.GetDirectoryName(destino)!);
        if (File.Exists(destino)) File.Delete(destino);
        using (var de = new SqliteConnection($"Data Source={origem};Mode=ReadOnly;Pooling=False"))
        using (var para = new SqliteConnection($"Data Source={destino};Pooling=False"))
        {
            de.Open();
            para.Open();
            de.BackupDatabase(para);
        }
        return true;
    }

    /// <summary>Volta o banco para a cópia feita antes da versão deployId. O container precisa estar parado.</summary>
    public bool RestaurarBanco(string slug, string deployId)
    {
        var backup = ArquivoBackup(slug, deployId);
        if (!File.Exists(backup)) return false;
        var banco = ArquivoBanco(slug);
        foreach (var sufixo in new[] { "-wal", "-shm" })
            if (File.Exists(banco + sufixo)) File.Delete(banco + sufixo);
        File.Copy(backup, banco, overwrite: true);
        PrepararDados(slug);
        return true;
    }

    public void ApagarVersao(string slug, string deployId)
    {
        var pasta = PastaDeploy(slug, deployId);
        if (Directory.Exists(pasta)) Directory.Delete(pasta, recursive: true);
        var backup = ArquivoBackup(slug, deployId);
        if (File.Exists(backup)) File.Delete(backup);
    }

    public void ApagarSite(string slug)
    {
        var pasta = PastaSite(slug);
        if (!Directory.Exists(pasta)) return;
        Desativar(slug);
        Directory.Delete(pasta, recursive: true);
    }
}
