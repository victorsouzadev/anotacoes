# Implementation Plan: Lixeira de notas

**Branch**: sem branch própria | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

## Summary

Campo `TrashedAt` aditivo no servidor e no cliente, sincronizado pelo upsert existente; tela de Lixeira na lista de notas; limpeza de 30 dias por um worker no `Notas.Api`.

## Technical Context

**Language/Version**: C# / .NET 9 (backend), TypeScript 5.9 / Angular 21 (frontend)

**Primary Dependencies**: EF Core 9 (migrações), idb

**Storage**: SQLite (coluna nova), IndexedDB (campo novo)

**Testing**: xUnit em `Notas.Api.Tests` (upsert com `trashedAt`, limpeza); Vitest para filtros da lista

**Target Platform**: VPS (Docker) + navegador

**Project Type**: web app (backend + frontend)

**Performance Goals**: N/A

**Constraints**: migração só aditiva; compatível com cliente sem o campo

**Scale/Scope**: 1 coluna, 1 worker, 1 tela

## Constitution Check

| Princípio | Situação |
|---|---|
| I | ✅ Dentro de Notas |
| II | ✅ Resolve perda por exclusão; migração aditiva |
| III | ✅ Funciona offline (campo local + outbox) |
| IV | N/A |
| V | ✅ Testes de upsert e limpeza; filtro puro testado |
| VI | ✅ |
| VII | ✅ "Lixeira", "Restaurar", "Excluir para sempre" |
| VIII | ✅ Um campo, um worker |

Re-check pós-design: sem violações.

## Project Structure

```text
specs/018-notas-lixeira/ spec.md plan.md research.md data-model.md contracts/notes-api.md quickstart.md tasks.md
backend/Notas.Api/
├── Data/AppDbContext.cs                 # Note.TrashedAt
├── Data/Migrations/<data>_NotesTrashedAt.cs
├── Dtos/Dtos.cs                         # NoteUpsertRequest / NoteDto + TrashedAt
├── Endpoints/NotesEndpoints.cs          # copia TrashedAt no upsert
├── Services/Notas/NotesLixeiraWorker.cs # limpeza 30 dias
└── NotasApp.cs                          # registra o worker
backend/Notas.Api.Tests/NotesLixeiraTests.cs
frontend/src/app/
├── data/models.ts, notes-repo.service.ts, sync.service.ts, core/api-client.ts
└── features/notes/notes-list.page.ts    # filtro, Lixeira, desfazer
```

**Structure Decision**: segue a estrutura existente de Notas.

## Complexity Tracking

Sem violações.
