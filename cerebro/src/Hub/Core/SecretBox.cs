using System.Security.Cryptography;
using System.Text;
using Hub.Core;
using Microsoft.Extensions.Options;

namespace Hub.Core;

/// <summary>
/// Cifra segredos guardados no hub.db (chave de IA, tokens, senha do WebDAV) com AES-GCM, usando uma
/// chave derivada do JWT_SECRET do hub. Sem JWT_SECRET não há como guardar segredos pela tela.
/// </summary>
public sealed class SecretBox
{
    private readonly byte[]? _key;

    public SecretBox(IOptions<HubOptions> options)
    {
        var secret = options.Value.Web.JwtSecret;
        _key = string.IsNullOrWhiteSpace(secret) ? null : SHA256.HashData(Encoding.UTF8.GetBytes("cerebro-ia:" + secret));
    }

    public bool Available => _key is not null;

    public string Encrypt(string plain)
    {
        if (_key is null) throw new InvalidOperationException("Sem JWT_SECRET o Cérebro não consegue guardar segredos.");
        var nonce = RandomNumberGenerator.GetBytes(12);
        var data = Encoding.UTF8.GetBytes(plain);
        var cipher = new byte[data.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(_key, 16)) aes.Encrypt(nonce, data, cipher, tag);
        return Convert.ToBase64String([.. nonce, .. tag, .. cipher]);
    }

    /// <summary>Null se não abrir (JWT_SECRET trocado desde que foi cifrado).</summary>
    public string? Decrypt(string? encoded)
    {
        if (_key is null || encoded is null) return null;
        try
        {
            var all = Convert.FromBase64String(encoded);
            var plain = new byte[all.Length - 28];
            using var aes = new AesGcm(_key, 16);
            aes.Decrypt(all[..12], all[28..], all[12..28], plain);
            return Encoding.UTF8.GetString(plain);
        }
        catch (Exception e) when (e is CryptographicException or FormatException or ArgumentException)
        {
            return null;
        }
    }

    /// <summary>Token aleatório em hex (32 bytes = 64 caracteres).</summary>
    public static string NewToken(int bytes = 32) => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(bytes));

    public static string Mask(string? value) =>
        string.IsNullOrEmpty(value) ? "" : "••••••••" + (value.Length > 4 ? value[^4..] : "");
}
