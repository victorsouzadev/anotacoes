# Tasks: Exportar nota em PDF

**Input**: `/specs/019-notas-exportar-pdf/`

## Phase 2: Foundational

- [x] T001 Mover `PdfPage`, `buildPdf`, `jpegToPdf` e `MM_TO_PT` para `frontend/src/app/shared/pdf.ts` e reexportar em `frontend/src/app/features/imagem/sheet.ts`
- [x] T002 [P] `fitToPage(bbox, page: 'a4' | 'conteudo')` → `{ wMm, hMm, escala, offset, paisagem }` em `frontend/src/app/features/editor/engine/export-pdf-layout.ts`, com testes em `export-pdf-layout.spec.ts`

## Phase 3: User Story 1 - Nota inteira em A4 (P1) 🎯 MVP

- [x] T003 [US1] `exportNoteToPdf(pages, paperStyle, filename, opcoes)` em `frontend/src/app/features/editor/engine/export.ts`: para cada página, canvas offscreen + `Renderer`, fundo branco, `toBlob('image/jpeg', 0.9)`, `buildPdf`
- [x] T004 [US1] Item "Exportar PDF" em `frontend/src/app/features/editor/more-actions-menu.ts` e handler em `frontend/src/app/features/editor/editor.page.ts` (captura a página atual antes, como no PNG)
- [x] T005 [US1] Processar páginas uma a uma com `await` entre elas e indicador "Gerando PDF…"

## Phase 4: User Story 2 - Opções (P2)

- [x] T006 [US2] Diálogo com "Nota inteira / Página atual" e "A4 / Tamanho do conteúdo" e "Incluir estilo de papel" em `editor.page.ts`

## Phase 5: Polish

- [x] T007 [P] README (Editor de Notas) e remover o item do Roadmap; spec 002
- [x] T008 `npx ng test` e `npx ng build --configuration production`
