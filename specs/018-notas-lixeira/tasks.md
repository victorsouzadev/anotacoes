# Tasks: Lixeira de notas

**Input**: `/specs/018-notas-lixeira/`

**Tests**: incluídos (contrato de API muda → teste de integração, Princípio V).

## Phase 2: Foundational

- [ ] T001 Adicionar `TrashedAt` (`DateTime?`) a `Note` em `backend/Notas.Api/Data/AppDbContext.cs` e gerar migração `NotesTrashedAt` em `backend/Notas.Api/Data/Migrations/`
- [ ] T002 Adicionar `TrashedAt` a `NoteUpsertRequest` e ao DTO de resposta em `backend/Notas.Api/Dtos/Dtos.cs`; copiar no `Upsert` de `backend/Notas.Api/Endpoints/NotesEndpoints.cs`
- [ ] T003 [P] Testes de integração em `backend/Notas.Api.Tests/NotesLixeiraTests.cs`: upsert com e sem `trashedAt`, GET devolve o campo, LWW mantém o mais novo
- [ ] T004 Adicionar `trashedAt` a `NoteRecord` em `frontend/src/app/data/models.ts`, ao `upsertNote`/DTOs em `frontend/src/app/core/api-client.ts` e ao `push`/`pull` em `frontend/src/app/data/sync.service.ts`

**Checkpoint**: campo trafega nos dois sentidos.

## Phase 3: User Story 1 - Excluir sem perder (P1) 🎯 MVP

- [ ] T005 [US1] `NotesRepoService.trashNote(id)` (marca `trashedAt`, `updatedAt`, `dirty`, mantém páginas) e `listNotes` filtrando `trashedAt` em `frontend/src/app/data/notes-repo.service.ts`
- [ ] T006 [US1] Trocar o excluir da lista por `trashNote` com aviso "Desfazer" em `frontend/src/app/features/notes/notes-list.page.ts`
- [ ] T007 [US1] Busca e contagem por pasta ignorando notas na lixeira

## Phase 4: User Story 2 - Restaurar e excluir para sempre (P1)

- [ ] T008 [US2] `listTrash()`, `restoreNote(id)` (volta à pasta se existir, senão `null`) e `deleteForever(id)` (usa o `deleteNote` atual) em `notes-repo.service.ts`
- [ ] T009 [US2] Entrada "Lixeira" na barra de pastas e visão com data, dias restantes, Restaurar, Excluir para sempre (com confirmação) e Esvaziar em `notes-list.page.ts`
- [ ] T010 [US2] Editor: se a nota aberta passar a ter `trashedAt` após sincronizar, voltar para a lista em `frontend/src/app/features/editor/editor.page.ts`

## Phase 5: User Story 3 - Limpeza automática (P2)

- [ ] T011 [US3] `NotesLixeiraWorker` (`BackgroundService`, ao subir e a cada 24 h) em `backend/Notas.Api/Services/Notas/NotesLixeiraWorker.cs`, registrado em `backend/Notas.Api/NotasApp.cs`
- [ ] T012 [P] [US3] Teste da limpeza (31 dias vira tombstone, 29 não) em `NotesLixeiraTests.cs`

## Phase 6: Polish

- [ ] T013 [P] README: seção Organização e remover o item do Roadmap; spec 002 (lixeira)
- [ ] T014 `dotnet test` (também com `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`) e `npx ng test`/`ng build`
