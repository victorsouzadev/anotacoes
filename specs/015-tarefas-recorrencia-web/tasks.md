# Tasks: Recorrência de tarefas na web

**Input**: Design documents from `/specs/015-tarefas-recorrencia-web/`

**Prerequisites**: plan.md, spec.md, research.md

**Tests**: incluídos (Princípio V da constituição: lógica pura com teste).

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

Nada a configurar.

## Phase 2: Foundational

- [x] T001 Implementar `nextOccurrence(rule: DecodedRecurrence, from: Date): Date` em `frontend/src/app/features/tasks/models/task.model.ts` (DAILY soma n dias; WEEKLY avança a partir de amanhã até um dia listado; MONTHLY soma 1 mês limitando ao último dia)
- [x] T002 [P] Testes de `nextOccurrence` em `frontend/src/app/features/tasks/models/task.model.spec.ts`: DAILY:1, DAILY:3, WEEKLY seg/qui a partir de segunda e de sexta, MONTHLY 15/03, 31/01 → 28/02, 31/01/2028 → 29/02, regra inválida → null

**Checkpoint**: cálculo de datas igual ao `RecurrenceRule.kt`.

## Phase 3: User Story 1 - Concluir gera a próxima (Priority: P1) 🎯 MVP

**Goal**: concluir recorrente na web cria a próxima ocorrência.

**Independent Test**: quickstart passos 3 e 4.

- [x] T003 [US1] Criar método privado `createNextOccurrence(task)` em `frontend/src/app/features/tasks/services/tasks-store.service.ts` que copia título, descrição, prioridade, categorias, notas, regra e subtarefas (desmarcadas), com `dueDate` de `nextOccurrence` e `position` no fim, via `createTask`
- [x] T004 [US1] Chamar `createNextOccurrence` em `setCompleted` quando `isCompleted` passa a true e a regra decodifica, em `frontend/src/app/features/tasks/services/tasks-store.service.ts`
- [x] T005 [US1] Garantir que a conclusão em massa (linha ~170 de `tasks-store.service.ts`) passa por `setCompleted` ou chama `createNextOccurrence` para cada tarefa, sem gerar de novo no "Desfazer"

**Checkpoint**: US1 funcional.

## Phase 4: User Story 2 - Pular esta vez (Priority: P2)

- [x] T006 [US2] Adicionar `skipOccurrence(task)` em `tasks-store.service.ts`: gera a próxima e move a atual para a lixeira (`deletedAt`) sem `isCompleted`
- [x] T007 [US2] Botão "Pular esta vez", só para recorrentes, em `frontend/src/app/features/tasks/components/task-detail.component.html` e `.ts`

## Phase 5: Polish

- [x] T008 [P] Atualizar o guia em `frontend/src/app/features/tasks/help/tasks-help.page.html` (seção "Dentro de uma tarefa") e a spec 004 (remover a divergência dos Edge Cases)
- [x] T009 Rodar `npx ng build --configuration production` e `npx ng test` em `frontend/`

## Dependencies & Execution Order

T001 → T002 (paralelo ao T003 após T001) → T003 → T004 → T005; T006 depende de T003; T007 depende de T006; T008–T009 no fim.
