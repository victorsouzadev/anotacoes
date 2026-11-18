# Tasks: Tela web do Treino

**Input**: `/specs/017-treino-web/`

**Tests**: unitários para `treino-calc.ts`.

## Phase 1: Setup

- [x] T001 Rota lazy `treino` em `frontend/src/app/app.routes.ts`
- [x] T002 [P] Ícone em `frontend/src/app/shared/icon.ts` e card "Treino" em `frontend/src/app/features/hub/hub.page.ts`

## Phase 2: Foundational

- [x] T003 Modelos (`TreinoAtividadeDto`, `TreinoPlanoDto`) em `frontend/src/app/features/treino/treino.models.ts`
- [x] T004 `TreinoApiService` (GET atividades e plano) em `frontend/src/app/features/treino/treino-api.service.ts`
- [x] T005 [P] `treino-calc.ts`: ritmo (min/km), totais por janela, km por semana; testes em `treino-calc.spec.ts` com os mesmos casos do `Mcp/TreinoMcpTools.cs`

## Phase 3: User Story 1 - Andamento e recentes (P1) 🎯 MVP

- [x] T006 [US1] `frontend/src/app/features/treino/treino.page.ts`: card do plano, último treino, lista dos recentes, estado vazio explicando o app Treino Corrida

## Phase 4: User Story 2 - Totais e evolução (P2)

- [x] T007 [US2] Totais 7/30/90 dias na página
- [x] T008 [P] [US2] Gráficos de km por semana e ritmo médio (Chart.js)

## Phase 5: Polish

- [x] T009 [P] README (seção Treino) e spec 006
- [x] T010 `npx ng build --configuration production` e `npx ng test`
