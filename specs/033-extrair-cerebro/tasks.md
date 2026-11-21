# Tasks: Extrair o Segundo Cérebro como primeiro plug-in

## Phase 1: Setup

- [x] T001 Criar o repositório `hub-cerebro` no GitHub (usuário) e `git subtree split --prefix=cerebro` para ele
- [x] T002 Copiar `frontend/src/app/features/cerebro/` (menos `autorizar.page.ts`) e a página `/capturar` para `hub-cerebro/web/`, com build Angular próprio — servido pelo plug-in em `/cerebro/` e `/cerebro/capturar`; `/capturar`, `/sw-cerebro.js` e `/cerebro-app` em `rotasLegadas`; a API aceita `aud=cerebro`

## Phase 2: Foundational

- [x] T003 `Program.cs` com `AdicionarPlugin`, auth por JWKS e `plugin.json` (rotas legadas `/cerebro/*`, `/capturar`) — feito com o `JwksDoNucleo` que o Cérebro já tinha e `UsePathBase("/cerebro")`; troca pelo SDK quando a Release `sdk-v1.0.0` existir
- [x] T004 `CerebroDb` com `UsarBancoDoHub("cerebro")`: `cerebro_capturas`, `cerebro_configuracoes`; teste `TabelasDoPlugin`
- [x] T005 `POST /api/core/oauth/importar` no núcleo (uma vez por plug-in, token de serviço), com teste

## Phase 3: User Story 1 - Nada muda para quem usa (P1) 🎯 MVP

- [x] T006 [US1] `Migracao033` (capturas, configurações, OAuth via importar; contagens; `hub.db.pre-033`), idempotente, com testes — o `hub.db` fica intacto (acessos e WebDAV seguem nele) e ganha o marcador `hub.db.migrado-033`
- [x] T007 [US1] IA do núcleo no `ClaudeClassifier`/`Embeddings`, com cópia única da chave atual se o núcleo não tiver — `IaDoNucleo` lê `/api/core/ia` com o token do usuário (em memória, 10 min) e vale antes da do Cérebro; sem chave no núcleo, segue a atual (a cópia para o núcleo fica para quando ele tiver rota de gravação). Embeddings seguem com a chave do servidor
- [x] T008 [US1] Reindexação em background quando o índice derivado falta; busca responde "indexando" (MCP, `X-Indexando` na tela e `indexando` no health)
- [x] T009 [US1] Ensaio com cópia de produção (quickstart passos 1–2)

## Phase 4: User Story 2 - Deploy pelo repositório (P1)

- [x] T010 [US2] CI do `hub-cerebro` com `plugin.yml`; linha no `plugins.lock`; serviço `cerebro` sai do `docker-compose.yml`

## Phase 5: User Story 3 - Tokens em um só lugar (P2)

- [ ] T011 [US3] Remover a geração de tokens estáticos da tela do Cérebro depois que `Notas.Api` e `ops` leem `core_mcp_tokens` (030)

## Phase 6: Polish

- [ ] T012 Depois de 7 dias no ar: remover `cerebro/`, `features/cerebro/` e o job do Cérebro da CI do núcleo
- [x] T013 [P] Atualizar specs 011, 026–028 (onde o código mora agora), README e `DEPLOY.md` (com a receita da troca); o deployer passou a montar `dados` do `plugin.json` em `data/plugins/dados/<id>/<nome>`
