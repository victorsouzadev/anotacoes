import { FormsModule } from '@angular/forms';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TasksTopBarComponent } from '../components/tasks-top-bar.component';
import { TasksStoreService } from '../services/tasks-store.service';

type Phase = 'work' | 'break';

const WORK_SECONDS = 25 * 60;
const SHORT_BREAK_SECONDS = 5 * 60;
const LONG_BREAK_SECONDS = 15 * 60;

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
          <select [(ngModel)]="selectedTaskId">
            <option [ngValue]="null">Sem tarefa vinculada</option>
            @for (t of store.activeTasks(); track t.id) {
              <option [ngValue]="t.id">{{ t.title }}</option>
            }
          </select>
        </label>

        <div class="timer-card" [class.break]="phase === 'break'">
          <span class="phase-label">{{ phase === 'work' ? 'Foco' : 'Pausa' }}</span>
          <span class="time">{{ formatTime(secondsLeft) }}</span>
          <div class="controls">
            @if (!running) {
              <button class="primary" (click)="start()">Iniciar</button>
            } @else {
              <button class="primary" (click)="pause()">Pausar</button>
            }
            <button class="secondary" (click)="reset()">Reiniciar</button>
          </div>
          <span class="cycles">{{ cyclesCompleted }} pomodoro(s) concluído(s) nesta sessão</span>
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
  `],
})
export class TasksPomodoroPageComponent implements OnInit, OnDestroy {
  selectedTaskId: string | null = null;
  phase: Phase = 'work';
  secondsLeft = WORK_SECONDS;
  running = false;
  cyclesCompleted = 0;

  private intervalId?: ReturnType<typeof setInterval>;

  constructor(
    public store: TasksStoreService,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    if (this.store.tasks().length === 0) await this.store.reload();
    this.selectedTaskId = this.route.snapshot.queryParamMap.get('taskId');
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  formatTime(totalSeconds: number): string {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.intervalId = setInterval(() => this.tick(), 1000);
  }

  pause(): void {
    this.running = false;
    if (this.intervalId) clearInterval(this.intervalId);
    this.cdr.markForCheck();
  }

  reset(): void {
    this.pause();
    this.phase = 'work';
    this.secondsLeft = WORK_SECONDS;
    this.cdr.markForCheck();
  }

  private tick(): void {
    this.secondsLeft--;
    if (this.secondsLeft <= 0) {
      this.completePhase();
    }
    this.cdr.markForCheck();
  }

  private async completePhase(): Promise<void> {
    if (this.phase === 'work') {
      this.cyclesCompleted++;
      const task = this.selectedTaskId ? this.store.tasks().find((t) => t.id === this.selectedTaskId) : undefined;
      if (task) await this.store.incrementPomodoro(task);
      this.phase = 'break';
      this.secondsLeft = this.cyclesCompleted % 4 === 0 ? LONG_BREAK_SECONDS : SHORT_BREAK_SECONDS;
    } else {
      this.phase = 'work';
      this.secondsLeft = WORK_SECONDS;
    }
    this.cdr.markForCheck();
  }
}
