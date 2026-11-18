# Tasks: Link somente leitura de nota

**Prerequisites**: spec 024 (leitor) e spec 018 (campo `TrashedAt`) implementadas.

## Phase 2: Foundational

- [x] T001 Entidade `NoteShare` + índice único em `TokenHash` em `backend/Notas.Api/Data/AppDbContext.cs` e migração `NoteShares`
- [x] T002 Política de taxa `publico` (60/min por IP) em `backend/Notas.Api/NotasApp.cs`

## Phase 3: User Story 1 - Criar e abrir (P1) 🎯 MVP

- [x] T003 [US1] `POST /api/notes/{id}/links` e `GET /api/notes/publico/{token}` em `backend/Notas.Api/Endpoints/NotesShareEndpoints.cs`
- [x] T004 [P] [US1] Testes em `backend/Notas.Api.Tests/NoteShareTests.cs` (cria, abre sem login, resposta mínima, outra conta não cria link para nota alheia)
- [x] T005 [US1] Rota `/p/nota/:token` sem guard em `frontend/src/app/app.routes.ts` e `frontend/src/app/features/notes/public-note.page.ts` com `NoteReaderComponent`
- [x] T006 [US1] Diálogo Compartilhar (nome, validade, copiar link) em `frontend/src/app/features/editor/share-dialog.ts`, aberto do `editor.page.ts`

## Phase 4: User Story 2 - Listar e revogar (P1)

- [x] T007 [US2] `GET /api/notes/{id}/links` e `DELETE /api/notes/{id}/links/{linkId}`; validade e lixeira/exclusão invalidam
- [x] T008 [P] [US2] Testes de revogação, vencimento e nota na lixeira
- [x] T009 [US2] Lista e Revogar no diálogo; página pública com mensagem de indisponível

## Phase 5: Polish

- [x] T010 [P] README (Notas, API resumo, Roadmap) e spec 002
- [x] T011 `dotnet test` (também invariant) e `npx ng test`/`ng build`
