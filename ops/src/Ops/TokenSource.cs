using System.Security.Cryptography;
using System.Text;

namespace Ops;

/// <summary>
/// Hash do token aceito: o do arquivo escrito pelo Segundo Cérebro (gerado na tela), se existir;
/// senão o Ops__Token do .env. O arquivo é relido quando a data de modificação muda.
/// </summary>
public sealed class TokenSource
{
    private readonly OpsOptions _options;
    private readonly byte[]? _envHash;
    private readonly object _lock = new();
    private DateTime _fileStamp;
    private byte[]? _fileHash;

    public TokenSource(OpsOptions options)
    {
        _options = options;
        _envHash = options.Token.Length > 0 ? SHA256.HashData(Encoding.UTF8.GetBytes(options.Token)) : null;
    }

    public string Origin => ReadFile() is not null ? "tela" : _envHash is not null ? "servidor" : "nenhum";

    public byte[]? Current() => ReadFile() ?? _envHash;

    private byte[]? ReadFile()
    {
        var path = _options.TokenHashFile;
        if (string.IsNullOrEmpty(path) || !File.Exists(path)) return null;
        lock (_lock)
        {
            var stamp = File.GetLastWriteTimeUtc(path);
            if (stamp != _fileStamp)
            {
                var hex = File.ReadAllText(path).Trim();
                _fileHash = hex.Length == 64 ? Convert.FromHexString(hex) : null;
                _fileStamp = stamp;
            }
            return _fileHash;
        }
    }
}
