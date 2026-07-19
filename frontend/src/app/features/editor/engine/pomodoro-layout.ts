import { PomodoroElement } from '../../../data/models';

export const POMODORO_DEFAULT_W = 200;
export const POMODORO_DEFAULT_H = 140;
export const POMODORO_WORK_SEC = 25 * 60;
export const POMODORO_BREAK_SEC = 5 * 60;
export const POMODORO_PADDING = 12;
export const POMODORO_BUTTON_SIZE = 30;

export interface PomodoroButtonLayout {
  playPause: { x: number; y: number; w: number; h: number };
  reset: { x: number; y: number; w: number; h: number };
}

/** Posição dos dois botões (play/pause e reiniciar) em coordenadas de mundo — usado
 * tanto pelo renderer (desenhar) quanto pelo hit-test do canvas-host (clicar), pra
 * nunca divergirem sobre onde cada botão realmente está. */
export function pomodoroButtonLayouts(el: PomodoroElement): PomodoroButtonLayout {
  const size = Math.min(POMODORO_BUTTON_SIZE, el.h - POMODORO_PADDING * 2);
  const y = el.y + el.h - POMODORO_PADDING - size;
  const cx = el.x + el.w / 2;
  const gap = 8;
  return {
    playPause: { x: cx - gap / 2 - size, y, w: size, h: size },
    reset: { x: cx + gap / 2, y, w: size, h: size },
  };
}

/** Tempo restante exibido agora, sem mutar o elemento — enquanto rodando, deriva do
 * horário de término (phaseEndAt) em vez de decrementar remainingSec a cada tick,
 * pra ficar correto mesmo se a aba ficou em segundo plano por um tempo. */
export function pomodoroDisplaySec(el: PomodoroElement, now: number = Date.now()): number {
  if (!el.running || !el.phaseEndAt) return el.remainingSec;
  return Math.max(0, Math.round((new Date(el.phaseEndAt).getTime() - now) / 1000));
}

export function formatPomodoroTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
