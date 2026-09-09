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

  /** Todas as atividades em andamento, da mais recente para a mais antiga. */
  runningAll = computed(() =>
    this.activities()
      .filter((a) => !a.endedAt)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
  );

  /** Atividade em andamento mais recente (atalho para quando só uma interessa). */
  running = computed(() => this.runningAll()[0] ?? null);

  finished = computed(() =>
    this.activities()
      .filter((a) => !!a.endedAt)
      .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? '')),
  );

  /** Inicia uma atividade nova. Várias atividades podem correr ao mesmo tempo. */
  start(name: string, taskId: string | null): TaskActivity {
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

  finishAll(): void {
    const now = new Date().toISOString();
    this.activities.update((list) => {
      const next = list.map((a) => (a.endedAt ? a : { ...a, endedAt: now }));
      this.persist(next);
      return next;
    });
  }

  runningForTask(taskId: string): TaskActivity[] {
    return this.runningAll().filter((a) => a.taskId === taskId);
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
