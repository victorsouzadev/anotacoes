import { TaskCategory, TaskItem } from '../models/task.model';
import { csvEscape, toCsv } from '../../../shared/csv';

// Reexportado porque a montagem do CSV de tarefas e a de finanças compartilham
// as mesmas regras de escape.
export { csvEscape };

export type ViewFilter = 'all' | 'today' | 'overdue' | 'noDate';
export type SortMode = 'dueDate' | 'priority' | 'created';
export const NO_CATEGORY = '__none__';

const PRIORITY_WEIGHT: Record<TaskItem['priority'], number> = { High: 0, Medium: 1, Low: 2 };

export interface TaskFilterOptions {
  /** Ids de categoria selecionados (multi-seleção); pode incluir NO_CATEGORY. Vazio = sem filtro. */
  categoryFilterIds: string[];
  viewFilter: ViewFilter;
  searchTerm: string;
  sortMode: SortMode;
  now?: Date;
}

export function filterAndSortTasks(tasks: TaskItem[], opts: TaskFilterOptions): TaskItem[] {
  const now = opts.now ?? new Date();
  let list = tasks;

  if (opts.categoryFilterIds.length > 0) {
    const wantsNoCategory = opts.categoryFilterIds.includes(NO_CATEGORY);
    const ids = opts.categoryFilterIds.filter((id) => id !== NO_CATEGORY);
    list = list.filter(
      (t) =>
        (wantsNoCategory && t.categoryIds.length === 0) || t.categoryIds.some((id) => ids.includes(id)),
    );
  }

  if (opts.viewFilter === 'today') {
    const today = now.toDateString();
    list = list.filter((t) => t.dueDate && new Date(t.dueDate).toDateString() === today && !t.isCompleted);
  } else if (opts.viewFilter === 'overdue') {
    list = list.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now.getTime() && !t.isCompleted);
  } else if (opts.viewFilter === 'noDate') {
    list = list.filter((t) => !t.dueDate);
  }

  const term = opts.searchTerm.trim().toLowerCase();
  if (term) {
    list = list.filter(
      (t) => t.title.toLowerCase().includes(term) || (t.description ?? '').toLowerCase().includes(term),
    );
  }

  const sorted = [...list];
  switch (opts.sortMode) {
    case 'dueDate':
      sorted.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
      break;
    case 'priority':
      sorted.sort((a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]);
      break;
    case 'created':
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
  }
  return sorted;
}

export interface TaskGroup {
  categoryId: string | null;
  label: string;
  tasks: TaskItem[];
}

/**
 * Agrupa as tarefas pela primeira categoria de cada uma (sem duplicar em vários grupos),
 * respeitando a ordem das categorias recebida e deixando "Sem categoria" por último.
 */
export function groupTasksByFirstCategory(tasks: TaskItem[], categories: TaskCategory[]): TaskGroup[] {
  const byCategoryId = new Map<string, TaskItem[]>();
  const noCategory: TaskItem[] = [];

  for (const task of tasks) {
    const firstId = task.categoryIds[0];
    if (!firstId) {
      noCategory.push(task);
      continue;
    }
    const bucket = byCategoryId.get(firstId);
    if (bucket) bucket.push(task);
    else byCategoryId.set(firstId, [task]);
  }

  const groups: TaskGroup[] = [];
  for (const category of categories) {
    const bucket = byCategoryId.get(category.id);
    if (bucket && bucket.length > 0) groups.push({ categoryId: category.id, label: category.name, tasks: bucket });
  }
  if (noCategory.length > 0) groups.push({ categoryId: null, label: 'Sem categoria', tasks: noCategory });
  return groups;
}

export function tasksToCsv(
  tasks: TaskItem[],
  categoryName: (t: TaskItem) => string,
  formatDueDate: (iso: string) => string,
): string {
  const rows = [['Título', 'Descrição', 'Prazo', 'Prioridade', 'Categoria', 'Concluída']];
  for (const t of tasks) {
    rows.push([
      t.title,
      t.description ?? '',
      t.dueDate ? formatDueDate(t.dueDate) : '',
      t.priority,
      categoryName(t),
      t.isCompleted ? 'Sim' : 'Não',
    ]);
  }
  return toCsv(rows);
}
