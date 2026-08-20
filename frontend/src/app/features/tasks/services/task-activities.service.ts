import { Injectable, computed, signal } from '@angular/core';
import { uuid } from '../../../core/uuid';
import { TaskActivity } from '../models/task.model';

const STORAGE_KEY = 'tasks.activities.v1';

export function loadActivities(storage: Pick<Storage, 'getItem'>): TaskActivity[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TaskActivity[]) : [];
  } catch {
    return [];
  }
}

@Injectable({ providedIn: 'root' })
export class TaskActivitiesService {
  activities = signal<TaskActivity[]>(loadActivities(localStorage));

  running = computed(() => this.activities().find((a) => !a.endedAt) ?? null);

  finished = computed(() =>
    this.activities()
      .filter((a) => !!a.endedAt)
      .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? '')),
  );

  /** Inicia uma atividade nova, finalizando automaticamente uma anterior em andamento (só uma por vez). */
  start(name: string, taskId: string | null): TaskActivity {
    const current = this.running();
    if (current) this.finish(current.id);
    const activity: TaskActivity = {
      id: uuid(),
      name: name.trim() || 'Atividade',
      taskId,
      startedAt: new Date().toISOString(),
      endedAt: null,
    };
    this.activities.update((list) => {
      const next = [...list, activity];
      this.persist(next);
      return next;
    });
    return activity;
  }

  finish(id: string): void {
    this.activities.update((list) => {
      const next = list.map((a) => (a.id === id && !a.endedAt ? { ...a, endedAt: new Date().toISOString() } : a));
      this.persist(next);
      return next;
    });
  }

  remove(id: string): void {
    this.activities.update((list) => {
      const next = list.filter((a) => a.id !== id);
      this.persist(next);
      return next;
    });
  }

  private persist(activities: TaskActivity[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(activities));
  }
}
