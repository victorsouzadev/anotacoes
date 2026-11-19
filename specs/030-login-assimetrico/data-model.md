# Data Model: Login com chave assimétrica e OAuth no núcleo

Tabelas do núcleo no `notas.db` (prefixo `core_`, dono: núcleo; plug-ins não leem — 031):

| Tabela | Campos |
|---|---|
| `core_oauth_clientes` | `Id`, `Nome`, `RedirectUris` (JSON), `CriadoEm`, `UltimoUso` |
| `core_oauth_codigos` | `Hash`, `ClienteId`, `Plugin`, `Email`, `CodeChallenge`, `RedirectUri`, `ExpiraEm`, `UsadoEm` |
| `core_oauth_pedidos` | `Id`, `ClienteId`, `Plugin`, `RedirectUri`, `CodeChallenge`, `State`, `ExpiraEm` |
| `core_oauth_tokens` | `Hash` (refresh), `ClienteId`, `Plugin`, `Email`, `Familia`, `ExpiraEm`, `RevogadoEm`, `UltimoUso` |
| `core_oauth_revogados` | `Jti`, `Plugin`, `ExpiraEm` (limpo quando vence) |
| `core_mcp_tokens` | `Id`, `Plugin`, `Hash`, `Email`, `CriadoEm`, `UltimoUso`, `RevogadoEm` |

Fora do banco: `data/core/chaves/<kid>.pem` (privada) e `data/core/chaves/jwks.json` (públicas, atual + anterior).

Coluna nova `Selo` (HMAC-SHA256, texto) em `users`, `refresh_tokens`, `core_oauth_tokens` e `core_mcp_tokens`. Chave em `data/core/chaves/selo.key`, só no núcleo. Linhas antigas são seladas no primeiro boot depois da migração.
