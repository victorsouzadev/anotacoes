# Tasks: Login com chave assimétrica e OAuth no núcleo

## Phase 2: Foundational

- [x] T001 `ChavesDeAssinatura` (gerar no primeiro boot, carregar, rotacionar, JWKS com atual + anterior) em `backend/Notas.Api/Auth/`, com testes
- [x] T002 `TokenService` assinando ES256 com `kid`; validação aceita HS256 só até `AceitarHs256Ate`; testes
- [x] T003 Coluna `Selo` (HMAC) em `users`, `refresh_tokens`, `core_oauth_tokens`, `core_mcp_tokens`; selar linhas antigas no boot; login e refresh recusam selo inválido; testes de escrita direta no banco
- [x] T004 Montar `data/core/chaves` só no serviço `api` em `docker-compose.yml`; incluir no backup (025)

## Phase 3: User Story 1 e 4 - Um login, apps sem quebrar (P1) 🎯 MVP

- [ ] T005 [US1] `GET /.well-known/jwks.json` e `POST /api/auth/token-plugin` (só plug-ins registrados — 029) em `AuthEndpoints.cs`; testes
- [ ] T006 [US1] Cliente de token por plug-in no `@grafite/ui` (032) com renovação automática
- [ ] T007 [US4] Teste de regressão: token `aud=notas-vps` atual aceito por plug-in com `AceitarAudienciaLegada=true`; refresh do app Android sem mudança

## Phase 4: User Story 2 - Plug-in não forja login (P1)

- [ ] T008 [US2] Deployer recusa subir plug-in com variável `JWT_SECRET` ou montagem de `data/core`; teste
- [ ] T009 [US2] Teste: token assinado por chave fora do JWKS recusado pelo SDK

## Phase 5: User Story 3 - OAuth por plug-in (P2)

- [ ] T010 [US3] Portar `OAuthStore`/`OAuthEndpoints` do `cerebro` para o `Notas.Api` (tabelas `core_oauth_*`), recurso `/<id>/mcp`, token de acesso JWT com `aud=<id>`
- [ ] T011 [US3] Portar `cerebro/tests/Hub.Tests/OAuthTests.cs` para `Notas.Api.Tests`, mais teste de `aud` cruzado
- [ ] T012 [US3] `GET /api/core/revogados` e tabela `core_oauth_revogados`; limpeza dos vencidos
- [ ] T013 [US3] Página `/autorizar` passa a mostrar o plug-in; Caddy: `/.well-known/oauth-*` e as rotas legadas `/cerebro/oauth/*` → núcleo
- [ ] T014 [US3] Configurações → Conexões: aplicativos autorizados (por plug-in) e tokens MCP estáticos (`core_mcp_tokens`)

## Phase 6: Polish

- [ ] T015 [P] Atualizar spec 028 (OAuth no núcleo, revogação em até 60 s), `DEPLOY.md` (chave, janela HS256), `.env.example`
- [ ] T016 CI inteira verde
