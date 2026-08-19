import type { TaskCategory, TaskItem } from './tasksApi.js';

export interface TaskMatchResult {
  task: TaskItem | null;
  error?: string;
  candidates?: { id: string; title: string }[];
}

/** Resolve `idOrTitle` pro id exato, ou por trecho do título (case-insensitive) entre as
 * tarefas que passam em `predicate`. Ambíguo (mais de um match por título) é erro, não
 * escolha arbitrária — evita o LLM completar/apagar a tarefa errada. */
export function findTaskMatch(
  tasks: TaskItem[],
  idOrTitle: string,
  predicate: (task: TaskItem) => boolean,
): TaskMatchResult {
  const byId = tasks.find((t) => t.id === idOrTitle);
  if (byId) return { task: byId };

  const pool = tasks.filter(predicate);
  const needle = idOrTitle.trim().toLowerCase();
  const matches = pool.filter((t) => t.title.toLowerCase().includes(needle));

  if (matches.length === 0) {
    return { task: null, error: `Nenhuma tarefa encontrada para "${idOrTitle}".` };
  }
  if (matches.length > 1) {
    return {
      task: null,
      error: `Mais de uma tarefa corresponde a "${idOrTitle}". Seja mais específico ou use o id.`,
      candidates: matches.map((t) => ({ id: t.id, title: t.title })),
    };
  }
  return { task: matches[0] };
}

export function findCategoryByName(categories: TaskCategory[], name: string): TaskCategory | undefined {
  const trimmed = name.trim().toLowerCase();
  return categories.find((c) => c.name.trim().toLowerCase() === trimmed);
}
