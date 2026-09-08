import { Injectable, signal } from '@angular/core';
import { POMODORO_WORK_SECONDS } from '../models/task.model';
import { TasksStoreService } from './tasks-store.service';

export type PomodoroPhase = 'work' | 'break';

export interface PomodoroSettings {
  shortBreakSeconds: number;
  longBreakSeconds: number;
  cyclesUntilLongBreak: number;
}

const DEFAULT_SETTINGS: PomodoroSettings = {
  shortBreakSeconds: 5 * 60,
  longBreakSeconds: 15 * 60,
  cyclesUntilLongBreak: 4,
};

const SETTINGS_KEY = 'tasks.pomodoro.settings.v1';
const STATE_KEY = 'tasks.pomodoro.state.v1';

interface PersistedState {
  phase: PomodoroPhase;
  running: boolean;
  secondsLeft: number;
  cyclesCompleted: number;
  selectedTaskId: string | null;
  /** Timestamp absoluto (epoch ms) de quando a fase termina, ou null se pausado. */
  phaseEndAt: number | null;
}

const DEFAULT_STATE: PersistedState = {
  phase: 'work',
  running: false,
  secondsLeft: POMODORO_WORK_SECONDS,
  cyclesCompleted: 0,
  selectedTaskId: null,
  phaseEndAt: null,
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Timer do pomodoro como singleton — sobrevive à navegação entre páginas (ao contrário de estado
 * de componente, que é destruído) e persiste em localStorage, sobrevivendo a recarregar/fechar a
 * aba. Usa timestamp de fim de fase pra manter o tempo certo mesmo se o setInterval atrasar (aba
 * em segundo plano) ou a aba tiver ficado fechada — ao reabrir, recalcula quanto tempo passou.
 */
@Injectable({ providedIn: 'root' })
export class PomodoroService {
  settings = signal<PomodoroSettings>(loadJson(SETTINGS_KEY, DEFAULT_SETTINGS));

  phase = signal<PomodoroPhase>('work');
  secondsLeft = signal(POMODORO_WORK_SECONDS);
  running = signal(false);
  cyclesCompleted = signal(0);
  selectedTaskId = signal<string | null>(null);

  private intervalId?: ReturnType<typeof setInterval>;
  private phaseEndAt: number | null = null;

  constructor(private store: TasksStoreService) {
    this.restoreState();
  }

  setSelectedTask(taskId: string | null): void {
    this.selectedTaskId.set(taskId);
    this.persistState();
  }

  updateSettings(partial: Partial<PomodoroSettings>): void {
    const next: PomodoroSettings = {
      shortBreakSeconds: Math.max(60, partial.shortBreakSeconds ?? this.settings().shortBreakSeconds),
      longBreakSeconds: Math.max(60, partial.longBreakSeconds ?? this.settings().longBreakSeconds),
      cyclesUntilLongBreak: Math.max(1, Math.round(partial.cyclesUntilLongBreak ?? this.settings().cyclesUntilLongBreak)),
    };
    this.settings.set(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }

  start(): void {
    if (this.running()) return;
    this.running.set(true);
    this.phaseEndAt = Date.now() + this.secondsLeft() * 1000;
    this.intervalId = setInterval(() => this.tick(), 1000);
    this.persistState();
  }

  pause(): void {
    this.running.set(false);
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = undefined;
    this.phaseEndAt = null;
    this.persistState();
  }

  reset(): void {
    this.pause();
    this.phase.set('work');
    this.secondsLeft.set(POMODORO_WORK_SECONDS);
    this.persistState();
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
    else this.persistState();
  }

  private async completePhase(): Promise<void> {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = undefined;

    if (this.phase() === 'work') {
      const cycles = this.cyclesCompleted() + 1;
      this.cyclesCompleted.set(cycles);
      const taskId = this.selectedTaskId();
      const task = taskId ? this.store.tasks().find((t) => t.id === taskId) : undefined;
      if (task) await this.store.incrementPomodoro(task);
      this.phase.set('break');
      const { shortBreakSeconds, longBreakSeconds, cyclesUntilLongBreak } = this.settings();
      const seconds = cycles % cyclesUntilLongBreak === 0 ? longBreakSeconds : shortBreakSeconds;
      this.secondsLeft.set(seconds);
      this.phaseEndAt = Date.now() + seconds * 1000;
    } else {
      this.phase.set('work');
      this.secondsLeft.set(POMODORO_WORK_SECONDS);
      this.phaseEndAt = Date.now() + POMODORO_WORK_SECONDS * 1000;
    }

    if (this.running()) this.intervalId = setInterval(() => this.tick(), 1000);
    this.persistState();
  }

  /** Carrega o estado salvo e, se a fase já tinha vencido (aba fechada), processa uma transição de alcance. */
  private restoreState(): void {
    const saved = loadJson(STATE_KEY, DEFAULT_STATE);
    this.phase.set(saved.phase);
    this.secondsLeft.set(saved.secondsLeft);
    this.cyclesCompleted.set(saved.cyclesCompleted);
    this.selectedTaskId.set(saved.selectedTaskId);

    if (!saved.running) return;

    if (saved.phaseEndAt != null && saved.phaseEndAt <= Date.now()) {
      // A fase venceu enquanto a aba estava fechada — processa uma única transição de alcance
      // (sem tentar simular vários ciclos perdidos em cascata) e recomeça a contagem a partir de agora.
      this.running.set(true);
      this.secondsLeft.set(0);
      void this.completePhase();
    } else if (saved.phaseEndAt != null) {
      this.running.set(true);
      this.phaseEndAt = saved.phaseEndAt;
      this.secondsLeft.set(Math.max(0, Math.round((saved.phaseEndAt - Date.now()) / 1000)));
      this.intervalId = setInterval(() => this.tick(), 1000);
    }
  }

  private persistState(): void {
    const state: PersistedState = {
      phase: this.phase(),
      running: this.running(),
      secondsLeft: this.secondsLeft(),
      cyclesCompleted: this.cyclesCompleted(),
      selectedTaskId: this.selectedTaskId(),
      phaseEndAt: this.phaseEndAt,
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }
}
