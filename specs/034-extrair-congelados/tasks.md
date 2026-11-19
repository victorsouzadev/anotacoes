# Tasks: Extrair e congelar as ferramentas sem uso

## Phase 1: Setup

- [ ] T001 Criar `hub-criativo` e `hub-treino` no GitHub (usuário) a partir do `hub-modelo` (032)
- [ ] T002 Medir o tempo da CI do núcleo (linha de base para SC-003)

## Phase 2: User Story 1 - Criativo no ar (P1) 🎯 MVP

- [ ] T003 [US1] Mover `ImagemEndpoints`, `MoldesEndpoints`, `ViihMimosEndpoints`, `Services/Imagens`, `Services/Moldes`, `CriativoMcpTools` para `hub-criativo/src/Criativo.Api` com o SDK; `CriativoDb` com `imagem_*` e migração de base
- [ ] T004 [US1] Mover telas `imagem`, `moldes`, `cake`, `precificacao` para `hub-criativo/web` (com cópia de `shared/pdf.ts`, `shared/heic.ts`) e os testes delas
- [ ] T005 [US1] Mover `desktop/` e trocar `NotasApp.Build` por `CriativoApp.Build`; workflow do instalador no `hub-criativo`
- [ ] T006 [US1] `plugin.json` com rotas legadas; ensaio com cópia de produção

## Phase 3: User Story 1 - Treino no ar (P1)

- [ ] T007 [US1] Mover `TreinoEndpoints`, `TreinoMcpTools`, tela `treino` e testes para `hub-treino`; `TreinoDb` com `treino_*` e base; rotas legadas

## Phase 4: User Story 2 - Núcleo menor (P1)

- [ ] T008 [US2] Remover do núcleo endpoints, services, MCP tools e entidades (migração vazia, sem `DropTable`), telas e rotas, `desktop/`, `desktop.yml`, jobs da CI
- [ ] T009 [US2] Marcar os dois como `congelado` no manifesto e no `plugins.lock`

## Phase 5: Polish

- [ ] T010 [P] Atualizar specs 006–009, 013, 017, README e `DEPLOY.md`
- [ ] T011 Medir a CI de novo (SC-003)
