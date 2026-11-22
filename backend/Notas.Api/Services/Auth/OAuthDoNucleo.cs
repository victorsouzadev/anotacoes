using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Auth;
using Notas.Api.Data;

namespace Notas.Api.Services.Auth;

// Tabelas do OAuth do núcleo (spec 030, data-model): prefixo core_, plug-ins não leem.
public class OAuthCliente
{
    public string Id { get; set; } = "";
    public string Nome { get; set; } = "";
    public string RedirectUris { get; set; } = "[]";
    public DateTime CriadoEm { get; set; }
    public DateTime? UltimoUso { get; set; }
    public List<string> Uris() => JsonSerializer.Deserialize<List<string>>(RedirectUris) ?? [];
}

public class OAuthPedido
{
    public string Id { get; set; } = "";
    public string ClienteId { get; set; } = "";
    public string Plugin { get; set; } = "";
    public string RedirectUri { get; set; } = "";
    public string CodeChallenge { get; set; } = "";
    public string? State { get; set; }
    public DateTime ExpiraEm { get; set; }
}

public class OAuthCodigo
{
    public string Hash { get; set; } = "";
    public string ClienteId { get; set; } = "";
    public string Plugin { get; set; } = "";
    public string UsuarioId { get; set; } = "";
    public string Email { get; set; } = "";
    public string CodeChallenge { get; set; } = "";
    public string RedirectUri { get; set; } = "";
    public DateTime ExpiraEm { get; set; }
    public DateTime? UsadoEm { get; set; }
}

/// <summary>Refresh token OAuth (opaco, em hash, selado). O acesso é um JWT ES256 com aud=&lt;plug-in&gt;.</summary>
public class OAuthToken
{
    public string Hash { get; set; } = "";
    public string ClienteId { get; set; } = "";
    public string Plugin { get; set; } = "";
    public string UsuarioId { get; set; } = "";
    public string Email { get; set; } = "";
    public string Familia { get; set; } = "";
    public DateTime ExpiraEm { get; set; }
    public DateTime? RevogadoEm { get; set; }
    public DateTime? UsadoEm { get; set; }
    /// <summary>Último JWT de acesso emitido: entra em core_oauth_revogados se a família for revogada.</summary>
    public string? UltimoJti { get; set; }
    public DateTime? UltimoJtiExpira { get; set; }
    public string? Selo { get; set; }
}

public class OAuthRevogado
{
    public string Jti { get; set; } = "";
    public string Plugin { get; set; } = "";
    public DateTime ExpiraEm { get; set; }
}

/// <summary>Token estático de MCP por plug-in (sai o apps-token.json do Cérebro). Só o hash fica guardado.</summary>
public class McpToken
{
    public string Id { get; set; } = "";
    public string Plugin { get; set; } = "";
    public string Hash { get; set; } = "";
    public string UsuarioId { get; set; } = "";
    public string Email { get; set; } = "";
    public DateTime CriadoEm { get; set; }
    public DateTime? UltimoUso { get; set; }
    public DateTime? RevogadoEm { get; set; }
    public string? Selo { get; set; }
}

public sealed record ClienteImportado(string Id, string? Nome, List<string>? RedirectUris, DateTimeOffset CriadoEm, DateTimeOffset? UltimoUso);
public sealed record RefreshImportado(string Hash, string ClienteId, string? Email, string? Familia, DateTimeOffset ExpiraEm);
public sealed record ImportacaoOAuthDto(List<ClienteImportado>? Clientes, List<RefreshImportado>? Refresh);
public sealed record ResultadoImportacao(int Clientes, int Tokens, int Ignorados);

public sealed record TokensOAuth(string AccessToken, string RefreshToken, int ExpiresIn);

/// <summary>
/// Servidor OAuth 2.1 do núcleo (spec 030), portado do Cérebro (spec 028) sem mudar o protocolo: DCR, código com
/// PKCE S256, rotação do refresh com detecção de reuso e revogação. Muda o recurso, que passa a ser
/// <c>&lt;base&gt;/&lt;plug-in&gt;/mcp</c>, e o acesso, que vira JWT com aud=&lt;plug-in&gt; validado pelo SDK.
/// </summary>
public sealed class OAuthDoNucleo(AppDbContext db, TokenService tokens, ChavesDeAssinatura chaves, TimeProvider? relogio = null)
{
    public static readonly TimeSpan VidaCodigo = TimeSpan.FromSeconds(60);
    public static readonly TimeSpan VidaPedido = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan VidaAcesso = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan VidaAtualizacao = TimeSpan.FromDays(30);
    public static readonly TimeSpan ClienteSemUso = TimeSpan.FromHours(24);

    private DateTime Agora => (relogio ?? TimeProvider.System).GetUtcNow().UtcDateTime;

    public static string Hash(string v) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(v))).ToLowerInvariant();
    public static string Aleatorio() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static bool RedirectValido(string uri) =>
        Uri.TryCreate(uri, UriKind.Absolute, out var u) && string.IsNullOrEmpty(u.Fragment)
        && (u.Scheme == Uri.UriSchemeHttps || (u.Scheme == Uri.UriSchemeHttp && (u.IsLoopback || u.Host == "localhost")));

    public static bool PkceValido(string verifier, string challenge)
    {
        if (verifier.Length is < 43 or > 128) return false;
        var calc = Convert.ToBase64String(SHA256.HashData(Encoding.ASCII.GetBytes(verifier))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(calc), Encoding.ASCII.GetBytes(challenge));
    }

    public static string SeloDe(ChavesDeAssinatura c, OAuthToken t) =>
        c.Selar("core_oauth_tokens", t.Hash, t.UsuarioId, t.Plugin, t.ClienteId, t.ExpiraEm.Ticks.ToString());

    /// <summary>Como em <see cref="Notas.Api.Auth.Selo.Confere(ChavesDeAssinatura, Notas.Api.Data.RefreshToken)"/>: até 9 ticks perdidos no Postgres.</summary>
    public static bool SeloConfere(ChavesDeAssinatura c, OAuthToken t)
    {
        for (var d = 0; d < 10; d++)
            if (c.SeloConfere(t.Selo, "core_oauth_tokens", t.Hash, t.UsuarioId, t.Plugin, t.ClienteId, (t.ExpiraEm.Ticks + d).ToString()))
                return true;
        return false;
    }

    public static string SeloDe(ChavesDeAssinatura c, McpToken t) => c.Selar("core_mcp_tokens", t.Hash, t.UsuarioId, t.Plugin);

    public async Task<OAuthCliente> Registrar(string nome, List<string> uris)
    {
        var limite = Agora - ClienteSemUso;
        await db.OAuthClientes.Where(c => c.UltimoUso == null && c.CriadoEm < limite && !db.OAuthTokens.Any(t => t.ClienteId == c.Id)).ExecuteDeleteAsync();
        await db.OAuthPedidos.Where(p => p.ExpiraEm < Agora).ExecuteDeleteAsync();
        var c = new OAuthCliente { Id = "mcp-" + Aleatorio()[..22], Nome = nome, RedirectUris = JsonSerializer.Serialize(uris), CriadoEm = Agora };
        db.OAuthClientes.Add(c);
        await db.SaveChangesAsync();
        return c;
    }

    public Task<OAuthCliente?> Cliente(string id) => db.OAuthClientes.FirstOrDefaultAsync(c => c.Id == id);

    public async Task<OAuthPedido> CriarPedido(string clienteId, string plugin, string redirect, string challenge, string? state)
    {
        var p = new OAuthPedido { Id = Aleatorio(), ClienteId = clienteId, Plugin = plugin, RedirectUri = redirect, CodeChallenge = challenge, State = state, ExpiraEm = Agora + VidaPedido };
        db.OAuthPedidos.Add(p);
        await db.SaveChangesAsync();
        return p;
    }

    public Task<OAuthPedido?> Pedido(string id) => db.OAuthPedidos.FirstOrDefaultAsync(p => p.Id == id && p.ExpiraEm > Agora);

    /// <summary>Aprovado: devolve o código (uso único, 60 s). Recusado: "". Pedido vencido ou já usado: null.</summary>
    public async Task<string?> Concluir(string pedidoId, bool aprovado, string usuarioId, string email)
    {
        var p = await Pedido(pedidoId);
        if (p is null) return null;
        if (await db.OAuthPedidos.Where(x => x.Id == pedidoId).ExecuteDeleteAsync() == 0) return null;
        if (!aprovado) return "";
        var codigo = Aleatorio();
        db.OAuthCodigos.Add(new OAuthCodigo
        {
            Hash = Hash(codigo), ClienteId = p.ClienteId, Plugin = p.Plugin, UsuarioId = usuarioId, Email = email,
            CodeChallenge = p.CodeChallenge, RedirectUri = p.RedirectUri, ExpiraEm = Agora + VidaCodigo,
        });
        await db.SaveChangesAsync();
        return codigo;
    }

    public async Task<TokensOAuth?> TrocarCodigo(string codigo, string clienteId, string redirect, string verifier)
    {
        var hash = Hash(codigo);
        var c = await db.OAuthCodigos.FirstOrDefaultAsync(x => x.Hash == hash);
        if (c is null) return null;
        if (c.UsadoEm is not null)
        {
            // Código repetido: alguém o interceptou. Derruba a família inteira.
            await RevogarFamilia(hash);
            return null;
        }
        c.UsadoEm = Agora;
        if (c.ExpiraEm < Agora || c.ClienteId != clienteId || c.RedirectUri != redirect || !PkceValido(verifier, c.CodeChallenge))
        {
            await db.SaveChangesAsync();
            return null;
        }
        return await Emitir(c.ClienteId, c.Plugin, c.UsuarioId, c.Email, familia: hash);
    }

    public async Task<TokensOAuth?> Atualizar(string refresh, string clienteId)
    {
        var hash = Hash(refresh);
        var t = await db.OAuthTokens.FirstOrDefaultAsync(x => x.Hash == hash);
        if (t is null || !SeloConfere(chaves, t)) return null;
        if (t.UsadoEm is not null && t.RevogadoEm is null)
        {
            await RevogarFamilia(t.Familia);
            return null;
        }
        if (t.RevogadoEm is not null || t.UsadoEm is not null || t.ExpiraEm < Agora || t.ClienteId != clienteId) return null;
        t.UsadoEm = Agora;
        return await Emitir(t.ClienteId, t.Plugin, t.UsuarioId, t.Email, t.Familia);
    }

    private async Task<TokensOAuth> Emitir(string clienteId, string plugin, string usuarioId, string email, string familia)
    {
        var acesso = tokens.CreateAccessToken(usuarioId, email, plugin, VidaAcesso,
            [new Claim("client_id", clienteId)]);
        var jtiReal = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().ReadJwtToken(acesso).Id;
        var refresh = Aleatorio();
        var t = new OAuthToken
        {
            Hash = Hash(refresh), ClienteId = clienteId, Plugin = plugin, UsuarioId = usuarioId, Email = email, Familia = familia,
            ExpiraEm = Agora + VidaAtualizacao, UltimoJti = jtiReal, UltimoJtiExpira = Agora + VidaAcesso,
        };
        t.Selo = SeloDe(chaves, t);
        db.OAuthTokens.Add(t);
        await db.OAuthClientes.Where(c => c.Id == clienteId).ExecuteUpdateAsync(s => s.SetProperty(c => c.UltimoUso, Agora));
        await db.SaveChangesAsync();
        return new TokensOAuth(acesso, refresh, (int)VidaAcesso.TotalSeconds);
    }

    /// <summary>Revoga refresh tokens e manda os JWT de acesso ainda válidos para a lista de revogados (60 s no SDK).</summary>
    private async Task RevogarOnde(IQueryable<OAuthToken> alvo)
    {
        var lista = await alvo.Where(t => t.RevogadoEm == null).ToListAsync();
        foreach (var t in lista)
        {
            t.RevogadoEm = Agora;
            if (t.UltimoJti is { } j && t.UltimoJtiExpira > Agora && !await db.OAuthRevogados.AnyAsync(r => r.Jti == j))
                db.OAuthRevogados.Add(new OAuthRevogado { Jti = j, Plugin = t.Plugin, ExpiraEm = t.UltimoJtiExpira!.Value });
        }
        await db.SaveChangesAsync();
    }

    private Task RevogarFamilia(string familia) => RevogarOnde(db.OAuthTokens.Where(t => t.Familia == familia));

    public async Task RevogarToken(string token)
    {
        var hash = Hash(token);
        if (await db.OAuthTokens.Where(t => t.Hash == hash).Select(t => t.Familia).FirstOrDefaultAsync() is { } f) await RevogarFamilia(f);
    }

    public async Task<bool> RevogarCliente(string clienteId, string usuarioId)
    {
        await RevogarOnde(db.OAuthTokens.Where(t => t.ClienteId == clienteId && t.UsuarioId == usuarioId));
        return true;
    }

    /// <summary>Clientes com token ativo do usuário, por plug-in (Configurações → Conexões).</summary>
    public async Task<List<object>> Autorizados(string usuarioId)
    {
        var ativos = await db.OAuthTokens.Where(t => t.UsuarioId == usuarioId && t.RevogadoEm == null && t.ExpiraEm > Agora)
            .Select(t => new { t.ClienteId, t.Plugin }).Distinct().ToListAsync();
        var ids = ativos.Select(a => a.ClienteId).ToList();
        var clientes = await db.OAuthClientes.Where(c => ids.Contains(c.Id)).ToDictionaryAsync(c => c.Id);
        return ativos.Where(a => clientes.ContainsKey(a.ClienteId)).Select(a => (object)new
        {
            id = a.ClienteId, nome = clientes[a.ClienteId].Nome, plugin = a.Plugin,
            ultimo_uso = clientes[a.ClienteId].UltimoUso, criado_em = clientes[a.ClienteId].CriadoEm,
        }).ToList();
    }

    public async Task<(McpToken linha, string token)> CriarMcpToken(string plugin, string usuarioId, string email)
    {
        var token = "hub_" + Aleatorio();
        var t = new McpToken { Id = Guid.NewGuid().ToString("N"), Plugin = plugin, Hash = Hash(token), UsuarioId = usuarioId, Email = email, CriadoEm = Agora };
        t.Selo = SeloDe(chaves, t);
        db.McpTokens.Add(t);
        await db.SaveChangesAsync();
        return (t, token);
    }

    /// <summary>
    /// Importação única do OAuth antigo de um plug-in (spec 033): clientes e refresh tokens ativos, só em hash.
    /// Repetir não duplica nada; e-mail sem usuário no núcleo fica de fora.
    /// </summary>
    public async Task<ResultadoImportacao> Importar(string plugin, ImportacaoOAuthDto dto)
    {
        var existentes = (await db.OAuthClientes.Select(c => c.Id).ToListAsync()).ToHashSet();
        var clientes = 0;
        foreach (var c in dto.Clientes ?? [])
        {
            if (string.IsNullOrWhiteSpace(c.Id) || !existentes.Add(c.Id)) continue;
            db.OAuthClientes.Add(new OAuthCliente
            {
                Id = c.Id, Nome = c.Nome ?? "", RedirectUris = System.Text.Json.JsonSerializer.Serialize(c.RedirectUris ?? []),
                CriadoEm = c.CriadoEm.UtcDateTime, UltimoUso = c.UltimoUso?.UtcDateTime,
            });
            clientes++;
        }
        var usuarios = (await db.Users.Select(u => new { u.Id, u.Email }).ToListAsync())
            .GroupBy(u => u.Email.ToLowerInvariant()).ToDictionary(g => g.Key, g => g.First().Id);
        var hashes = (await db.OAuthTokens.Select(t => t.Hash).ToListAsync()).ToHashSet();
        int tokens = 0, ignorados = 0;
        foreach (var t in dto.Refresh ?? [])
        {
            if (string.IsNullOrWhiteSpace(t.Hash) || t.Hash.Length != 64 || t.ExpiraEm.UtcDateTime <= Agora
                || !existentes.Contains(t.ClienteId) || !usuarios.TryGetValue((t.Email ?? "").ToLowerInvariant(), out var usuarioId))
            { ignorados++; continue; }
            if (!hashes.Add(t.Hash)) continue;
            var linha = new OAuthToken
            {
                Hash = t.Hash, ClienteId = t.ClienteId, Plugin = plugin, UsuarioId = usuarioId, Email = t.Email!,
                Familia = string.IsNullOrWhiteSpace(t.Familia) ? Guid.NewGuid().ToString("N") : t.Familia, ExpiraEm = t.ExpiraEm.UtcDateTime,
            };
            linha.Selo = SeloDe(chaves, linha);
            db.OAuthTokens.Add(linha);
            tokens++;
        }
        await db.SaveChangesAsync();
        return new ResultadoImportacao(clientes, tokens, ignorados);
    }

    /// <summary>Para o plug-in (60 s): jti revogados ainda válidos e os tokens MCP estáticos ativos dele (só hashes).</summary>
    /// <summary>
    /// Plug-ins que eram MCPs dos apps no núcleo (specs 034 e 035): continuam aceitando o token "apps" de Conexões e o
    /// arquivo antigo da tela do Cérebro, para os conectores e a rotina dos apps não quebrarem na extração.
    /// </summary>
    public static readonly string[] HerdamTokenDosApps = ["treino", "criativo", "dieta", "tarefas", "financas"];

    /// <summary>Para o plug-in (60 s): jti revogados ainda válidos e os tokens MCP estáticos ativos dele (só hashes).</summary>
    public async Task<object> Revogados(string plugin, (string Hash, string Usuario, string Email)? tokenDoArquivo = null)
    {
        await db.OAuthRevogados.Where(r => r.ExpiraEm < Agora).ExecuteDeleteAsync();
        var jtis = await db.OAuthRevogados.Where(r => r.Plugin == plugin).Select(r => r.Jti).ToListAsync();
        var herda = HerdamTokenDosApps.Contains(plugin);
        var donos = herda ? new[] { plugin, "apps" } : [plugin];
        var mcp = (await db.McpTokens.Where(t => donos.Contains(t.Plugin) && t.RevogadoEm == null).ToListAsync())
            .Where(t => t.Selo == SeloDe(chaves, t))
            .Select(t => new { hash = t.Hash, usuario = t.UsuarioId, email = t.Email }).ToList();
        if (herda && tokenDoArquivo is { } a && mcp.All(m => m.hash != a.Hash))
            mcp.Add(new { hash = a.Hash, usuario = a.Usuario, email = a.Email });
        return new { jtis, mcp };
    }
}
