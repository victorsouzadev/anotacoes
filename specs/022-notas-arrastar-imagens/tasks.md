# Tasks: Arrastar imagens para o canvas

## Phase 2: Foundational

- [x] T001 Refatorar `insertPastedImage` para `insertImage(blob, pontoMundo?)` em `frontend/src/app/features/editor/canvas-host.ts`
- [x] T002 [P] `cascata` e `cabeNoLimite` em `frontend/src/app/features/editor/engine/image-utils.ts` com testes em `image-utils.spec.ts`
- [x] T003 [P] Mover `frontend/src/app/features/imagem/heic.ts` para `frontend/src/app/shared/heic.ts` e reexportar no lugar antigo

## Phase 3: User Story 1 - Soltar (P1) 🎯 MVP

- [x] T004 [US1] `dragover`/`dragleave`/`drop` com destaque visual e conversão de ponto em `canvas-host.ts`
- [x] T005 [US1] Recusa de não-imagens e de excesso de tamanho com aviso

## Phase 4: User Story 2 - Botão (P2)

- [x] T006 [US2] Botão "Inserir imagem" (`<input type=file accept="image/*">`) em `frontend/src/app/features/editor/toolbar.ts`

## Phase 5: Polish

- [x] T007 [P] README (Editor) e Roadmap; spec 002
- [x] T008 `npx ng test` e `ng build`
