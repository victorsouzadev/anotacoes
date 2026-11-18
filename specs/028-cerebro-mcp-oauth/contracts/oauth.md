# Contrato: OAuth 2.1 do Cérebro

| Método | Rota | Função |
|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource/cerebro/mcp` | metadata do recurso (`authorization_servers`) |
| `GET` | `/.well-known/oauth-authorization-server/cerebro` | metadata do servidor (endpoints, `code_challenge_methods_supported: ["S256"]`) |
| `POST` | `/cerebro/oauth/register` | registro dinâmico (RFC 7591): `{ client_name, redirect_uris }` → `{ client_id }` |
| `GET` | `/cerebro/oauth/authorize` | valida parâmetros e redireciona para `/autorizar?...` (Angular) |
| `POST` | `/cerebro/oauth/consent` | JWT do hub; `{ request_id, aprovar }` → `{ redirect }` com `code`+`state` ou `error=access_denied` |
| `POST` | `/cerebro/oauth/token` | `grant_type=authorization_code` (com `code_verifier`) ou `refresh_token` |
| `POST` | `/cerebro/oauth/revoke` | RFC 7009 |
| `GET` | `/cerebro/api/v1/web/oauth/clientes` | lista para a tela Conectar (JWT) |
| `DELETE` | `/cerebro/api/v1/web/oauth/clientes/{id}` | revogar (JWT) |

`/cerebro/mcp` aceita: `Authorization: Bearer <token OAuth>` **ou** o token estático atual.
