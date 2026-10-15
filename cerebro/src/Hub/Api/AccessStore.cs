using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Hub.Core;
using Hub.Data;
using Microsoft.Extensions.Options;

namespace Hub.Api;

/// <summary>
/// Acessos gerenciados pela tela do Cérebro: token do MCP do Cérebro, token do MCP da VPS (ops),
/// usuário e senha do WebDAV e API keys por fonte. Os segredos ficam cifrados no hub.db
/// (<see cref="SecretBox"/>) para poderem ser mostrados de novo na tela.
///
/// Regras com o .env:
/// - Token do MCP, token da VPS e WebDAV: o valor da tela SUBSTITUI o do .env (gerar um novo revoga o antigo).
/// - API keys: as da tela somam com as do .env (as do .env só saem editando o .env).
/// </summary>
public sealed class AccessStore
{
    private const string Key = "access";
    /// <summary>Arquivo lido pelo serviço ops (montado só leitura): só o hash do token, nunca o token.</summary>
    public const string OpsTokenFile = "access/ops-token.sha256";

    private readonly HubDb _db;
    private readonly SecretBox _box;
    private readonly HubOptions _options;
    private readonly object _lock = new();
    private Stored? _cache;

    public AccessStore(HubDb db, SecretBox box, IOptions<HubOptions> options)
    {
        _db = db;
        _box = box;
        _options = options.Value;
    }

    public sealed record StoredKey(string Name, string Secret, DateTimeOffset CreatedAt);

    public sealed record Stored(
        string? McpToken = null,
        string? OpsToken = null,
        string? WebdavUser = null,
        string? WebdavPass = null,
        List<StoredKey>? ApiKeys = null);

    public bool Available => _box.Available;

    public Stored Load()
    {
        lock (_lock)
        {
            if (_cache is not null) return _cache;
            var row = _db.GetSetting(Key);
            _cache = row is null ? new Stored() : JsonSerializer.Deserialize<Stored>(row.Value.Value) ?? new Stored();
            return _cache;
        }
    }

    private void Save(Stored s)
    {
        lock (_lock)
        {
            _db.SetSetting(Key, JsonSerializer.Serialize(s));
            _cache = s;
        }
    }

    // ---------------------------------------------------------------- valores em uso

    /// <summary>Token do MCP do Cérebro: o da tela, ou o do .env.</summary>
    public string? McpToken => _box.Decrypt(Load().McpToken) ?? NullIfEmpty(_options.McpToken);
    public string McpTokenSource => Load().McpToken is not null ? "tela" : string.IsNullOrWhiteSpace(_options.McpToken) ? "nenhum" : "servidor";

    /// <summary>Token do MCP da VPS. Só o da tela é conhecido aqui (o do .env fica no serviço ops).</summary>
    public string? OpsToken => _box.Decrypt(Load().OpsToken);

    public (string User, string Pass)? Webdav
    {
        get
        {
            var s = Load();
            if (s.WebdavUser is not null && _box.Decrypt(s.WebdavPass) is { } pass) return (s.WebdavUser, pass);
            return string.IsNullOrWhiteSpace(_options.WebdavUser) || string.IsNullOrWhiteSpace(_options.WebdavPass)
                ? null : (_options.WebdavUser, _options.WebdavPass);
        }
    }
    public string WebdavSource => Load().WebdavUser is not null ? "tela" : Webdav is null ? "nenhum" : "servidor";

    /// <summary>Todas as API keys válidas: nome → valor (tela + .env).</summary>
    public IReadOnlyList<(string Name, string Value, string Source)> ApiKeys()
    {
        var list = new List<(string, string, string)>();
        foreach (var k in Load().ApiKeys ?? [])
            if (_box.Decrypt(k.Secret) is { } v) list.Add((k.Name, v, "tela"));
        foreach (var kv in _options.ApiKeys.Where(kv => !string.IsNullOrWhiteSpace(kv.Value)))
            list.Add((kv.Key, kv.Value, "servidor"));
        return list;
    }

    // ---------------------------------------------------------------- alterações pela tela

    public string RegenerateMcpToken()
    {
        var token = SecretBox.NewToken();
        Save(Load() with { McpToken = _box.Encrypt(token) });
        return token;
    }

    public string RegenerateOpsToken()
    {
        var token = SecretBox.NewToken();
        Save(Load() with { OpsToken = _box.Encrypt(token) });
        WriteOpsTokenHash(token);
        return token;
    }

    /// <summary>Senha null = gerar uma nova.</summary>
    public (string User, string Pass) SetWebdav(string user, string? pass)
    {
        user = user.Trim();
        if (user.Length is 0 or > 64 || user.Any(c => char.IsWhiteSpace(c) || c == ':'))
            throw new ArgumentException("Usuário do WebDAV: até 64 caracteres, sem espaço nem ':'.");
        pass = string.IsNullOrWhiteSpace(pass) ? SecretBox.NewToken(18) : pass.Trim();
        if (pass.Length < 12) throw new ArgumentException("Senha do WebDAV: pelo menos 12 caracteres.");
        Save(Load() with { WebdavUser = user, WebdavPass = _box.Encrypt(pass) });
        return (user, pass);
    }

    public string CreateApiKey(string name)
    {
        name = name.Trim().ToLowerInvariant();
        if (!System.Text.RegularExpressions.Regex.IsMatch(name, "^[a-z0-9][a-z0-9_-]{0,31}$"))
            throw new ArgumentException("Nome da fonte: letras minúsculas, números, - ou _, até 32 caracteres (ex.: celular, whatsapp).");
        if (ApiKeys().Any(k => k.Name == name))
            throw new ArgumentException($"Já existe uma chave para \"{name}\".");
        var value = SecretBox.NewToken();
        var s = Load();
        Save(s with { ApiKeys = [.. s.ApiKeys ?? [], new StoredKey(name, _box.Encrypt(value), DateTimeOffset.UtcNow)] });
        return value;
    }

    public bool DeleteApiKey(string name)
    {
        var s = Load();
        var keys = s.ApiKeys ?? [];
        if (!keys.Any(k => k.Name == name)) return false;
        Save(s with { ApiKeys = keys.Where(k => k.Name != name).ToList() });
        return true;
    }

    /// <summary>Recria o arquivo de hash do ops a partir do banco (ex.: depois de um restore do data/).</summary>
    public void SyncOpsTokenFile()
    {
        if (OpsToken is { } t) WriteOpsTokenHash(t);
    }

    private void WriteOpsTokenHash(string token)
    {
        var path = Path.Combine(Path.GetFullPath(_options.DataPath), OpsTokenFile);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token))) + "\n");
        File.Move(tmp, path, overwrite: true);
    }

    private static string? NullIfEmpty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;
}
