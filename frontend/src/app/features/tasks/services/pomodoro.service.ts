import { Injectable, signal } from '@angular/core';
import { POMODORO_WORK_SECONDS } from '../models/task.model';
import { TasksStoreService } from './tasks-store.service';
import { TaskNotificationsService } from './task-notifications.service';

export type PomodoroPhase = 'work' | 'break';

export interface PomodoroSettings {
  shortBreakSeconds: number;
  longBreakSeconds: number;
  cyclesUntilLongBreak: number;
  soundEnabled: boolean;
}

const DEFAULT_SETTINGS: PomodoroSettings = {
  shortBreakSeconds: 5 * 60,
  longBreakSeconds: 15 * 60,
  cyclesUntilLongBreak: 4,
  soundEnabled: true,
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

  constructor(
    private store: TasksStoreService,
    private notifications: TaskNotificationsService,
  ) {
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
      soundEnabled: partial.soundEnabled ?? this.settings().soundEnabled,
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

  /** Duração total da fase atual, útil pra saber se o timer já foi iniciado. */
  phaseTotalSeconds(): number {
    if (this.phase() === 'work') return POMODORO_WORK_SECONDS;
    const isLong = this.cyclesCompleted() > 0 && this.cyclesCompleted() % this.settings().cyclesUntilLongBreak === 0;
    return isLong ? this.settings().longBreakSeconds : this.settings().shortBreakSeconds;
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

  private async completePhase(opts: { silent?: boolean } = {}): Promise<void> {
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

    if (!opts.silent) {
      this.playAlarm();
      this.notifyPhaseComplete(this.phase());
    }
  }

  /** Beep curto (2 tons ascendentes) via Web Audio API — sem depender de nenhum asset de áudio. */
  private playAlarm(): void {
    if (!this.settings().soundEnabled) return;
    try {
      const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextCtor();
      const playTone = (freq: number, startAt: number, durationSec: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.2, startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, startAt + durationSec);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startAt);
        osc.stop(startAt + durationSec);
      };
      const now = ctx.currentTime;
      playTone(660, now, 0.15);
      playTone(880, now + 0.16, 0.2);
      setTimeout(() => void ctx.close(), 500);
    } catch {
      // Web Audio indisponível (ambiente sem suporte) — silenciosamente ignora, o alarme não é essencial.
    }
  }

  private notifyPhaseComplete(newPhase: PomodoroPhase): void {
    if (this.notifications.permission() !== 'granted') return;
    const title = newPhase === 'break' ? 'Hora da pausa! ☕' : 'De volta ao foco! 🎯';
    const body = newPhase === 'break' ? 'Você completou um pomodoro. Aproveite a pausa.' : 'A pausa acabou — bora focar de novo.';
    new Notification(title, { body });
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
      void this.completePhase({ silent: true });
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
