# Implementation Plan: Duplicar e navegar entre páginas

**Branch**: sem branch própria | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

## Summary

Atalhos de página no `onKeydown` do editor, menu de contexto nas abas (renomear, duplicar, mover, excluir), arrastar para reordenar e desfazer exclusão. Lógica de duplicação pura em `page-ops.ts`.

## Technical Context

**Language/Version**: TypeScript 5.9, Angular 21 · **Primary Dependencies**: nenhuma nova · **Storage**: o mesmo `pages` da nota · **Testing**: Vitest (`page-ops.spec.ts`) · **Target Platform**: navegador · **Project Type**: frontend · **Constraints**: sem mudança de formato salvo · **Scale/Scope**: 1 módulo puro + editor.page

## Constitution Check

I ✅ · II ✅ formato salvo igual; exclusão com desfazer · III ✅ · IV N/A · V ✅ `page-ops` testado · VI ✅ · VII ✅ · VIII ✅. Re-check: sem violações.

## Project Structure

```text
frontend/src/app/features/editor/
├── engine/page-ops.ts (+ .spec.ts)   # duplicatePage, movePage
└── editor.page.ts                    # atalhos, menu da aba, drag, desfazer
```

## Complexity Tracking

Sem violações.
