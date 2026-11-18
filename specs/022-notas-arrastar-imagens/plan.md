# Implementation Plan: Arrastar imagens para o canvas

**Branch**: sem branch própria | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

## Summary

Eventos de drag-and-drop no `canvas-host.ts` e botão "Inserir imagem" na barra, todos passando por um `insertImage(blob, ponto?)` comum com o caminho da colagem.

## Technical Context

TypeScript 5.9/Angular 21 · dependências existentes (`heic-to`) · sem backend · Testing: Vitest para `cascata(ponto, i)` e `cabeNoLimite(pages, novaImagem)` · frontend.

## Constitution Check

I ✅ · II ✅ respeita limite · III ✅ offline · IV N/A · V ✅ funções puras testadas · VI ✅ destaque do drop em `nanquim` · VII ✅ · VIII ✅. Re-check: sem violações.

## Project Structure

```text
frontend/src/app/features/editor/
├── canvas-host.ts                 # drop + insertImage(blob, ponto?)
├── toolbar.ts                     # botão Inserir imagem
└── engine/image-utils.ts (+ .spec.ts)  # cascata, cabeNoLimite
frontend/src/app/shared/heic.ts    # movido de features/imagem/heic.ts (reexportado lá)
```

## Complexity Tracking

Sem violações.
