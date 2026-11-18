# Data Model: OAuth 2.1 no MCP

Tabelas novas no `hub.db` (o mesmo arquivo do `HubDb`), criadas e usadas pelo `OAuthStore` (`cerebro/src/Hub/Api/OAuthStore.cs`); apagá-las só desconecta os aplicativos, sem afetar o vault. A implementação acrescentou `oauth_pedidos` (pedidos de autorização à espera da página de consentimento, 10 min):

| Tabela | Campos |
|---|---|
| `oauth_clients` | `id`, `nome`, `redirect_uris` (JSON), `criado_em`, `ultimo_uso` |
| `oauth_codes` | `hash`, `client_id`, `email`, `code_challenge`, `redirect_uri`, `expira_em`, `usado_em` |
| `oauth_tokens` | `hash`, `tipo` (`access`/`refresh`), `client_id`, `email`, `familia`, `expira_em`, `revogado_em`, `ultimo_uso` |

Revogar um cliente = `revogado_em` em todos os tokens da família/cliente.
