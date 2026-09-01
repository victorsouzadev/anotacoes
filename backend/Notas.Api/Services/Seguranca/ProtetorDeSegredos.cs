using System.Security.Cryptography;
using System.Text;

namespace Notas.Api.Services.Seguranca;

public interface IProtetorDeSegredos
{
    string Proteger(string valor);

    /// <summary>Devolve null quando o texto não pôde ser decifrado (segredo trocado, dado corrompido).</summary>
    string? Desproteger(string protegido);
}

// Cifra segredos guardados no banco — hoje, as chaves de API que o usuário
// cadastra pela tela de configurações.
//
// O arquivo SQLite vai para backup e pode ser copiado; uma chave de API em texto
// puro ali vazaria junto. AES-GCM dá confidencialidade e autenticação (um texto
// adulterado falha em vez de decifrar lixo).
public class ProtetorDeSegredos : IProtetorDeSegredos
{
    private const int TamanhoNonce = 12;   // recomendado para GCM
    private const int TamanhoTag = 16;

    private readonly byte[] _chave;

    public ProtetorDeSegredos(IConfiguration configuration)
    {
        // Por padrão a chave é derivada do JWT_SECRET, que já é obrigatório, secreto
        // e estável entre reinícios — evita mais uma variável de ambiente para
        // esquecer de configurar. A derivação usa um rótulo próprio, para que a
        // chave de cifra não seja o mesmo valor usado para assinar tokens.
        var segredo = configuration["SEGREDO_CRIPTOGRAFIA"]
            ?? configuration["JWT_SECRET"]
            ?? throw new InvalidOperationException(
                "Defina JWT_SECRET (ou SEGREDO_CRIPTOGRAFIA) para cifrar os segredos guardados no banco.");

        _chave = HKDF.DeriveKey(
            HashAlgorithmName.SHA256,
            ikm: Encoding.UTF8.GetBytes(segredo),
            outputLength: 32,
            info: Encoding.UTF8.GetBytes("notas-vps:segredos-no-banco:v1"));
    }

    public string Proteger(string valor)
    {
        ArgumentException.ThrowIfNullOrEmpty(valor);

        var texto = Encoding.UTF8.GetBytes(valor);
        var nonce = RandomNumberGenerator.GetBytes(TamanhoNonce);
        var cifrado = new byte[texto.Length];
        var tag = new byte[TamanhoTag];

        using var aes = new AesGcm(_chave, TamanhoTag);
        aes.Encrypt(nonce, texto, cifrado, tag);

        // nonce | tag | cifrado, tudo num único campo de texto.
        var saida = new byte[TamanhoNonce + TamanhoTag + cifrado.Length];
        nonce.CopyTo(saida, 0);
        tag.CopyTo(saida, TamanhoNonce);
        cifrado.CopyTo(saida, TamanhoNonce + TamanhoTag);

        return Convert.ToBase64String(saida);
    }

    public string? Desproteger(string protegido)
    {
        if (string.IsNullOrWhiteSpace(protegido)) return null;

        try
        {
            var bruto = Convert.FromBase64String(protegido);
            if (bruto.Length < TamanhoNonce + TamanhoTag) return null;

            var nonce = bruto.AsSpan(0, TamanhoNonce);
            var tag = bruto.AsSpan(TamanhoNonce, TamanhoTag);
            var cifrado = bruto.AsSpan(TamanhoNonce + TamanhoTag);
            var texto = new byte[cifrado.Length];

            using var aes = new AesGcm(_chave, TamanhoTag);
            aes.Decrypt(nonce, cifrado, tag, texto);

            return Encoding.UTF8.GetString(texto);
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException or ArgumentException)
        {
            // Acontece se o JWT_SECRET mudou depois que a chave foi salva. Devolver
            // null deixa o chamador tratar como "sem chave" e pedir o cadastro de
            // novo, em vez de derrubar a requisição.
            return null;
        }
    }
}
