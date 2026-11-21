using System.Security.Cryptography;
using System.Text;

namespace Ops;

/// <summary>
/// Hashes aceitos: os tokens "ops" de Configurações → Conexões do hub (arquivo que a api grava, spec 033) e o do
/// arquivo da tela do Segundo Cérebro; sem nenhum dos dois, o Ops__Token do .env. Os arquivos são relidos quando mudam.
/// </summary>
public sealed class TokenSource
{
    private readonly OpsOptions _options;
    private readonly byte[]? _envHash;
    private readonly Arquivo _tela;
    private readonly Arquivo _hub;

    public TokenSource(OpsOptions options)
    {
        _options = options;
        _envHash = options.Token.Length > 0 ? SHA256.HashData(Encoding.UTF8.GetBytes(options.Token)) : null;
        _tela = new Arquivo(options.TokenHashFile);
        _hub = new Arquivo(options.TokensDoHubFile);
    }

    public string Origin => _hub.Ler().Count > 0 ? "hub" : _tela.Ler().Count > 0 ? "tela" : _envHash is not null ? "servidor" : "nenhum";

    /// <summary>Primeiro hash aceito (compatibilidade com quem só olha um).</summary>
    public byte[]? Current() => Aceitos().FirstOrDefault();

    public IReadOnlyList<byte[]> Aceitos()
    {
        var arquivos = _hub.Ler().Concat(_tela.Ler()).ToList();
        return arquivos.Count > 0 ? arquivos : _envHash is null ? [] : [_envHash];
    }

    public static bool Confere(byte[] hash, IReadOnlyList<byte[]> aceitos)
    {
        var ok = false;
        foreach (var a in aceitos) ok |= CryptographicOperations.FixedTimeEquals(hash, a);
        return ok;
    }

    private sealed class Arquivo(string? caminho)
    {
        private readonly object _lock = new();
        private DateTime _stamp;
        private IReadOnlyList<byte[]> _hashes = [];

        public IReadOnlyList<byte[]> Ler()
        {
            if (string.IsNullOrEmpty(caminho) || !File.Exists(caminho)) return [];
            lock (_lock)
            {
                var stamp = File.GetLastWriteTimeUtc(caminho);
                if (stamp != _stamp)
                {
                    _hashes = File.ReadAllLines(caminho).Select(l => l.Trim()).Where(l => l.Length == 64)
                        .Select(Convert.FromHexString).ToList();
                    _stamp = stamp;
                }
                return _hashes;
            }
        }
    }
}
