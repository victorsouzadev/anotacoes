# Implementation Plan: Tela web da Dieta

**Branch**: sem branch própria | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/016-dieta-web/spec.md`

## Summary

Nova feature Angular `features/dieta` com rota `/dieta` e card no hub, consumindo só os endpoints existentes de `/api/dieta`. Dia, registro, progresso, perfil/plano, compartilhamento e assistente, sem backend novo.

## Technical Context

**Language/Version**: TypeScript 5.9, Angular 21

**Primary Dependencies**: Chart.js (já no projeto)

**Storage**: API existente (SQLite do hub)

**Testing**: Vitest para `dieta-calc.ts`; validação manual pelo quickstart

**Target Platform**: navegador, desktop e celular

**Project Type**: web app (frontend)

**Performance Goals**: dia carregado em menos de 1 s

**Constraints**: datas no fuso local; nenhum endpoint novo

**Scale/Scope**: 1 página com 5 abas, ~8 componentes

## Constitution Check

| Princípio | Situação |
|---|---|
| I. Um hub | ✅ Rota lazy + card no hub, mesmo login |
| II. Dados sagrados | ✅ Upsert LWW já validado no backend |
| III. Local-first | ✅ Offline continua no app; web é complemento (justificado em research) |
| IV. IA | ✅ Assistente usa a configuração do hub e exige confirmação |
| V. Lógica pura testada | ✅ `dieta-calc.ts` com testes |
| VI. Grafite | ✅ Tokens do tema; ícone em nanquim até haver cor de ferramenta |
| VII. pt-BR | ✅ |
| VIII. Simplicidade | ✅ Sem backend novo, sem IndexedDB |

Re-check pós-design: sem violações.

## Project Structure

### Documentation (this feature)

```text
specs/016-dieta-web/
├── spec.md, plan.md, research.md, quickstart.md, tasks.md
├── contracts/api-usada.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
frontend/src/app/
├── app.routes.ts                    # + rota dieta
├── shared/icon.ts                   # + ícone
├── features/hub/hub.page.ts         # + card
└── features/dieta/
    ├── dieta.page.ts                # abas
    ├── dieta.models.ts
    ├── dieta-api.service.ts
    ├── dieta-calc.ts (+ .spec.ts)
    ├── dia/ (dia.component.ts, adicionar-item.component.ts)
    ├── progresso/progresso.component.ts
    ├── perfil/perfil.component.ts
    ├── compartilhar/compartilhar.component.ts
    └── assistente/assistente.component.ts
```

**Structure Decision**: feature nova no frontend, padrão das demais (`features/<ferramenta>`).

## Complexity Tracking

Sem violações.
