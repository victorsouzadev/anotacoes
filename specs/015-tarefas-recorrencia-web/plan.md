# Implementation Plan: Recorrência de tarefas na web

**Branch**: sem branch própria | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/015-tarefas-recorrencia-web/spec.md`

## Summary

Ao concluir ou pular uma tarefa recorrente, a web cria a próxima ocorrência no cliente, com a mesma regra de datas do Android, usando o `upsertTask` que já existe. Sem mudança de backend nem de contrato.

## Technical Context

**Language/Version**: TypeScript 5.9, Angular 21 (standalone, signals)

**Primary Dependencies**: nenhuma nova

**Storage**: API existente `/api/tasks/items` (SQLite no backend)

**Testing**: Vitest (`npx ng test`), arquivo `task.model.spec.ts`

**Target Platform**: navegador (hub web)

**Project Type**: web app (frontend apenas)

**Performance Goals**: N/A

**Constraints**: paridade exata de datas com `RecurrenceRule.kt`

**Scale/Scope**: 1 função pura, 2 métodos do store, 1 botão no painel da tarefa

## Constitution Check

| Princípio | Situação |
|---|---|
| I. Um hub | ✅ Sem serviço novo |
| II. Dados sagrados | ✅ Nada é apagado; só cria tarefa nova |
| III. Local-first | ✅ Android segue igual; web já é online |
| IV. IA | N/A |
| V. Lógica pura testada | ✅ `nextOccurrence` com testes, incluindo 31/01 → fev |
| VI. Grafite | ✅ Botão usa os estilos existentes do painel |
| VII. pt-BR | ✅ "Pular esta vez" |
| VIII. Simplicidade | ✅ Sem dependência nova |

Re-check pós-design: sem violações.

## Project Structure

### Documentation (this feature)

```text
specs/015-tarefas-recorrencia-web/
├── spec.md
├── plan.md
├── research.md
├── quickstart.md
├── tasks.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
frontend/src/app/features/tasks/
├── models/task.model.ts            # + nextOccurrence()
├── models/task.model.spec.ts       # + testes de paridade com o Android
├── services/tasks-store.service.ts # setCompleted gera; + skipOccurrence()
└── components/task-detail.component.{ts,html}  # botão "Pular esta vez"
```

**Structure Decision**: só frontend, dentro da feature `tasks`.

## Complexity Tracking

Sem violações.
