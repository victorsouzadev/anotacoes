import { TaskItem } from '../models/task.model';

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

export function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
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
  return rows.map((r) => r.map(csvEscape).join(';')).join('\r\n');
}
