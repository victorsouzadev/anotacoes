import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../../shared/icon';
import { PomodoroTimerComponent } from '../pomodoro/pomodoro-timer.component';
import { TaskActivitiesService } from '../services/task-activities.service';
import { PomodoroService } from '../services/pomodoro.service';
import { TasksStoreService } from '../services/tasks-store.service';
import { TaskActivity, TaskItem, activityDurationSeconds, formatDuration, moveItem } from '../models/task.model';

@Component({
  selector: 'app-tasks-foco-page',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, PomodoroTimerComponent],
  template: `
    <div class="page">
      @if (activity(); as act) {
        <header class="foco-header">
          <a class="back" routerLink="/tasks">&larr; Tarefas</a>
          <div class="title-block">
            <h1>{{ act.name }}</h1>
            @if (task(); as t) {
              <span class="subtitle">Foco: {{ t.title }}</span>
            }
          </div>
          @if (!act.endedAt) {
            <div class="header-actions">
              <span class="timer">{{ elapsedLabel(act) }}</span>
              <button class="finish" (click)="finishActivity(act.id)">Finalizar atividade</button>
            </div>
          }
        </header>

        <main class="content">
          @if (act.endedAt) {
            <div class="ended-card">
              <p>Atividade já finalizada.</p>
              <p class="duration">Duração: {{ formatDuration(activityDurationSeconds(act)) }}</p>
              <a routerLink="/tasks">Voltar pra Tarefas</a>
            </div>
          } @else {
            @if (task(); as t) {
              <section class="section">
                <h2>Subtarefas</h2>
                <div class="new-subtask-row">
                  <input
                    [(ngModel)]="newSubtaskTitle"
                    placeholder="Nova subtarefa"
                    (keydown.enter)="addSubtask(t)"
                  />
                  <button class="primary" (click)="addSubtask(t)">Adicionar</button>
                </div>

                @if (t.subtasks.length === 0) {
                  <p class="empty">Nenhuma subtarefa ainda.</p>
                } @else {
                  <ul class="subtask-list">
                    @for (s of t.subtasks; track $index) {
                      <li
                        class="subtask-row"
                        [class.drag-over]="dragOverIndex === $index"
                        draggable="true"
                        (dragstart)="onDragStart($index)"
                        (dragend)="onDragEnd()"
                        (dragover)="onDragOver($index, $event)"
                        (drop)="onDrop(t, $index, $event)"
                      >
                        <span class="grip">::</span>
                        <button type="button" class="check" [class.done]="s.isCompleted" (click)="toggleSubtask(t, $index)">
                          @if (s.isCompleted) { <app-icon name="check" [size]="11" /> }
                        </button>
                        <span class="title" [class.done]="s.isCompleted">{{ s.title }}</span>
                        <button type="button" class="remove" (click)="removeSubtask(t, $index)" title="Remover">
                          <app-icon name="delete" [size]="13" />
                        </button>
                      </li>
                    }
                  </ul>
                }
              </section>

              <section class="section">
                <h2>Pomodoro</h2>
                <app-pomodoro-timer />
              </section>
            } @else {
              <p class="empty-standalone">Atividade sem tarefa vinculada — só o timer acima.</p>
            }
          }
        </main>
      } @else {
        <p class="empty">Redirecionando…</p>
      }
    </div>
  `,
  styles: [`
    .page { min-height: 100dvh; background: var(--bg); }

    .foco-header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 14px 28px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .back { font-size: 13px; color: var(--text-muted); text-decoration: none; flex-shrink: 0; }
    .back:hover { color: var(--text); }
    .title-block { flex: 1; min-width: 0; }
    .title-block h1 { font-size: 16px; margin: 0; }
    .subtitle { font-size: 12px; color: var(--text-muted); }
    .header-actions { display: flex; align-items: center; gap: 12px; }
    .timer { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text); }
    .finish {
      border: none; background: var(--accent); color: #fff;
      border-radius: var(--radius-sm); padding: 8px 14px; font-size: 13px; font-weight: 600;
    }
    .finish:hover { background: var(--accent-dark); }

    .content { max-width: 560px; margin: 0 auto; padding: 24px 28px; display: flex; flex-direction: column; gap: 28px; }

    .ended-card {
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 24px; text-align: center; display: flex; flex-direction: column; gap: 8px;
    }
    .ended-card .duration { color: var(--text-muted); font-size: 13px; }

    .section h2 { font-size: 14px; margin: 0 0 12px; }

    .new-subtask-row { display: flex; gap: 8px; margin-bottom: 12px; }
    .new-subtask-row input {
      flex: 1; border: 1px solid var(--border); border-radius: var(--radius-sm);
      padding: 8px 10px; background: var(--surface); color: var(--text); font-size: 13px;
    }
    .new-subtask-row .primary {
      border: none; background: var(--accent); color: #fff;
      border-radius: var(--radius-sm); padding: 8px 14px; font-size: 13px; font-weight: 600;
    }
    .new-subtask-row .primary:hover { background: var(--accent-dark); }

    .empty, .empty-standalone { color: var(--text-muted); font-size: 13px; text-align: center; padding: 12px 0; }

    .subtask-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .subtask-row {
      display: flex; align-items: center; gap: 8px;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm);
      padding: 8px 10px; cursor: grab;
    }
    .subtask-row.drag-over { border-color: var(--accent); box-shadow: 0 -2px 0 var(--accent); }
    .subtask-row .grip { color: var(--text-muted); font-size: 12px; letter-spacing: -1px; flex-shrink: 0; }
    .subtask-row .check {
      width: 18px; height: 18px; flex-shrink: 0;
      border: 1.5px solid var(--border); border-radius: 5px;
      background: var(--bg); color: #fff; display: flex; align-items: center; justify-content: center;
    }
    .subtask-row .check.done { background: var(--accent); border-color: var(--accent); }
    .subtask-row .title { flex: 1; min-width: 0; font-size: 13px; color: var(--text); }
    .subtask-row .title.done { text-decoration: line-through; color: var(--text-muted); }
    .subtask-row .remove { border: none; background: none; padding: 4px; border-radius: 4px; color: var(--text-muted); display: flex; }
    .subtask-row .remove:hover { background: var(--bg); color: var(--danger, #dc2626); }

    @media (max-width: 480px) {
      .foco-header { padding: 12px 16px; }
      .content { padding: 16px; }
    }
  `],
})
export class TasksFocoPageComponent implements OnInit, OnDestroy {
  readonly formatDuration = formatDuration;
  readonly activityDurationSeconds = activityDurationSeconds;

  newSubtaskTitle = '';
  dragIndex: number | null = null;
  dragOverIndex: number | null = null;

  private activityId = '';
  private nowTick = signal(Date.now());
  private tickInterval?: ReturnType<typeof setInterval>;

  activity = computed(() => this.activitiesService.activities().find((a) => a.id === this.activityId) ?? null);
  task = computed(() => {
    const act = this.activity();
    if (!act?.taskId) return null;
    return this.store.tasks().find((t) => t.id === act.taskId) ?? null;
  });

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public activitiesService: TaskActivitiesService,
    public pomodoro: PomodoroService,
    public store: TasksStoreService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.activityId = this.route.snapshot.paramMap.get('activityId') ?? '';
    if (this.store.tasks().length === 0) await this.store.reload();

    const act = this.activity();
    if (!act) {
      await this.router.navigateByUrl('/tasks');
      return;
    }
    if (act.taskId) this.pomodoro.setSelectedTask(act.taskId);

    this.tickInterval = setInterval(() => this.nowTick.set(Date.now()), 1000);
  }

  ngOnDestroy(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  elapsedLabel(activity: TaskActivity): string {
    this.nowTick();
    return formatDuration(activityDurationSeconds(activity));
  }

  finishActivity(id: string): void {
    this.activitiesService.finish(id);
    this.router.navigateByUrl('/tasks');
  }

  async addSubtask(task: TaskItem): Promise<void> {
    const title = this.newSubtaskTitle.trim();
    if (!title) return;
    const subtasks = [...task.subtasks, { title, isCompleted: false, position: task.subtasks.length }];
    await this.store.updateTask(task, { subtasks });
    this.newSubtaskTitle = '';
  }

  async removeSubtask(task: TaskItem, index: number): Promise<void> {
    const subtasks = task.subtasks.filter((_, i) => i !== index).map((s, i) => ({ ...s, position: i }));
    await this.store.updateTask(task, { subtasks });
  }

  async toggleSubtask(task: TaskItem, index: number): Promise<void> {
    await this.store.toggleSubtask(task, index);
  }

  onDragStart(index: number): void {
    this.dragIndex = index;
  }

  onDragEnd(): void {
    this.dragIndex = null;
    this.dragOverIndex = null;
  }

  onDragOver(index: number, event: DragEvent): void {
    event.preventDefault();
    this.dragOverIndex = index;
  }

  async onDrop(task: TaskItem, index: number, event: DragEvent): Promise<void> {
    event.preventDefault();
    const from = this.dragIndex;
    this.dragIndex = null;
    this.dragOverIndex = null;
    if (from === null || from === index) return;
    const reordered = moveItem(task.subtasks, from, index).map((s, i) => ({ ...s, position: i }));
    await this.store.updateTask(task, { subtasks: reordered });
  }
}
