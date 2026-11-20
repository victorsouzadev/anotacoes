# Contrato: o que os pacotes oferecem

## `Hub.Plugin.Sdk` (NuGet)

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.AdicionarPlugin("plugin.json");          // lê manifesto, JWKS, token de serviço, health
builder.Services.AddDbContext<DietaDb>(o => o.UsarBancoDoHub("dieta"));
builder.Services.AddMcpDoPlugin().WithTools<DietaMcpTools>();

var app = builder.Build();
app.UsarPlugin();                                 // auth, health em <rota>/api/health, plugin.json
app.MapGroup("/dieta/api").RequireAuthorization() // e as rotasLegadas mapeadas para o mesmo grupo
   .MapDietaEndpoints();
app.MapMcpDoPlugin();                             // <rota>/mcp com OAuth do núcleo ou token estático
app.Run();
```

| Módulo | Expõe |
|---|---|
| `Auth` | `JwtBearer` por JWKS, `aud=<id>` (+ `notas-vps` se `AceitarAudienciaLegada`), `ClaimsPrincipal.UserId()` |
| `Servico` | token `aud=core` para `/api/core/*`, renovado sozinho |
| `Dados` | `UsarBancoDoHub`, `ReferenciarUsuarios`, `TabelasDoPlugin.Conferir`, migração de base |
| `Health` | `GET <rota>/api/health` → `{ status, versao }` |
| `Mcp` | auth de MCP (OAuth JWT ou token estático, com lista de revogados a cada 60 s) |
| `Ia` | `IaDoHub.ObterConfiguracao()` (com o token do usuário da requisição) |
| `Segredos` | AES-GCM com `SEGREDO_PLUGIN` |

## `@grafite/ui` (npm)

| Arquivo | Uso |
|---|---|
| `tokens.css`, `fontes.css` | `@import` no estilo global |
| `icones.js` | mesmo conjunto de `shared/icon.ts` |
| `grafite-barra.js` | `<grafite-barra plugin="dieta"></grafite-barra>` |
| `token-plugin.js` | `tokenDoPlugin("dieta")` → `Promise<string>`; interceptores chamam antes de cada requisição |

## `plugin.schema.json`

JSON Schema 2020-12 do manifesto (029), com `$id` versionado pelo número do contrato.
