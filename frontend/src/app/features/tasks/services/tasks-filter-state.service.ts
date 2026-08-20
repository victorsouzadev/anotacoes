import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'tasks.categoryFilter.v1';

export function loadCategoryFilter(storage: Pick<Storage, 'getItem'>): string[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Filtro de categorias (multi-seleção) compartilhado entre lista e Kanban, persistido pra sobreviver a navegação. */
@Injectable({ providedIn: 'root' })
export class TasksFilterStateService {
  categoryFilterIds = signal<string[]>(loadCategoryFilter(localStorage));

  toggle(id: string): void {
    const current = this.categoryFilterIds();
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    this.set(next);
  }

  clear(): void {
    this.set([]);
  }

  private set(ids: string[]): void {
    this.categoryFilterIds.set(ids);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }
}
