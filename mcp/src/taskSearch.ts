import type { Priority, TaskCategory, TaskItem } from './tasksApi.js';
import { findCategoryByName } from './taskMatch.js';

export interface TaskSearchFilters {
  query?: string;
  categoryName?: string;
  priority?: Priority;
  dueBefore?: string;
  dueAfter?: string;
  includeCompleted?: boolean;
  includeDeleted?: boolean;
}

export function searchTasks(tasks: TaskItem[], categories: TaskCategory[], filters: TaskSearchFilters): TaskItem[] {
  let list = tasks;

  if (!filters.includeDeleted) list = list.filter((t) => !t.deletedAt);
  if (!filters.includeCompleted) list = list.filter((t) => !t.isCompleted);

  const query = filters.query?.trim().toLowerCase();
  if (query) {
    list = list.filter(
      (t) => t.title.toLowerCase().includes(query) || (t.description ?? '').toLowerCase().includes(query),
    );
  }

  if (filters.categoryName?.trim()) {
    const category = findCategoryByName(categories, filters.categoryName);
    list = category ? list.filter((t) => t.categoryId === category.id) : [];
  }

  if (filters.priority) list = list.filter((t) => t.priority === filters.priority);
  if (filters.dueBefore) list = list.filter((t) => !!t.dueDate && t.dueDate < filters.dueBefore!);
  if (filters.dueAfter) list = list.filter((t) => !!t.dueDate && t.dueDate > filters.dueAfter!);

  return list;
}
