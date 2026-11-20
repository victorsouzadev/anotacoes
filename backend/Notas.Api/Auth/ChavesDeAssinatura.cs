using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.IdentityModel.Tokens;

namespace Notas.Api.Auth;

public class ChavesOptions
{
    public const string SectionName = "Core";

    /// <summary>Pasta das chaves do núcleo (spec 030). Montada só no serviço api; nunca nos plug-ins.</summary>
    public string Chaves { get; set; } = "../../data/core/chaves";

    /// <summary>Até quando tokens HS256 (JWT_SECRET) ainda valem. Vazio: 15 min depois do boot.</summary>
    public DateTime? AceitarHs256Ate { get; set; }
}

/// <summary>
/// Chaves ES256 do núcleo em <c>&lt;kid&gt;.pem</c> (a mais nova assina; a anterior continua no JWKS)
/// e a chave do selo HMAC das linhas de login (<c>selo.key</c>). Geradas no primeiro boot.
/// </summary>
public sealed class ChavesDeAssinatura
{
    public const string Algoritmo = SecurityAlgorithms.EcdsaSha256;

    private readonly string _pasta;
    private readonly object _trava = new();
    private List<ECDsaSecurityKey> _chaves = [];
    private byte[] _selo = [];

    public ChavesDeAssinatura(string pasta)
    {
        _pasta = Path.GetFullPath(pasta);
        Directory.CreateDirectory(_pasta);
        Carregar();
        if (_chaves.Count == 0) Rotacionar(DateTime.UtcNow);
        var seloArq = Path.Combine(_pasta, "selo.key");
        if (!File.Exists(seloArq)) GravarPrivado(seloArq, Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)));
        _selo = Convert.FromBase64String(File.ReadAllText(seloArq).Trim());
    }

    /// <summary>Chave que assina os tokens novos.</summary>
    public ECDsaSecurityKey Atual { get { lock (_trava) return _chaves[^1]; } }

    /// <summary>Atual e anterior: as que validam e as que vão no JWKS.</summary>
    public IReadOnlyList<ECDsaSecurityKey> Validas { get { lock (_trava) return _chaves.TakeLast(2).ToList(); } }

    public byte[] ChaveSelo => _selo;

    /// <summary>Gera uma chave nova; a atual vira a anterior e a mais velha sai do JWKS (fica no disco).</summary>
    public string Rotacionar(DateTime agoraUtc)
    {
        lock (_trava)
        {
            var kid = agoraUtc.ToString("yyyy-MM-dd-HHmmss");
            using var ec = ECDsa.Create(ECCurve.NamedCurves.nistP256);
            GravarPrivado(Path.Combine(_pasta, kid + ".pem"), ec.ExportECPrivateKeyPem());
            Carregar();
            File.WriteAllText(Path.Combine(_pasta, "jwks.json"), JsonSerializer.Serialize(Jwks()));
            return kid;
        }
    }

    public object Jwks() => new
    {
        keys = Validas.Select(k =>
        {
            var p = k.ECDsa.ExportParameters(false);
            return new Dictionary<string, string>
            {
                ["kty"] = "EC", ["crv"] = "P-256", ["use"] = "sig", ["alg"] = "ES256", ["kid"] = k.KeyId,
                ["x"] = Base64UrlEncoder.Encode(p.Q.X!), ["y"] = Base64UrlEncoder.Encode(p.Q.Y!),
            };
        }).ToArray(),
    };

    /// <summary>HMAC-SHA256 dos campos que dão acesso, em hex. Campos separados por \u001f.</summary>
    public string Selar(params string?[] campos) =>
        Convert.ToHexString(HMACSHA256.HashData(_selo, Encoding.UTF8.GetBytes(string.Join('\u001f', campos.Select(c => c ?? "")))));

    public bool SeloConfere(string? selo, params string?[] campos) =>
        selo is not null && CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(selo), Encoding.ASCII.GetBytes(Selar(campos)));

    private void Carregar()
    {
        var lidas = new List<ECDsaSecurityKey>();
        foreach (var arq in Directory.GetFiles(_pasta, "*.pem").Order(StringComparer.Ordinal))
        {
            var ec = ECDsa.Create();
            ec.ImportFromPem(File.ReadAllText(arq));
            lidas.Add(new ECDsaSecurityKey(ec) { KeyId = Path.GetFileNameWithoutExtension(arq) });
        }
        _chaves = lidas;
    }

    private static void GravarPrivado(string arq, string conteudo)
    {
        var tmp = arq + ".tmp";
        File.WriteAllText(tmp, conteudo);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(tmp, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        File.Move(tmp, arq, overwrite: true);
    }
}
