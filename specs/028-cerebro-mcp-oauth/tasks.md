# Tasks: OAuth 2.1 no MCP do Segundo Cérebro

## Phase 2: Foundational

- [x] T001 Tabelas `oauth_clients`, `oauth_codes`, `oauth_tokens` em `cerebro/src/Hub/Data/HubDb.cs` e `OAuthStore` (hash SHA-256, expiração, rotação) em `cerebro/src/Hub/Api/OAuthStore.cs`
- [x] T002 [P] Testes de `OAuthStore` em `cerebro/tests/Hub.Tests/OAuthTests.cs`
- [x] T003 Rotas `/.well-known/oauth-*` para o `cerebro` nos `caddy/Caddyfile*`

## Phase 3: User Story 1 - Conectar (P1) 🎯 MVP

- [x] T004 [US1] Metadata (`.well-known`), `register`, `authorize`, `consent`, `token` em `cerebro/src/Hub/Api/OAuthEndpoints.cs`
- [x] T005 [US1] Middleware do `/mcp` em `cerebro/src/Hub/Program.cs`: aceita OAuth ou token estático; 401 com `WWW-Authenticate`
- [x] T006 [US1] Página `frontend/src/app/features/cerebro/autorizar.page.ts` (rota `autorizar` na raiz de `app.routes.ts`, com login) com Permitir/Recusar
- [x] T007 [P] [US1] Testes do fluxo completo (PKCE, código único, redirect exato, e-mail fora da lista, token estático)

## Phase 4: User Story 2 - Revogar (P1)

- [x] T008 [US2] `revoke` + lista/revogação em `/api/v1/web/oauth/clientes`
- [x] T009 [US2] Seção "Aplicativos autorizados" em Conectar

## Phase 5: User Story 3 - Renovação (P2)

- [x] T010 [US3] `refresh_token` com rotação e detecção de reuso; testes

## Phase 6: Polish

- [x] T011 [P] `cerebro/README.md` (OAuth pronto), `DEPLOY.md` (Caddy), spec 011
- [x] T012 `dotnet test segundo-cerebro.slnx` e `npx ng test`/`ng build`
