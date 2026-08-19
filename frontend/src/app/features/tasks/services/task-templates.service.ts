import { Injectable, signal } from '@angular/core';
import { uuid } from '../../../core/uuid';
import { Priority, Subtask } from '../models/task.model';
import type { TaskFormResult } from '../components/task-form.component';

export interface TaskTemplate {
  id: string;
  name: string;
  title: string;
  description: string | null;
  priority: Priority;
  categoryId: string | null;
  isRecurring: boolean;
  recurrenceRule: string | null;
  subtasks: Subtask[];
}

const STORAGE_KEY = 'tasks.templates.v1';

export function templateFromResult(id: string, name: string, result: TaskFormResult): TaskTemplate {
  return {
    id,
    name,
    title: result.title,
    description: result.description,
    priority: result.priority,
    categoryId: result.categoryId,
    isRecurring: result.isRecurring,
    recurrenceRule: result.recurrenceRule,
    subtasks: result.subtasks.map((s) => ({ ...s, isCompleted: false })),
  };
}

export function loadTemplates(storage: Pick<Storage, 'getItem'>): TaskTemplate[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TaskTemplate[]) : [];
  } catch {
    return [];
  }
}

@Injectable({ providedIn: 'root' })
export class TaskTemplatesService {
  templates = signal<TaskTemplate[]>(loadTemplates(localStorage));

  save(name: string, result: TaskFormResult): TaskTemplate {
    const template = templateFromResult(uuid(), name, result);
    this.templates.update((list) => {
      const next = [...list, template];
      this.persist(next);
      return next;
    });
    return template;
  }

  remove(id: string): void {
    this.templates.update((list) => {
      const next = list.filter((t) => t.id !== id);
      this.persist(next);
      return next;
    });
  }

  private persist(templates: TaskTemplate[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  }
}
