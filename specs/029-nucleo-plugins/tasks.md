# Tasks: Núcleo do hub e contrato de plug-ins

## Phase 1: Setup

- [x] T001 Criar `plugins.lock` vazio na raiz e documentar o formato em `DEPLOY.md`
- [x] T002 [P] Criar o repositório `hub-exemplo` (pelo usuário no GitHub) com health, uma página e `plugin.json`, usando o SDK da 032

## Phase 2: Foundational

- [x] T003 Tabela `core_plugins_estado` (migração EF do núcleo) em `backend/Notas.Api/Data/`
- [x] T004 `ModulosDoNucleo` (ferramentas internas no formato do manifesto) em `backend/Notas.Api/Services/Plugins/`
- [x] T005 [P] Funções puras de validação (id, rota, reservadas, prefixo, contrato) no deployer, com testes em `deployer/tests/`

## Phase 3: User Story 1 - Ligar um plug-in (P1) 🎯 MVP

- [x] T006 [US1] Deployer: ler `plugins.lock`, extrair `plugin.json` da imagem, validar e subir o container na rede do hub com `data/db` montado
- [x] T007 [US1] Deployer: gerar `caddy/plugins.d/<id>.caddy` e recarregar o Caddy; `import plugins.d/*.caddy` nos `caddy/Caddyfile*`
- [x] T008 [US1] `GET /api/plugins` em `backend/Notas.Api/Endpoints/PluginsEndpoints.cs`, com testes de integração
- [x] T009 [US1] `frontend/src/app/core/plugins.service.ts` e cards do hub a partir da API em `features/hub/hub.page.ts` (Vitest)
- [x] T010 [US1] Remover do `plugins.lock` para o container e mantém os dados (teste do deployer)

## Phase 4: User Story 2 - Saúde (P1)

- [x] T011 [US2] `HealthCache` em background (30 s) gravando em `core_plugins_estado`
- [x] T012 [US2] Card "indisponível" no hub e lista de plug-ins/versões em Configurações → Servidor

## Phase 5: User Story 4 - URLs antigas (P1)

- [x] T013 [US4] Geração de `handle` para `rotasLegadas` sem reescrever caminho; teste com `/api/dieta/*` e `/api/mcp/tarefas/*`
- [ ] T014 [US4] Script de conferência de 404 novos nos logs do proxy depois de cada extração (`scripts/conferir-rotas.sh`)

## Phase 6: User Story 3 - Deploy pelo repositório do plug-in (P2)

- [x] T015 [US3] Workflow reutilizável `.github/workflows/plugin.yml` (testar, publicar no GHCR, abrir PR no núcleo trocando a versão)
- [x] T016 [US3] Deployer: recriar só o plug-in alterado; volta automática se o health falhar em 60 s; testes

## Phase 7: Polish

- [ ] T017 [P] Backup (025) inclui as pastas `dados` dos manifestos
- [x] T018 [P] README ("Estrutura do projeto", seção Plug-ins), `DEPLOY.md`, `CLAUDE.md`
- [ ] T019 CI inteira verde
