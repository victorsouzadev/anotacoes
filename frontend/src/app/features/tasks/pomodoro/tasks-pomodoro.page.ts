import { FormsModule } from '@angular/forms';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TasksTopBarComponent } from '../components/tasks-top-bar.component';
import { TasksStoreService } from '../services/tasks-store.service';
import { PomodoroService } from '../services/pomodoro.service';

@Component({
  selector: 'app-tasks-pomodoro-page',
  standalone: true,
  imports: [FormsModule, TasksTopBarComponent],
  template: `
    <div class="page">
      <app-tasks-top-bar />
      <main class="content">
        <label class="task-picker">
          <span>Tarefa (opcional)</span>
          <select [ngModel]="pomodoro.selectedTaskId()" (ngModelChange)="pomodoro.setSelectedTask($event)">
            <option [ngValue]="null">Sem tarefa vinculada</option>
            @for (t of store.activeTasks(); track t.id) {
              <option [ngValue]="t.id">{{ t.title }}</option>
            }
          </select>
        </label>

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
      </main>
    </div>
  `,
  styles: [`
    .page { min-height: 100dvh; background: var(--bg); }
    .content { max-width: 480px; margin: 0 auto; padding: 24px 28px; display: flex; flex-direction: column; gap: 20px; align-items: stretch; }
    .task-picker { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-muted); }
    .task-picker select { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; background: var(--surface); color: var(--text); font-size: 14px; }
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
      .content { padding: 16px; }
      .timer-card { padding: 28px 16px; }
      .time { font-size: 42px; }
      .controls { width: 100%; }
      .controls button { flex: 1; }
    }
  `],
})
export class TasksPomodoroPageComponent implements OnInit {
  constructor(
    public store: TasksStoreService,
    public pomodoro: PomodoroService,
    private route: ActivatedRoute,
  ) {}

  async ngOnInit(): Promise<void> {
    if (this.store.tasks().length === 0) await this.store.reload();
    const taskId = this.route.snapshot.queryParamMap.get('taskId');
    if (taskId) this.pomodoro.setSelectedTask(taskId);
  }
}
