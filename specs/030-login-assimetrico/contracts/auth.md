# Contrato: login do núcleo para plug-ins

| Método | Rota | Quem chama | Função |
|---|---|---|---|
| `GET` | `/.well-known/jwks.json` | plug-ins (SDK) | chaves públicas ES256 (`kid` atual e anterior) |
| `POST` | `/api/auth/token-plugin` | tela do plug-in, apps | `{ plugin }` + token do hub → `{ access_token, expires_in }` com `aud=<id>` |
| `GET` | `/api/core/revogados?desde=` | plug-ins (SDK, a cada 60 s) | `jti` OAuth revogados e hashes de tokens MCP ativos do plug-in |
| `GET` | `/.well-known/oauth-protected-resource/<id>/mcp` | Claude | metadata do recurso do plug-in |
| `GET` | `/.well-known/oauth-authorization-server` | Claude | metadata do servidor (núcleo) |
| `POST` | `/api/core/oauth/register` · `GET /authorize` · `POST /token` · `POST /revoke` | Claude | como na 028, com `resource=<base>/<id>/mcp` |
| `POST` | `/cerebro/oauth/token` · `/cerebro/oauth/revoke` · `/cerebro/oauth/authorize` | conectores antigos | rotas legadas da 028, atendidas pelo núcleo |
| `GET` | `/api/core/ia` | plug-ins com `usaIa`, repassando o token do usuário (`aud=<id>`) | provedor, modelo e chave de IA **daquele** usuário (032); sem token de usuário, recusa |
| `POST` | `/api/core/oauth/importar` | Cérebro, uma vez | importar clientes e famílias OAuth do `hub.db` (033) |
| `POST` | `/api/core/segredos/recifrar` | Finanças, uma vez por linha | decifrar segredo antigo para o plug-in recifrar (035) |
| `GET/POST/DELETE` | `/api/core/mcp-tokens` | tela Configurações → Conexões | gerar, listar e revogar tokens estáticos por plug-in |

As chamadas de plug-in para `/api/core/*` usam um token de serviço do plug-in (`aud=core`, `sub=plugin:<id>`), emitido pelo deployer no deploy e renovado pelo SDK.

## Claims do token de plug-in

```json
{ "iss": "https://<domínio>", "sub": "<userId>", "email": "<e-mail>", "aud": "dieta",
  "exp": 1763560000, "jti": "<id>", "kid": "2026-11" }
```
