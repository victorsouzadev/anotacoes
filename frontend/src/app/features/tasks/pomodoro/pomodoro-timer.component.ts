import { Component } from '@angular/core';
import { PomodoroService } from '../services/pomodoro.service';

@Component({
  selector: 'app-pomodoro-timer',
  standalone: true,
  template: `
    <div class="timer-card" [class.break]="pomodoro.phase() === 'break'">
      <span class="phase-label">{{ pomodoro.phase() === 'work' ? 'Foco' : 'Pausa' }}</span>
      <span class="time">{{ pomodoro.formatTime(pomodoro.secondsLeft()) }}</span>
      <div class="controls">
        @if (!pomodoro.running()) {
          <button class="primary" (click)="pomodoro.start()">Iniciar</button>
        } @else {
          <button class="primary" (click)="pomodoro.pause()">Pausar</button>
        }
        <button class="secondary" (click)="pomodoro.reset()">Reiniciar</button>
      </div>
      <span class="cycles">{{ pomodoro.cyclesCompleted() }} pomodoro(s) concluído(s) nesta sessão</span>
      @if (pomodoro.running()) {
        <span class="persist-hint">O timer continua rodando mesmo se você mudar de página.</span>
      }
    </div>
  `,
  styles: [`
    .timer-card {
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
      padding: 40px 24px; display: flex; flex-direction: column; align-items: center; gap: 16px;
      box-shadow: var(--shadow-sm);
    }
    .timer-card.break { background: var(--accent-soft); }
    .phase-label { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
    .time { font-size: 56px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text); }
    .controls { display: flex; gap: 10px; }
    .controls button { border-radius: var(--radius-sm); padding: 10px 22px; font-size: 14px; font-weight: 600; }
    .controls .primary { border: none; background: var(--accent); color: #fff; }
    .controls .primary:hover { background: var(--accent-dark); }
    .controls .secondary { border: 1px solid var(--border); background: var(--surface); color: var(--text); }
    .controls .secondary:hover { background: var(--bg); }
    .cycles { font-size: 12px; color: var(--text-muted); }
    .persist-hint { font-size: 11px; color: var(--text-muted); }

    @media (max-width: 480px) {
      .timer-card { padding: 28px 16px; }
      .time { font-size: 42px; }
      .controls { width: 100%; }
      .controls button { flex: 1; }
    }
  `],
})
export class PomodoroTimerComponent {
  constructor(public pomodoro: PomodoroService) {}
}
