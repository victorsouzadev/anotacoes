# Implementation Plan: Tela web do Treino

**Branch**: sem branch própria | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

## Summary

Feature `features/treino` somente leitura, com card no hub, lendo atividades e plano da API existente e calculando totais no cliente.

## Technical Context

**Language/Version**: TypeScript 5.9, Angular 21

**Primary Dependencies**: Chart.js (existente)

**Storage**: API existente

**Testing**: Vitest para `treino-calc.ts`

**Target Platform**: navegador

**Project Type**: web app (frontend)

**Performance Goals**: < 1 s com 1 ano de dados

**Constraints**: somente leitura

**Scale/Scope**: 1 página, 1 serviço, 1 módulo de cálculo

## Constitution Check

I ✅ rota + card · II ✅ só leitura · III ✅ app segue offline-first · IV N/A · V ✅ cálculo testado · VI ✅ Grafite · VII ✅ · VIII ✅ sem endpoint novo. Re-check pós-design: sem violações.

## Project Structure

```text
specs/017-treino-web/  spec.md plan.md research.md quickstart.md tasks.md checklists/
frontend/src/app/features/treino/
├── treino.page.ts
├── treino-api.service.ts
├── treino.models.ts
└── treino-calc.ts (+ .spec.ts)
```

**Structure Decision**: feature nova no frontend.

## Complexity Tracking

Sem violações.
