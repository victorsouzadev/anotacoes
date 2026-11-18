# Feature Specification: Recorrência de tarefas na web

**Feature Branch**: `015-tarefas-recorrencia-web` (sem branch própria)

**Created**: 2026-11-18

**Status**: Draft

**Input**: Lacuna da spec 004: concluir uma tarefa recorrente na web não gera a próxima ocorrência, como o app Android faz.

## Clarifications

### Session 2026-11-18

- Q: A próxima ocorrência é gerada no servidor ou no cliente? → A: No cliente web, como no Android. Gerar no servidor duplicaria as ocorrências criadas pelo Android.
- Q: Desmarcar a conclusão apaga a ocorrência gerada? → A: Não. Igual ao Android: a nova tarefa fica e pode ser excluída à mão.
- Q: Haverá "pular esta ocorrência" na web? → A: Sim, como no Android: gera a próxima e manda a atual para a lixeira sem contar como concluída.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Concluir uma tarefa recorrente na web (Priority: P1)

A pessoa conclui na web uma tarefa diária, semanal ou mensal e a próxima ocorrência aparece com o prazo seguinte, as mesmas categorias e as subtarefas desmarcadas.

**Why this priority**: Sem isso, quem usa a web perde as tarefas recorrentes: a regra existe, mas não faz nada.

**Independent Test**: Criar "Regar plantas" semanal (seg/qui) com prazo numa segunda, concluir na web e ver a nova tarefa com prazo na quinta.

**Acceptance Scenarios**:

1. **Given** uma tarefa `DAILY:2` com prazo em 10/11, **When** é concluída, **Then** surge uma tarefa igual, não concluída, com prazo em 12/11.
2. **Given** uma tarefa `WEEKLY:MONDAY,THURSDAY` com prazo numa segunda, **When** é concluída, **Then** a nova tem prazo na quinta seguinte, no mesmo horário.
3. **Given** uma tarefa `MONTHLY` com prazo em 31/01, **When** é concluída, **Then** a nova tem prazo no último dia de fevereiro.
4. **Given** uma tarefa recorrente sem prazo, **When** é concluída, **Then** a próxima é calculada a partir de agora.
5. **Given** a tarefa nova, **When** o Android sincroniza, **Then** ela aparece lá uma vez só.
6. **Given** uma tarefa recorrente concluída em massa (seleção múltipla), **Then** cada uma gera a sua próxima ocorrência.

---

### User Story 2 - Pular uma ocorrência (Priority: P2)

No painel da tarefa recorrente, "Pular esta vez" gera a próxima ocorrência e manda a atual para a lixeira sem contar como concluída.

**Independent Test**: Pular uma tarefa diária e conferir que a estatística de concluídas não mudou.

**Acceptance Scenarios**:

1. **Given** uma tarefa não recorrente, **Then** a opção "Pular esta vez" não aparece.

### Edge Cases

- Regra inválida ou vazia (`WEEKLY:` sem dias): conclui sem gerar e sem erro.
- Desfazer a conclusão em massa não apaga as ocorrências já geradas.
- A tarefa nova não herda projetos (raias), comentários, anexos nem pomodoros; herda categorias, prioridade, descrição, notas, subtarefas (desmarcadas) e regra.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Concluir uma tarefa com `isRecurring` e regra válida na web MUST criar a próxima ocorrência.
- **FR-002**: O cálculo da data MUST dar o mesmo resultado que `RecurrenceRule.nextOccurrence` do Android para o mesmo prazo.
- **FR-003**: A nova tarefa MUST ter id novo, `isCompleted=false`, subtarefas desmarcadas, mesmas categorias e regra.
- **FR-004**: A web MUST oferecer "Pular esta vez" para tarefas recorrentes.
- **FR-005**: A geração MUST acontecer só no cliente que concluiu; o servidor não gera ocorrências.

### Key Entities

- **Tarefa** (existente): `isRecurring`, `recurrenceRule` (`DAILY:n`, `WEEKLY:DIA,...`, `MONTHLY`), `dueDate`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das tarefas recorrentes concluídas na web geram a próxima ocorrência.
- **SC-002**: Nenhuma ocorrência duplicada depois de sincronizar web e Android.

## Assumptions

- O web de Tarefas grava direto na API (não é offline); a ocorrência nova é criada com o mesmo `upsertTask` usado hoje.
- Fuso: o cálculo usa o horário local do navegador, como o Android usa o do aparelho.
