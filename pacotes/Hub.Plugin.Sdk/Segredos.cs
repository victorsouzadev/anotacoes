using System.Security.Cryptography;
using System.Text;

namespace Hub.Plugin;

/// <summary>
/// Cifra segredos do plug-in (chaves de API dos usuários) com AES-GCM e a chave <c>SEGREDO_PLUGIN</c>, que só
/// esse plug-in tem (spec 031). No banco compartilhado, um segredo cifrado por um plug-in não abre nos outros.
/// Formato: <c>v1:</c> + base64(nonce 12 | tag 16 | texto).
/// </summary>
public sealed class Segredos
{
    private readonly byte[] _chave;

    public Segredos(string segredo)
    {
        if (string.IsNullOrWhiteSpace(segredo) || segredo.Length < 32)
            throw new InvalidOperationException("Defina SEGREDO_PLUGIN (pelo menos 32 caracteres).");
        _chave = SHA256.HashData(Encoding.UTF8.GetBytes(segredo));
    }

    public static Segredos DoAmbiente() => new(Environment.GetEnvironmentVariable("SEGREDO_PLUGIN") ?? "");

    public string Cifrar(string texto)
    {
        var claro = Encoding.UTF8.GetBytes(texto);
        var saida = new byte[12 + 16 + claro.Length];
        var nonce = saida.AsSpan(0, 12);
        RandomNumberGenerator.Fill(nonce);
        using var aes = new AesGcm(_chave, 16);
        aes.Encrypt(nonce, claro, saida.AsSpan(28), saida.AsSpan(12, 16));
        return "v1:" + Convert.ToBase64String(saida);
    }

    /// <summary>Null quando o valor não é deste plug-in (outra chave) ou está corrompido.</summary>
    public string? Decifrar(string? cifrado)
    {
        if (cifrado is null || !cifrado.StartsWith("v1:")) return null;
        try
        {
            var b = Convert.FromBase64String(cifrado[3..]);
            if (b.Length < 28) return null;
            var claro = new byte[b.Length - 28];
            using var aes = new AesGcm(_chave, 16);
            aes.Decrypt(b.AsSpan(0, 12), b.AsSpan(28), b.AsSpan(12, 16), claro);
            return Encoding.UTF8.GetString(claro);
        }
        catch (Exception e) when (e is FormatException or CryptographicException) { return null; }
    }
}
