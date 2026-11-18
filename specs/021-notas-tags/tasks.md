# Tasks: Tags nas notas

**Input**: `/specs/021-notas-tags/`

## Phase 2: Foundational

- [ ] T001 `Tags` em `Note` (`backend/Notas.Api/Data/AppDbContext.cs`) + migração `NotesTags`
- [ ] T002 DTOs e upsert (normaliza, valida, ausente mantém) em `backend/Notas.Api/Dtos/Dtos.cs` e `Endpoints/NotesEndpoints.cs`
- [ ] T003 [P] Testes em `backend/Notas.Api.Tests/NotesTagsTests.cs`
- [ ] T004 `tags` em `NoteRecord`, `api-client.ts`, `sync.service.ts` (push/pull) e `notes-repo.service.ts` (`setTags`)
- [ ] T005 [P] `normalizarTags` e `filtrarNotas({ pasta, busca, tags })` em `frontend/src/app/features/notes/notes-filter.ts` com testes

## Phase 3: User Story 1 - Marcar (P1) 🎯 MVP

- [ ] T006 [US1] Componente de chips com sugestão `frontend/src/app/shared/tag-input.component.ts`
- [ ] T007 [US1] Usar no cabeçalho do editor (`features/editor/editor.page.ts`) e no card da lista (`features/notes/notes-list.page.ts`)

## Phase 4: User Story 2 - Filtrar (P1)

- [ ] T008 [US2] Seção "Tags" com contagem na barra lateral e filtro E em `notes-list.page.ts`, usando `filtrarNotas`
- [ ] T009 [US2] Busca considerando tags (em `filtrarNotas`)

## Phase 5: User Story 3 - Renomear/remover em massa (P3)

- [ ] T010 [US3] Menu da tag com Renomear e Remover de todas (marca cada nota `dirty`)

## Phase 6: Polish

- [ ] T011 [P] README (Organização, Roadmap) e spec 002
- [ ] T012 `dotnet test` e `npx ng test`/`ng build`
