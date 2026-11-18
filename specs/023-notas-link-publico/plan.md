# Implementation Plan: Link somente leitura de nota

**Branch**: sem branch própria | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

## Summary

Tabela `NoteShare` com hash do token, endpoints autenticados para criar/listar/revogar, endpoint público com limite de taxa, e rota Angular sem login usando o leitor da spec 024.

## Technical Context

C# .NET 9 + EF Core 9; TypeScript/Angular 21 · Storage: SQLite (tabela nova) · Testing: xUnit (`NoteShareTests`: criar, abrir, revogar, vencer, nota na lixeira, resposta sem campos privados) · Project Type: web app · Constraints: depende de 024; token só em hash · Scale: 1 tabela, 4 endpoints, 1 rota.

## Constitution Check

| Princípio | Situação |
|---|---|
| I | ✅ Dentro do `Notas.Api` |
| II | ✅ Token em hash, resposta mínima, revogação; migração aditiva |
| III | ✅ Criar link exige rede (avisado) |
| IV | N/A |
| V | ✅ Testes de integração do contrato |
| VI | ✅ |
| VII | ✅ |
| VIII | ✅ Mesmo desenho da Dieta |

Re-check pós-design: sem violações.

## Project Structure

```text
backend/Notas.Api/Data/AppDbContext.cs (+ NoteShare), Data/Migrations/<data>_NoteShares.cs
backend/Notas.Api/Endpoints/NotesShareEndpoints.cs (mapeado em NotasApp.cs)
backend/Notas.Api.Tests/NoteShareTests.cs
frontend/src/app/app.routes.ts                     # /p/nota/:token sem guard
frontend/src/app/features/notes/public-note.page.ts # usa NoteReaderComponent
frontend/src/app/features/editor/share-dialog.ts
```

## Complexity Tracking

Sem violações.
