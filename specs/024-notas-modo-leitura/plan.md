# Implementation Plan: Modo leitura / apresentação

**Branch**: sem branch própria | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

## Summary

Componente de leitura independente (`note-reader.ts`) com Renderer/Viewport, navegação por página, gestos e tela cheia; o editor o abre pelo botão "Ler".

## Technical Context

TypeScript 5.9/Angular 21 · sem dependência nova · sem backend · Testing: Vitest para `navegacao(pagina, total, acao)` e enquadramento · frontend.

## Constitution Check

I ✅ · II ✅ leitura não grava nada · III ✅ · IV N/A · V ✅ navegação pura testada · VI ✅ · VII ✅ · VIII ✅ reaproveita Renderer. Re-check: sem violações.

## Project Structure

```text
frontend/src/app/features/editor/
├── note-reader.ts (+ note-reader-nav.ts, .spec.ts)
└── editor.page.ts                    # botão "Ler"
```

## Complexity Tracking

Sem violações.
