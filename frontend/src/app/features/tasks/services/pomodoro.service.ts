import { Injectable, signal } from '@angular/core';
import { POMODORO_WORK_SECONDS } from '../models/task.model';
import { TasksStoreService } from './tasks-store.service';

export type PomodoroPhase = 'work' | 'break';

const SHORT_BREAK_SECONDS = 5 * 60;
const LONG_BREAK_SECONDS = 15 * 60;

/**
 * Timer do pomodoro como singleton — sobrevive à navegação entre páginas (ao contrário de estado
 * de componente, que é destruído). Usa timestamp de fim de fase pra manter o tempo certo mesmo se
 * o setInterval atrasar (aba em segundo plano).
 */
@Injectable({ providedIn: 'root' })
export class PomodoroService {
  selectedTaskId = signal<string | null>(null);
  phase = signal<PomodoroPhase>('work');
  secondsLeft = signal(POMODORO_WORK_SECONDS);
  running = signal(false);
  cyclesCompleted = signal(0);

  private intervalId?: ReturnType<typeof setInterval>;
  private phaseEndAt: number | null = null;

  constructor(private store: TasksStoreService) {}

  setSelectedTask(taskId: string | null): void {
    this.selectedTaskId.set(taskId);
  }

  start(): void {
    if (this.running()) return;
    this.running.set(true);
    this.phaseEndAt = Date.now() + this.secondsLeft() * 1000;
    this.intervalId = setInterval(() => this.tick(), 1000);
  }

  pause(): void {
    this.running.set(false);
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = undefined;
    this.phaseEndAt = null;
  }

  reset(): void {
    this.pause();
    this.phase.set('work');
    this.secondsLeft.set(POMODORO_WORK_SECONDS);
  }

  formatTime(totalSeconds: number): string {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  private tick(): void {
    if (this.phaseEndAt == null) return;
    const remaining = Math.max(0, Math.round((this.phaseEndAt - Date.now()) / 1000));
    this.secondsLeft.set(remaining);
    if (remaining <= 0) void this.completePhase();
  }

  private async completePhase(): Promise<void> {
    if (this.phase() === 'work') {
      const cycles = this.cyclesCompleted() + 1;
      this.cyclesCompleted.set(cycles);
      const taskId = this.selectedTaskId();
      const task = taskId ? this.store.tasks().find((t) => t.id === taskId) : undefined;
      if (task) await this.store.incrementPomodoro(task);
      this.phase.set('break');
      const seconds = cycles % 4 === 0 ? LONG_BREAK_SECONDS : SHORT_BREAK_SECONDS;
      this.secondsLeft.set(seconds);
      this.phaseEndAt = Date.now() + seconds * 1000;
    } else {
      this.phase.set('work');
      this.secondsLeft.set(POMODORO_WORK_SECONDS);
      this.phaseEndAt = Date.now() + POMODORO_WORK_SECONDS * 1000;
    }
  }
}
