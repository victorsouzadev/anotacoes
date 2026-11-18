# Research: Recorrência de tarefas na web

## Onde gerar a próxima ocorrência

- **Decision**: no `TasksStoreService` da web, ao concluir (ou pular) — espelhando `TaskRepository.setCompleted`/`skipCurrentOccurrence` do Android.
- **Rationale**: o Android já gera localmente e sincroniza a tarefa nova. Se o servidor também gerasse ao receber `isCompleted=true`, cada conclusão feita no Android viraria duas ocorrências.
- **Alternatives considered**: gerar no `TasksEndpoints` (rejeitado: duplicação com o Android e mudança de contrato); marcar a origem da conclusão (rejeitado: complexidade sem ganho).

## Cálculo da data

- **Decision**: função pura `nextOccurrence(rule, from: Date): Date` em `features/tasks/models/task.model.ts`, ao lado de `decodeRecurrence`, com a mesma semântica do Kotlin: `DAILY:n` soma n dias; `WEEKLY` avança dia a dia a partir de amanhã até um dia da lista; `MONTHLY` soma 1 mês.
- **Rationale**: Princípio V (lógica pura testada). `LocalDateTime.plusMonths(1)` em Java ajusta 31/01 para 28 ou 29/02; o `Date#setMonth` do JS iria para março, então a função limita ao último dia do mês.
- **Alternatives considered**: biblioteca de datas (rejeitado: dependência nova para três regras).

## Desfazer em massa

- **Decision**: o "Desfazer" da conclusão em massa reverte só o estado das tarefas originais (como hoje); as ocorrências geradas ficam.
- **Rationale**: mesmo comportamento do Android ao desmarcar; evita apagar algo que já pode ter sincronizado.
