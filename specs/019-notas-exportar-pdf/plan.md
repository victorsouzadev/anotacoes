# Implementation Plan: Exportar nota em PDF

**Branch**: sem branch própria | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

## Summary

Reaproveitar o `Renderer` (mesma rota do PNG) para cada página e o gerador `buildPdf` (movido para `shared/pdf.ts`) para montar o PDF no navegador.

## Technical Context

**Language/Version**: TypeScript 5.9, Angular 21

**Primary Dependencies**: nenhuma nova

**Storage**: N/A

**Testing**: Vitest para o cálculo de encaixe/orientação (`fitToPage`) e para o PDF ter N páginas

**Target Platform**: navegador

**Project Type**: web app (frontend)

**Performance Goals**: 10 páginas em < 10 s

**Constraints**: sem backend

**Scale/Scope**: 1 módulo, 1 diálogo

## Constitution Check

I ✅ · II ✅ só leitura · III ✅ funciona offline · IV N/A · V ✅ `fitToPage` puro e testado · VI ✅ · VII ✅ · VIII ✅ reaproveita `buildPdf`. Re-check: sem violações.

## Project Structure

```text
frontend/src/app/
├── shared/pdf.ts                         # buildPdf/PdfPage/jpegToPdf (movidos)
├── features/imagem/sheet.ts              # reexporta de shared/pdf.ts
└── features/editor/
    ├── engine/export.ts                  # + exportNoteToPdf(pages, opções)
    ├── engine/export-pdf-layout.ts (+ .spec.ts)  # fitToPage, orientação
    ├── more-actions-menu.ts              # + "Exportar PDF"
    └── editor.page.ts                    # diálogo de opções
```

## Complexity Tracking

Sem violações.
