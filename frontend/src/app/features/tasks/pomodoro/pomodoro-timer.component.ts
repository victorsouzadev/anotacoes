import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PomodoroService } from '../services/pomodoro.service';
import { TaskNotificationsService } from '../services/task-notifications.service';

@Component({
  selector: 'app-pomodoro-timer',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="timer-card" [class.break]="pomodoro.phase() === 'break'">
      <button class="settings-toggle" (click)="toggleSettings()" title="Configurar pausas">⚙</button>

      @if (showSettings) {
        <div class="settings-panel" (click)="$event.stopPropagation()">
          <label>
            <span>Pausa curta (min)</span>
            <input type="number" min="1" [(ngModel)]="shortBreakMinutes" />
          </label>
          <label>
            <span>Pausa longa (min)</span>
            <input type="number" min="1" [(ngModel)]="longBreakMinutes" />
          </label>
          <label>
            <span>Ciclos até a pausa longa</span>
            <input type="number" min="1" [(ngModel)]="cyclesUntilLongBreak" />
          </label>
          <label class="checkbox-row">
            <input type="checkbox" [(ngModel)]="soundEnabled" />
            <span>Tocar som ao trocar de fase</span>
          </label>

          @if (notifications.supported && notifications.permission() === 'granted') {
            <span class="notif-status">Notificações ativadas</span>
          } @else if (notifications.supported && notifications.permission() === 'denied') {
            <span class="notif-status">Notificações bloqueadas — libere nas configurações do navegador.</span>
          } @else if (notifications.supported) {
            <button type="button" class="notif-request" (click)="notifications.requestPermission()">
              Ativar notificações
            </button>
          }

          <div class="settings-actions">
            <button class="secondary" (click)="showSettings = false">Cancelar</button>
            <button class="primary" (click)="saveSettings()">Salvar</button>
          </div>
        </div>
      }

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
      <span class="persist-hint">O timer continua rodando mesmo se você mudar de página, recarregar ou fechar a aba.</span>
    </div>
  `,
  styles: [`
    .timer-card {
      position: relative;
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
    .persist-hint { font-size: 11px; color: var(--text-muted); text-align: center; }

    .settings-toggle {
      position: absolute; top: 12px; right: 12px;
      border: 1px solid var(--border); background: var(--surface);
      color: var(--text-muted); border-radius: var(--radius-sm);
      width: 28px; height: 28px; font-size: 14px; line-height: 1;
    }
    .settings-toggle:hover { border-color: var(--accent); color: var(--accent); }

    .settings-panel {
      position: absolute; top: 46px; right: 12px; z-index: 10;
      width: 220px;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
      box-shadow: var(--shadow-lg); padding: 12px;
      display: flex; flex-direction: column; gap: 10px;
      text-align: left;
    }
    .settings-panel label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
    .settings-panel input {
      border: 1px solid var(--border); border-radius: var(--radius-sm);
      padding: 6px 8px; background: var(--bg); color: var(--text); font-size: 13px;
    }
    .settings-panel .checkbox-row { flex-direction: row; align-items: center; gap: 8px; }
    .settings-panel .checkbox-row input { width: auto; padding: 0; }
    .notif-status { font-size: 11px; color: var(--text-muted); }
    .notif-request {
      align-self: flex-start; border: 1px solid var(--border); background: var(--surface);
      color: var(--text); border-radius: var(--radius-sm); padding: 6px 10px; font-size: 12px; font-weight: 600;
    }
    .notif-request:hover { border-color: var(--accent); color: var(--accent); }
    .settings-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .settings-actions button { border-radius: var(--radius-sm); padding: 6px 12px; font-size: 12px; font-weight: 600; }
    .settings-actions .primary { border: none; background: var(--accent); color: #fff; }
    .settings-actions .primary:hover { background: var(--accent-dark); }
    .settings-actions .secondary { border: 1px solid var(--border); background: var(--surface); color: var(--text); }

    @media (max-width: 480px) {
      .timer-card { padding: 28px 16px; }
      .time { font-size: 42px; }
      .controls { width: 100%; }
      .controls button { flex: 1; }
    }
  `],
})
export class PomodoroTimerComponent {
  showSettings = false;
  shortBreakMinutes = 5;
  longBreakMinutes = 15;
  cyclesUntilLongBreak = 4;
  soundEnabled = true;

  constructor(public pomodoro: PomodoroService, public notifications: TaskNotificationsService) {}

  toggleSettings(): void {
    if (!this.showSettings) {
      const s = this.pomodoro.settings();
      this.shortBreakMinutes = Math.round(s.shortBreakSeconds / 60);
      this.longBreakMinutes = Math.round(s.longBreakSeconds / 60);
      this.cyclesUntilLongBreak = s.cyclesUntilLongBreak;
      this.soundEnabled = s.soundEnabled;
    }
    this.showSettings = !this.showSettings;
  }

  saveSettings(): void {
    this.pomodoro.updateSettings({
      shortBreakSeconds: this.shortBreakMinutes * 60,
      longBreakSeconds: this.longBreakMinutes * 60,
      cyclesUntilLongBreak: this.cyclesUntilLongBreak,
      soundEnabled: this.soundEnabled,
    });
    this.showSettings = false;
  }
}
