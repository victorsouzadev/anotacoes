import { Injectable, signal } from '@angular/core';
import { TaskItem } from '../models/task.model';

const CHECK_INTERVAL_MS = 60_000;
export const LOOKAHEAD_MINUTES = 15;

/** Tarefas ativas com prazo entre `now` e `now + withinMinutes`, ainda não concluídas. */
export function dueSoon(tasks: TaskItem[], now: Date, withinMinutes: number): TaskItem[] {
  const start = now.getTime();
  const limit = start + withinMinutes * 60_000;
  return tasks.filter((t) => {
    if (t.isCompleted || t.deletedAt || !t.dueDate) return false;
    const due = new Date(t.dueDate).getTime();
    return due >= start && due <= limit;
  });
}

type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

/** Notificações locais via Notification API — só disparam enquanto a aba estiver aberta,
 * não é push real em background (isso exigiria service worker + servidor de push). */
@Injectable({ providedIn: 'root' })
export class TaskNotificationsService {
  permission = signal<NotificationPermissionState>(this.readPermission());

  private notifiedIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  get supported(): boolean {
    return typeof Notification !== 'undefined';
  }

  private readPermission(): NotificationPermissionState {
    return this.supported ? (Notification.permission as NotificationPermissionState) : 'unsupported';
  }

  async requestPermission(): Promise<void> {
    if (!this.supported) return;
    const result = await Notification.requestPermission();
    this.permission.set(result as NotificationPermissionState);
  }

  start(getTasks: () => TaskItem[]): void {
    if (this.timer || !this.supported) return;
    this.timer = setInterval(() => this.check(getTasks()), CHECK_INTERVAL_MS);
    this.check(getTasks());
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private check(tasks: TaskItem[]): void {
    if (Notification.permission !== 'granted') return;
    for (const task of dueSoon(tasks, new Date(), LOOKAHEAD_MINUTES)) {
      if (this.notifiedIds.has(task.id)) continue;
      this.notifiedIds.add(task.id);
      new Notification('Tarefa vencendo', { body: task.title, tag: task.id });
    }
  }
}
