# Tasks: Extrair as ferramentas em uso

## Phase 2: Foundational

- [X] T001 `RelogioDoHub` no SDK (032) substituindo `FinancasClock` em Dieta, Tarefas e Finanças, com testes (SDK 1.3.0; o núcleo segue com FinancasClock até cada extração)
- [X] T002 `POST /api/core/segredos/recifrar` no núcleo (uma vez por linha, token de serviço), com testes
- [X] T003 [P] URLs base configuráveis nos apps Android (`mobile/dieta`, `mobile/app`), ainda apontando para as rotas atuais (já existia: endereço do servidor nas configurações dos dois apps; os plug-ins mantêm /api/dieta e /api/tasks)

## Phase 3: User Story 1 - Dieta (P1) 🎯 MVP

- [ ] T004 [US1] Criar `hub-dieta` (usuário); mover `DietaEndpoints`, `DietaIaEndpoints`, `Services/Dieta`, `DietaMcpTools`, tela `dieta`, testes e `mobile/dieta` (Gradle próprio)
- [ ] T005 [US1] `DietaDb` (`dieta_*`, base), `plugin.json` com `/api/dieta`, `/api/mcp/dieta`, `/dieta`; IA do núcleo
- [ ] T006 [US1] Ensaio, deploy, conferência (quickstart); remover do núcleo, inclusive `android-dieta.yml`

## Phase 4: User Story 2 - Tarefas (P1)

- [ ] T007 [US2] Criar `hub-tarefas`; mover `TasksEndpoints`, `TarefasMcpTools`, telas `tasks`, testes e `mobile/app`
- [ ] T008 [US2] `TarefasDb` (`tasks_*`, base), rotas legadas `/api/tasks`, `/api/mcp/tarefas`, `/tasks`
- [ ] T009 [US2] Ensaio, deploy, conferência; remover do núcleo

## Phase 5: User Story 3 - Anotação (P2)

- [ ] T010 [US3] Criar `hub-anotacao`; mover `AnotacaoEndpoints`, `Services/Anotacao`, tela; `dados: ["/anotacao"]`; rotas `/api/anotacao`, `/anotacao`
- [ ] T011 [US3] Ensaio, deploy, conferência; remover do núcleo

## Phase 6: User Story 4 - Finanças (P2)

- [ ] T012 [US4] Criar `hub-financas`; mover Finanças, Orçamento, Meta, Planejamento, ChatFinanceiro, AUVP, `FinancasMcpTools`, tela e testes
- [ ] T013 [US4] `FinancasDb` (`financas_*` + `configuracoes_auvp`, base); recifrar AUVP na primeira subida (T002)
- [ ] T014 [US4] Ensaio com totais do painel; deploy; conferência; remover do núcleo

## Phase 7: User Story 5 - Notas (P3)

- [ ] T015 [US5] Levar o e2e de sincronização (lixeira, tags, celular) para Playwright na CI, ainda no núcleo, e deixar verde
- [ ] T016 [US5] Criar `hub-notas`; mover endpoints de notas, pastas, links, `Services/Lixeira`, telas `notes`/`editor`, `shared/pdf.ts`, `shared/heic.ts`, testes e e2e
- [ ] T017 [US5] `NotasDb` (`notes`, `folders`, `note_shares` como legadas, base); rotas `/api/notes`, `/api/folders`, `/notes`, `/p/nota`; worker da lixeira só no plug-in
- [ ] T018 [US5] Ensaio com edição offline atravessando o deploy; deploy; conferência; remover do núcleo

## Phase 8: Polish

- [ ] T019 [P] Atualizar as retroativas 002–005, 012 e as evoluções 015–024 (onde o código mora), README, `DEPLOY.md`, constituição (tabela de restrições)
- [ ] T020 Conferir SC-004 (tamanho do `Notas.Api`)
