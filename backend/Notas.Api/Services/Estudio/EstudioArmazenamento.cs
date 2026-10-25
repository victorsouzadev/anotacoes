using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace Notas.Api.Services.Estudio;

/// <summary>
/// Arquivos do Estúdio em disco e os links para baixá-los. O link é assinado (HMAC com prazo)
/// porque &lt;video&gt;, &lt;audio&gt; e o carregador do Three.js não mandam o cabeçalho de
/// autorização: quem tem o link vê o arquivo até o prazo vencer, e ninguém adivinha outro.
/// </summary>
public sealed class EstudioArmazenamento
{
    private readonly string _raiz;
    private readonly byte[] _chave;

    public EstudioArmazenamento(IOptions<EstudioOptions> options, IConfiguration config)
    {
        _raiz = Path.GetFullPath(options.Value.Raiz);
        Directory.CreateDirectory(_raiz);
        var segredo = config["SEGREDO_CRIPTOGRAFIA"] ?? config["JWT_SECRET"]
            ?? throw new InvalidOperationException("Defina JWT_SECRET para assinar os links do Estúdio.");
        _chave = HKDF.DeriveKey(HashAlgorithmName.SHA256, Encoding.UTF8.GetBytes(segredo), 32,
            info: Encoding.UTF8.GetBytes("notas-vps:estudio-arquivos:v1"));
    }

    public string Raiz => _raiz;

    /// <summary>Caminho relativo novo para um arquivo do usuário (pasta por mês, para não lotar um diretório só).</summary>
    public string NovoCaminho(string userId, string id, string extensao)
    {
        var ext = extensao.StartsWith('.') ? extensao : "." + extensao;
        return Path.Combine(Seguro(userId), DateTime.UtcNow.ToString("yyyyMM"), id + ext.ToLowerInvariant());
    }

    public string Absoluto(string relativo)
    {
        var abs = Path.GetFullPath(Path.Combine(_raiz, relativo));
        if (!abs.StartsWith(_raiz + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            throw new InvalidOperationException("Caminho fora da pasta do Estúdio.");
        return abs;
    }

    public async Task<long> Gravar(string relativo, Stream conteudo, long limite, CancellationToken ct)
    {
        var destino = Absoluto(relativo);
        Directory.CreateDirectory(Path.GetDirectoryName(destino)!);
        var temp = destino + ".parcial";
        long total = 0;
        try
        {
            await using (var saida = File.Create(temp))
            {
                var buffer = new byte[81920];
                int lidos;
                while ((lidos = await conteudo.ReadAsync(buffer, ct)) > 0)
                {
                    total += lidos;
                    if (total > limite) throw new ErroDoEstudio($"Arquivo grande demais (limite de {limite / 1024 / 1024} MB).");
                    await saida.WriteAsync(buffer.AsMemory(0, lidos), ct);
                }
            }
            File.Move(temp, destino, overwrite: true);
            return total;
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }

    public void Apagar(string relativo)
    {
        try
        {
            var abs = Absoluto(relativo);
            if (File.Exists(abs)) File.Delete(abs);
        }
        catch (IOException) { /* arquivo preso ou sumido: o registro sai do mesmo jeito */ }
    }

    /// <summary>Pasta temporária para o ffmpeg, dentro da raiz (mesmo disco, move barato).</summary>
    public string PastaTemporaria()
    {
        var dir = Path.Combine(_raiz, "_tmp", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }

    // ---------- links assinados ----------

    public string Link(string midiaId, TimeSpan? validade = null)
    {
        var exp = DateTimeOffset.UtcNow.Add(validade ?? TimeSpan.FromHours(12)).ToUnixTimeSeconds();
        // Arredonda o prazo para a hora cheia: a mesma mídia ganha o mesmo link por um tempo,
        // e o navegador reaproveita o cache em vez de baixar o vídeo de novo a cada lista.
        exp = (exp / 3600 + 1) * 3600;
        return $"/api/estudio/arquivos/{midiaId}?exp={exp}&sig={Assinar(midiaId, exp)}";
    }

    public bool Valido(string midiaId, long exp, string? sig)
    {
        if (string.IsNullOrEmpty(sig) || DateTimeOffset.UtcNow.ToUnixTimeSeconds() > exp) return false;
        var esperado = Encoding.ASCII.GetBytes(Assinar(midiaId, exp));
        return CryptographicOperations.FixedTimeEquals(esperado, Encoding.ASCII.GetBytes(sig));
    }

    private string Assinar(string midiaId, long exp)
    {
        var mac = HMACSHA256.HashData(_chave, Encoding.UTF8.GetBytes($"{midiaId}:{exp}"));
        return Convert.ToHexStringLower(mac)[..32];
    }

    private static string Seguro(string nome) =>
        string.Concat(nome.Where(c => char.IsLetterOrDigit(c) || c is '-' or '_'));
}
