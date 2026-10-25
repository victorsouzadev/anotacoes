using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using Notas.Api.Services.Seguranca;

namespace EditorImagens.Desktop;

/// <summary>
/// No PC, as chaves de API (fal.ai, World Labs, OpenRouter…) ficam cifradas pelo próprio Windows
/// (DPAPI, presas à conta do usuário): copiar a pasta de dados para outra máquina ou conta não
/// as revela, coisa que o AES do servidor — cuja chave mora no config.json ao lado — não garante.
/// O que foi gravado antes (AES) continua legível e passa a DPAPI na próxima gravação.
/// </summary>
public sealed class ProtetorDpapi(IConfiguration config) : IProtetorDeSegredos
{
    private const string Prefixo = "dpapi:";
    private static readonly byte[] Entropia = Encoding.UTF8.GetBytes("EditorImagens.Estudio.v1");
    private readonly ProtetorDeSegredos legado = new(config);

    public string Proteger(string valor)
    {
        ArgumentException.ThrowIfNullOrEmpty(valor);
        var cifrado = ProtectedData.Protect(Encoding.UTF8.GetBytes(valor), Entropia, DataProtectionScope.CurrentUser);
        return Prefixo + Convert.ToBase64String(cifrado);
    }

    public string? Desproteger(string protegido)
    {
        if (!protegido.StartsWith(Prefixo, StringComparison.Ordinal)) return legado.Desproteger(protegido);
        try
        {
            var bytes = ProtectedData.Unprotect(Convert.FromBase64String(protegido[Prefixo.Length..]), Entropia, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(bytes);
        }
        catch (Exception e) when (e is CryptographicException or FormatException)
        {
            return null;
        }
    }
}
