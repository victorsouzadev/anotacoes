# Tasks: Duplicar e navegar entre páginas

**Input**: `/specs/020-notas-paginas/`

## Phase 2: Foundational

- [ ] T001 `duplicatePage(page)` e `movePage(pages, de, para)` em `frontend/src/app/features/editor/engine/page-ops.ts`
- [ ] T002 [P] Testes em `frontend/src/app/features/editor/engine/page-ops.spec.ts` (ids novos, `fromId`/`toId` remapeados, seta ligada a elemento de fora fica solta, ordem)

## Phase 3: User Story 1 - Atalhos (P1) 🎯 MVP

- [ ] T003 [US1] Ctrl+PageUp/PageDown, Alt+←/→ e Ctrl+Shift+N em `onKeydown` de `frontend/src/app/features/editor/editor.page.ts`, confirmando texto/checklist em edição antes de trocar

## Phase 4: User Story 2 - Duplicar (P1)

- [ ] T004 [US2] Menu de contexto da aba (botão direito / toque longo) com Renomear, Duplicar, Mover ←/→ e Excluir em `editor.page.ts`
- [ ] T005 [US2] Ação Duplicar usando `duplicatePage`, inserindo após a atual e salvando (`flushSave`)

## Phase 5: User Story 3 - Reordenar e desfazer (P2)

- [ ] T006 [US3] Drag-and-drop das abas com `movePage`
- [ ] T007 [US3] Trocar o `confirm()` de `removePage` por aviso com Desfazer (6 s)

## Phase 6: Polish

- [ ] T008 [P] README (Editor) e Roadmap; spec 002
- [ ] T009 `npx ng test` e `npx ng build --configuration production`
