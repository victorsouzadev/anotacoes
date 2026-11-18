# Implementation Plan: Tags nas notas

**Branch**: sem branch própria | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

## Summary

Campo `Tags` (JSON) aditivo no servidor, `tags` no `NoteRecord`, editor de tags no editor e no card, filtro e contagens na barra lateral, com filtro puro testado.

## Technical Context

**Language/Version**: C# .NET 9 + TypeScript 5.9/Angular 21 · **Primary Dependencies**: EF Core 9 · **Storage**: SQLite + IndexedDB · **Testing**: xUnit (upsert/validação) e Vitest (`notes-filter.spec.ts`, `normalizarTags`) · **Project Type**: web app · **Constraints**: migração aditiva; compatível com cliente antigo · **Scale/Scope**: 1 coluna, 1 componente de chips, filtro

## Constitution Check

I ✅ · II ✅ aditivo · III ✅ funciona offline · IV N/A · V ✅ filtro e normalização testados · VI ✅ chips em `nanquim-tinta` · VII ✅ · VIII ✅ sem tabela N:N. Re-check: sem violações.

## Project Structure

```text
backend/Notas.Api/Data/AppDbContext.cs, Data/Migrations/<data>_NotesTags.cs, Dtos/Dtos.cs, Endpoints/NotesEndpoints.cs
backend/Notas.Api.Tests/NotesTagsTests.cs
frontend/src/app/data/models.ts, sync.service.ts, notes-repo.service.ts, core/api-client.ts
frontend/src/app/features/notes/notes-filter.ts (+ .spec.ts), notes-list.page.ts
frontend/src/app/shared/tag-input.component.ts
frontend/src/app/features/editor/editor.page.ts
```

## Complexity Tracking

Sem violações.
