# Data Model: OAuth 2.1 no MCP

Tabelas novas no `HubDb` (`cerebro/src/Hub/Data/HubDb.cs`), todas recriáveis sem afetar o vault:

| Tabela | Campos |
|---|---|
| `oauth_clients` | `id`, `nome`, `redirect_uris` (JSON), `criado_em`, `ultimo_uso` |
| `oauth_codes` | `hash`, `client_id`, `email`, `code_challenge`, `redirect_uri`, `expira_em`, `usado_em` |
| `oauth_tokens` | `hash`, `tipo` (`access`/`refresh`), `client_id`, `email`, `familia`, `expira_em`, `revogado_em`, `ultimo_uso` |

Revogar um cliente = `revogado_em` em todos os tokens da família/cliente.
