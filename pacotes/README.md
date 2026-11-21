# Pacotes dos plug-ins (spec 032)

| Pacote | O que é | Onde chega |
|---|---|---|
| `Hub.Plugin.Sdk` (.NET 9) | `plugin.json`, login do núcleo (ES256 pelo JWKS), health, banco compartilhado e segredos | `.nupkg` anexado à Release `sdk-v<versão>` deste repositório (público): os plug-ins baixam sem token |
| `grafite-ui` | `grafite.css` (tokens + componentes `.g-*`), `<grafite-barra>` e `token-plugin.js` | servido pelo hub em `/grafite/` (mesmo domínio dos plug-ins) |

## Plug-in novo

1. "Use this template" no [hub-modelo](https://github.com/victorsouzadev/hub-modelo) (o [hub-exemplo](https://github.com/victorsouzadev/hub-exemplo) é o mesmo esqueleto já com login e banco).
2. `plugin.json`: `id`, `rota` = `/<id>`, `health` sob a rota e `tabelas.prefixo` (ex.: `dieta_`). As regras estão em
   [specs/029-nucleo-plugins/contracts/plugin-manifesto.md](../specs/029-nucleo-plugins/contracts/plugin-manifesto.md)
   e no [plugin.schema.json](plugin.schema.json) (`"$schema": "…/plugin.schema.json"` no editor completa os campos).
3. `sh scripts/baixar-sdk.sh` e `dotnet test`. A CI do plug-in testa, sobe o container e publica `ghcr.io/<dono>/hub-<id>:<commit>`.
4. No núcleo, uma linha no `plugins.lock` (`<id>: ghcr.io/<dono>/hub-<id>@<commit>`) num PR. Depois do deploy, o deployer
   baixa a imagem, confere o manifesto, copia o banco, sobe o container e só troca a versão se o health responder em 60 s
   e nenhuma tabela de outro dono mudar.

```csharp
var builder = WebApplication.CreateBuilder(args);
var manifesto = builder.AdicionarPlugin();                       // plugin.json + login do núcleo + porta
builder.Services.AddDbContext<Banco>((sp, o) => o.UsarBancoDoHub(sp.GetRequiredService<OpcoesDoHub>()));
var app = builder.Build();
app.UseAuthentication(); app.UseAuthorization();
app.MapHealthDoPlugin();
app.MapGet(manifesto.Rota + "/api/eu", (HttpContext c) => c.UsuarioId()).RequireAuthorization();
```

```html
<link rel="stylesheet" href="/grafite/grafite.css">
<script type="module" src="/grafite/grafite-barra.js"></script>
<grafite-barra atual="dieta"></grafite-barra>
<script type="module">
  import { fetchDoPlugin } from '/grafite/token-plugin.js';
  const r = await fetchDoPlugin('dieta', 'api/eu');   // troca o login do hub por um token aud=dieta e renova sozinho
</script>
```

## Regras que o SDK garante

- **Login**: só ES256 das chaves do JWKS do núcleo, `aud` = id do plug-in. O token do hub (`aud=notas-vps`) também
  vale enquanto `HUB_ACEITAR_AUDIENCIA_LEGADA` não for `false` (apps Android antigos).
- **Banco**: `UsarBancoDoHub` usa o `notas.db` montado em `/data/db`, histórico `__EFMigrationsHistory_<id>`, WAL e
  `busy_timeout=5000`, sem pool de conexões e com nova tentativa quando o banco responde ocupado (1.4.0; transação explícita do EF vai dentro de `CreateExecutionStrategy().ExecuteAsync`). `ReferenciarUsuarios()` mapeia `users` só com o `Id`. Num teste,
  `Dados.TabelasForaDoDono(db.Model, manifesto)` tem de dar vazio.
- **Base de migração** (ferramenta extraída, tabelas que já existem): `dotnet ef migrations add Base`, troque a classe
  base para `MigracaoDeBase` e apague o `Up`/`Down` gerados (não compilam). Chame `db.MigrarComBase()` em vez de
  `Migrate()`: na primeira subida ele confere tabelas, colunas e tipos do modelo da base com o banco e não sobe se
  algo não bater (o deployer mantém a versão anterior).
- **Banco ocupado**: um `SQLITE_BUSY` que passa dos 5 s vai para o log com "SQLITE_BUSY" e soma em `Dados.Ocupado`.
  `scripts/carga-sqlite.sh` (no núcleo) mede com 3 processos gravando juntos.
- **MCP**: `app.MapMcp(manifesto.Mcp!).ExigirMcpDoPlugin()` aceita o OAuth do núcleo (`aud=<id>`, `jti` revogado para
  em até 60 s) e os tokens `hub_…` de Configurações → Conexões; o login do hub (`aud=notas-vps`) não abre o MCP. Sem
  login, o 401 traz o `resource_metadata` que o Claude usa para descobrir o OAuth.
- **IA**: com `usaIa: true` no manifesto, `IaDoHub.ObterConfiguracao(httpContext)` devolve provedor, modelo e chave
  de IA do usuário da requisição (guardados no núcleo, 10 min em memória).
- **Segredos**: `Segredos.DoAmbiente()` cifra com AES-GCM e a `SEGREDO_PLUGIN` do plug-in.

## Variáveis que o deployer passa

`HUB_PLUGIN_ID`, `HUB_BANCO`, `HUB_JWKS`, `HUB_NUCLEO`, `HUB_SEGREDO_SERVICO` (chamadas a `/api/core/*`, como
`/api/core/revogados`) e `VERSAO`. Nunca `JWT_SECRET` nem `data/core`.

## Versões

Mudar `<Version>` no `Hub.Plugin.Sdk.csproj` publica uma Release nova (`.github/workflows/pacotes.yml`). O deployer aceita
o contrato atual e o anterior (`Plugins.ContratoAtual`).
