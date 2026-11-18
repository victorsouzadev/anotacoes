# Tasks: Tela web da Dieta

**Input**: Design documents from `/specs/016-dieta-web/`

**Prerequisites**: plan.md, spec.md, research.md, contracts/api-usada.md

**Tests**: testes unitários para a lógica pura (somas, média móvel, montagem de upsert).

## Phase 1: Setup

- [ ] T001 Criar a pasta `frontend/src/app/features/dieta/` e a rota lazy `dieta` em `frontend/src/app/app.routes.ts` (com o guard de auth das outras rotas)
- [ ] T002 [P] Ícone da Dieta em `frontend/src/app/shared/icon.ts` e card "Dieta" com link do APK (`/downloads/android/Dieta.apk`) em `frontend/src/app/features/hub/hub.page.ts`

## Phase 2: Foundational

- [ ] T003 Modelos TS espelhando `Dtos/DietaDtos.cs` em `frontend/src/app/features/dieta/dieta.models.ts`
- [ ] T004 `DietaApiService` com os métodos do contrato em `frontend/src/app/features/dieta/dieta-api.service.ts` (ids por `core/uuid`, `updatedAt` local, datas `yyyy-MM-dd` no fuso local)
- [ ] T005 [P] Funções puras em `frontend/src/app/features/dieta/dieta-calc.ts`: data local ↔ string, média móvel de 7 dias, agrupamento de registros por refeição; testes em `dieta-calc.spec.ts`

**Checkpoint**: serviço e cálculos prontos.

## Phase 3: User Story 1 - Ver o dia (P1) 🎯 MVP

- [ ] T006 [US1] Página `frontend/src/app/features/dieta/dieta.page.ts` com abas (Hoje, Progresso, Perfil e plano, Compartilhar) e estado em signals
- [ ] T007 [US1] Componente do dia `frontend/src/app/features/dieta/dia/dia.component.ts`: totais × meta (barras), água, peso, refeições, adesão, setas de dia
- [ ] T008 [US1] Estados vazios: sem perfil (convite), dia sem registros, erro de rede

## Phase 4: User Story 2 - Registrar (P1)

- [ ] T009 [US2] Busca de alimento com debounce (`/alimentos?q=` + `/alimentos/meus`) em `frontend/src/app/features/dieta/dia/adicionar-item.component.ts`
- [ ] T010 [US2] Registrar, editar quantidade e excluir item (PUT com `deletedAt`) no componente do dia
- [ ] T011 [US2] Repetir refeição de outro dia (`POST /registros/repetir`)
- [ ] T012 [P] [US2] Registrar água (botões +250/+500 ml) e peso do dia

## Phase 5: User Story 3 - Progresso (P2)

- [ ] T013 [US3] `frontend/src/app/features/dieta/progresso/progresso.component.ts`: nível, XP, sequências, conquistas, desafio
- [ ] T014 [P] [US3] Gráfico de peso com média móvel e kcal por dia (Chart.js, tema do app)
- [ ] T015 [P] [US3] Heatmap de adesão

## Phase 6: User Story 4 - Perfil, metas e plano (P2)

- [ ] T016 [US4] Formulário de perfil e metas com a sugestão ao lado em `frontend/src/app/features/dieta/perfil/perfil.component.ts`
- [ ] T017 [US4] Plano da semana (dias × refeições) com editar e excluir itens

## Phase 7: User Story 5 - Compartilhar e CSV (P3)

- [ ] T018 [US5] Lista, criação (escopos, validade, modo nutricionista) e revogação em `frontend/src/app/features/dieta/compartilhar/compartilhar.component.ts`
- [ ] T019 [P] [US5] Baixar CSV por período (`shared/download.ts`)

## Phase 8: User Story 6 - Assistente (P3)

- [ ] T020 [US6] Chat em `frontend/src/app/features/dieta/assistente/assistente.component.ts` reaproveitando `markdown-simples.ts` de Finanças; recarrega o dia quando o chat grava algo

## Phase 9: Polish

- [ ] T021 Responsivo em 360 px e tema escuro
- [ ] T022 [P] README (seção Dieta e "Estrutura do projeto"), `docs/dieta/PLANO.md` (etapa 8 concluída) e spec 005 (status)
- [ ] T023 `npx ng build --configuration production` e `npx ng test` em `frontend/`

## Dependencies & Execution Order

Setup → Foundational → US1 → US2 (MVP) → US3/US4 em paralelo → US5/US6 → Polish.
