using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Notas.Api.Auth;

/// <summary>
/// Emite os tokens de acesso do hub. Desde a spec 030 assina com ES256 (chave do núcleo, <c>kid</c> no
/// cabeçalho); tokens HS256 antigos, assinados com o JWT_SECRET, valem só até <c>AceitarHs256Ate</c>.
/// </summary>
public class TokenService(ChavesDeAssinatura chaves)
{
    public const string Emissor = "notas-vps";

    /// <summary>Audiência do token do hub (web e apps Android), aceita pelos plug-ins na transição.</summary>
    public const string AudienciaHub = "notas-vps";

    public static readonly TimeSpan AccessTokenLifetime = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan RefreshTokenLifetime = TimeSpan.FromDays(30);

    public ChavesDeAssinatura Chaves => chaves;

    public string CreateAccessToken(string userId, string email) => CreateAccessToken(userId, email, AudienciaHub);

    public string CreateAccessToken(string userId, string email, string audiencia, TimeSpan? validade = null,
        IEnumerable<Claim>? extras = null)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId),
            new(JwtRegisteredClaimNames.Email, email),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N")),
        };
        if (extras is not null) claims.AddRange(extras);
        var token = new JwtSecurityToken(
            issuer: Emissor,
            audience: audiencia,
            claims: claims,
            expires: DateTime.UtcNow.Add(validade ?? AccessTokenLifetime),
            signingCredentials: new SigningCredentials(chaves.Atual, ChavesDeAssinatura.Algoritmo));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>Validação do núcleo: ES256 pelas chaves válidas e, até o limite, HS256 pelo JWT_SECRET.</summary>
    public static TokenValidationParameters ValidationParameters(string secret, ChavesDeAssinatura chaves,
        DateTime aceitarHs256Ate, Func<DateTime>? agora = null)
    {
        var hmac = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var relogio = agora ?? (() => DateTime.UtcNow);
        return new TokenValidationParameters
        {
            ValidIssuer = Emissor,
            ValidAudience = AudienciaHub,
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ClockSkew = TimeSpan.FromSeconds(30),
            ValidAlgorithms = [SecurityAlgorithms.EcdsaSha256, SecurityAlgorithms.HmacSha256],
            IssuerSigningKeyResolver = (_, tokenSeguranca, _, _) =>
            {
                var alg = (tokenSeguranca as Microsoft.IdentityModel.JsonWebTokens.JsonWebToken)?.Alg
                          ?? (tokenSeguranca as JwtSecurityToken)?.Header.Alg;
                if (alg == SecurityAlgorithms.HmacSha256)
                    return relogio() <= aceitarHs256Ate ? [hmac] : [];
                return chaves.Validas;
            },
        };
    }

    public static string GenerateRefreshToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');

    public static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
