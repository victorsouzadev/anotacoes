import { Component, OnDestroy, OnInit, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { IconComponent } from '../../../shared/icon';
import { PomodoroTimerComponent } from '../pomodoro/pomodoro-timer.component';
import { NotesEditorComponent } from '../notes/notes-editor.component';
import { FOCO_COLUMNS, FOCO_COLUMN_LABELS, FOCO_PANEL_LABELS, FocoColumn, FocoLayoutService, FocoPanelId } from './foco-layout.service';
import { isNotesEmpty } from '../notes/notes-html';
import { TaskActivitiesService } from '../services/task-activities.service';
import { PomodoroService } from '../services/pomodoro.service';
import { TasksStoreService } from '../services/tasks-store.service';
import { TaskActivity, TaskItem, activityDurationSeconds, formatDuration, moveItem, totalTimeSpent } from '../models/task.model';

const PRIORITY_TINT: Record<TaskItem['priority'], string> = { High: '#dc2626', Medium: '#d97706', Low: '#16a34a' };

@Component({
  selector: 'app-tasks-foco-page',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, PomodoroTimerComponent, NotesEditorComponent],
  template: `
    <div class="page" [style.--tint]="tintColor()">
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
              <button class="layout-btn" [class.active]="showLayoutSettings" (click)="showLayoutSettings = !showLayoutSettings" title="Configurar áreas do foco">
                <app-icon name="grid-view" [size]="14" /> Áreas
              </button>
              <button class="finish" (click)="finishActivity(act.id)">Finalizar atividade</button>
            </div>
          }
        </header>

        @if (showLayoutSettings) {
          <section class="layout-settings">
            <div class="ls-head">
              <h2>Áreas do modo foco</h2>
              <div class="ls-head-actions">
                <button (click)="layout.setCollapsedAll(false)">Expandir painéis</button>
                <button (click)="layout.setColumnsCollapsed(false)">Expandir áreas</button>
                <button (click)="layout.reset()">Restaurar padrão</button>
                <button class="close" (click)="showLayoutSettings = false" title="Fechar"><app-icon name="x" [size]="12" /></button>
              </div>
            </div>

            <div class="ls-areas">
              @for (column of columns; track column) {
                <section class="ls-area">
                  <header class="ls-area-head">
                    <span class="ls-area-name">{{ columnLabels[column] }}</span>
                    <button
                      class="ls-area-toggle"
                      (click)="layout.toggleColumnCollapsed(column)"
                      [title]="layout.isColumnCollapsed(column) ? 'Mostrar esta área' : 'Ocultar esta área'"
                    >
                      {{ layout.isColumnCollapsed(column) ? 'Oculta' : 'Visível' }}
                    </button>
                  </header>

                  @if (layout.panelsIn(column).length === 0) {
                    <p class="ls-area-empty">Nenhum painel aqui.</p>
                  } @else {
                    <ul class="ls-list">
                      @for (panel of layout.panelsIn(column); track panel.id) {
                        <li>
                          <span class="ls-name">{{ panelLabels[panel.id] }}</span>
                          <span class="ls-actions">
                            <button (click)="layout.moveBy(panel.id, -1)" [disabled]="$first" title="Subir">&uarr;</button>
                            <button (click)="layout.moveBy(panel.id, 1)" [disabled]="$last" title="Descer">&darr;</button>
                            <button (click)="layout.shiftColumn(panel.id, -1)" [disabled]="!layout.canShift(panel.id, -1)" title="Mover para a área anterior">&larr;</button>
                            <button (click)="layout.shiftColumn(panel.id, 1)" [disabled]="!layout.canShift(panel.id, 1)" title="Mover para a próxima área">&rarr;</button>
                            <button class="ls-collapse" (click)="layout.toggleCollapsed(panel.id)">
                              {{ panel.collapsed ? 'Expandir' : 'Recolher' }}
                            </button>
                          </span>
                        </li>
                      }
                    </ul>
                  }
                </section>
              }
            </div>
          </section>
        }

        <main class="content">
          @if (act.endedAt) {
            <div class="ended-card">
              <p>Atividade já finalizada.</p>
              <p class="duration">Duração: {{ formatDuration(activityDurationSeconds(act)) }}</p>
              <a routerLink="/tasks">Voltar pra Tarefas</a>
            </div>
          } @else if (task(); as t) {
            <div class="cols" [style.grid-template-columns]="gridTemplate()">
              @for (column of columns; track column) {
                <section
                  class="col"
                  [class.col-left]="column === 'left'"
                  [class.col-hidden]="!isColumnVisible(column)"
                  [attr.aria-label]="'Área ' + columnLabels[column]"
                >
                  @for (panel of layout.panelsIn(column); track panel.id) {
                    <section class="panel" [class.collapsed]="panel.collapsed">
                      <h2 class="panel-title">
                        {{ panelLabels[panel.id] }}
                        @if (panel.collapsed) { <span class="panel-collapsed-tag">recolhido</span> }
                      </h2>

                      @if (!panel.collapsed) {
                        <div class="panel-body">
                          @switch (panel.id) {
                            @case ('info') {
                              @if (t.description) {
                                <p class="description">{{ t.description }}</p>
                              }

                              <div class="meta-row">
                                @if (t.dueDate) {
                                  <span class="chip due" [class.overdue]="isOverdue(t)">
                                    <app-icon name="calendar" [size]="11" /> {{ formatDueDate(t.dueDate) }}
                                  </span>
                                }
                                <span class="chip priority" [class]="t.priority.toLowerCase()">{{ t.priority }}</span>
                                @for (cat of store.categoriesFor(t); track cat.id) {
                                  <span class="chip category" [style.background]="cat.colorHex + '22'" [style.color]="cat.colorHex">{{ cat.name }}</span>
                                }
                              </div>

                              <div class="stats-row">
                                @if (t.subtasks.length > 0) {
                                  <div class="stat">
                                    <span class="stat-value">{{ completedSubtasks(t) }}/{{ t.subtasks.length }}</span>
                                    <span class="stat-label">subtarefas concluídas</span>
                                  </div>
                                }
                                @if (t.completedPomodoros > 0) {
                                  <div class="stat">
                                    <span class="stat-value">{{ formatDuration(totalTimeSpent(t.completedPomodoros)) }}</span>
                                    <span class="stat-label">{{ t.completedPomodoros }} pomodoro(s) nesta tarefa</span>
                                  </div>
                                }
                              </div>
                            }

                            @case ('subtasks') {
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
                            }

                            @case ('notes') {
                              <app-notes-editor [task]="t" />
                            }

                            @case ('pomodoro') {
                              <app-pomodoro-timer />
                            }
                          }
                        </div>
                      }
                    </section>
                  }

                </section>
              }
            </div>
          } @else {
            <p class="empty-standalone">
              Atividade sem tarefa vinculada — só o timer acima. Anotações ficam guardadas na tarefa,
              então vincule uma atividade a uma tarefa pra usar o bloco de anotações.
            </p>
          }
        </main>
      } @else {
        <p class="empty">Redirecionando…</p>
      }
    </div>
  `,
  styles: [`
    .page {
      min-height: 100dvh;
      background: linear-gradient(180deg, color-mix(in srgb, var(--tint, var(--accent)) 10%, var(--bg)) 0%, var(--bg) 420px);
    }

    .foco-header {
      display: flex;
      align-items: center;
      gap: 20px;
      padding: 28px 40px 20px;
      flex-wrap: wrap;
    }
    .back { font-size: 13px; color: var(--text-muted); text-decoration: none; flex-shrink: 0; }
    .back:hover { color: var(--text); }
    .title-block { flex: 1; min-width: 0; }
    .title-block h1 { font-size: 32px; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
    .subtitle { font-size: 14px; color: var(--text-muted); }
    .header-actions { display: flex; align-items: center; gap: 16px; }
    .timer { font-size: 30px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text); }
    .finish {
      border: none; background: var(--accent); color: var(--accent-contrast);
      border-radius: var(--radius-sm); padding: 10px 16px; font-size: 13px; font-weight: 600;
    }
    .finish:hover { background: var(--accent-dark); }

    .other-running {
      display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
      padding: 0 40px 12px;
    }
    .other-label { font-size: 12px; color: var(--text-muted); }
    .other-chip {
      display: inline-flex; align-items: center; gap: 5px;
      border: 1px solid var(--border); background: var(--surface); color: var(--text-muted);
      border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .other-chip:hover { border-color: var(--accent); color: var(--accent); }

    .layout-btn {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1px solid var(--border); background: var(--surface); color: var(--text-muted);
      border-radius: var(--radius-sm); padding: 9px 12px; font-size: 13px; font-weight: 600;
    }
    .layout-btn:hover, .layout-btn.active { border-color: var(--accent); color: var(--accent); }

    .layout-settings {
      margin: 0 40px 16px;
      border: 1px solid var(--border); border-radius: var(--radius);
      background: var(--surface); padding: 14px 16px;
    }
    .ls-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .ls-head h2 { font-size: 13px; margin: 0; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
    .ls-head-actions { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; }
    .layout-settings button {
      border: 1px solid var(--border); background: var(--bg); color: var(--text-muted);
      border-radius: var(--radius-sm); padding: 5px 9px; font-size: 12px; font-weight: 600;
    }
    .layout-settings button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    .layout-settings button:disabled { opacity: 0.4; }
    .layout-settings .close { display: inline-flex; align-items: center; padding: 5px 7px; }
    .ls-areas { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin-top: 12px; }
    .ls-area { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px; background: var(--bg); }
    .ls-area-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .ls-area-name { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
    .ls-area-toggle { margin-left: auto; }
    .ls-area-empty { font-size: 12px; color: var(--text-muted); margin: 0; }
    .ls-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .ls-list li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ls-name { font-size: 13px; font-weight: 600; }
    .ls-actions { display: flex; gap: 4px; margin-left: auto; }
    .ls-collapse { min-width: 68px; }

    .content { max-width: 1400px; padding: 8px 40px 40px; }

    /* Três áreas; as colunas visíveis vêm de gridTemplate(), pra área vazia não comer espaço. */
    .cols { display: grid; gap: 36px; align-items: start; }
    .col-hidden { display: none; }

    .col { display: flex; flex-direction: column; gap: 24px; min-width: 0; min-height: 60px; border-radius: var(--radius); }
    .col-hidden { display: none; }

    .col { display: flex; flex-direction: column; gap: 24px; min-width: 0; min-height: 60px; border-radius: var(--radius); }
    .col-empty {
      font-size: 12px; color: var(--text-muted); text-align: center;
      border: 1px dashed var(--border); border-radius: var(--radius); padding: 18px 10px; margin: 0;
    }

    .panel { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .panel-title {
      font-size: 14px; margin: 0; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.04em; font-weight: 700;
    }
    .panel.collapsed .panel-title { opacity: 0.6; }
    .panel-collapsed-tag { font-size: 10px; font-weight: 600; letter-spacing: 0; text-transform: none; opacity: 0.8; }
    .panel-body { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

    .ended-card {
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 24px; text-align: left; display: flex; flex-direction: column; gap: 8px; max-width: 400px;
    }
    .ended-card .duration { color: var(--text-muted); font-size: 13px; }

    .description { font-size: 14px; color: var(--text); line-height: 1.5; margin: 0; white-space: pre-wrap; }

    .meta-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 11px; padding: 3px 9px; border-radius: 999px;
      background: var(--surface); color: var(--text-muted); white-space: nowrap;
    }
    .chip.due.overdue { background: #fef2f2; color: #dc2626; }
    .chip.priority.high { background: #fef2f2; color: #dc2626; }
    .chip.priority.medium { background: #fffbeb; color: #b45309; }
    .chip.priority.low { background: #f0fdf4; color: #16a34a; }

    .stats-row { display: flex; flex-direction: column; gap: 10px; }
    .stat { display: flex; flex-direction: column; }
    .stat-value { font-size: 20px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }
    .stat-label { font-size: 12px; color: var(--text-muted); }


    .new-subtask-row { display: flex; gap: 8px; margin-bottom: 12px; }
    .new-subtask-row input {
      flex: 1; border: 1px solid var(--border); border-radius: var(--radius-sm);
      padding: 8px 10px; background: var(--surface); color: var(--text); font-size: 13px;
    }
    .new-subtask-row .primary {
      border: none; background: var(--accent); color: var(--accent-contrast);
      border-radius: var(--radius-sm); padding: 8px 14px; font-size: 13px; font-weight: 600;
    }
    .new-subtask-row .primary:hover { background: var(--accent-dark); }

    .empty, .empty-standalone { color: var(--text-muted); font-size: 13px; text-align: left; padding: 12px 0; }

    .subtask-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .subtask-row {
      display: flex; align-items: center; gap: 8px;
      border-radius: var(--radius-sm);
      padding: 7px 8px; cursor: grab;
    }
    .subtask-row:hover { background: var(--surface); }
    .subtask-row.drag-over { box-shadow: inset 0 2px 0 var(--accent); }
    .subtask-row .grip { color: var(--text-muted); font-size: 12px; letter-spacing: -1px; flex-shrink: 0; }
    .subtask-row .check {
      width: 18px; height: 18px; flex-shrink: 0;
      border: 1.5px solid var(--border); border-radius: 5px;
      background: var(--bg); color: #fff; display: flex; align-items: center; justify-content: center;
    }
    .subtask-row .check.done { background: var(--accent); border-color: var(--accent); }
    .subtask-row .title { flex: 1; min-width: 0; font-size: 13px; color: var(--text); }
    .subtask-row .title.done { text-decoration: line-through; color: var(--text-muted); }
    .subtask-row .remove { border: none; background: none; padding: 4px; border-radius: 4px; color: var(--text-muted); display: flex; opacity: 0; }
    .subtask-row:hover .remove { opacity: 1; }
    .subtask-row .remove:hover { background: var(--bg); color: var(--danger, #dc2626); }

    @media (max-width: 900px) {
      .cols { grid-template-columns: 1fr !important; gap: 28px; }
    }

    @media (max-width: 560px) {
      .foco-header { padding: 20px 16px 16px; }
      .other-running { padding: 0 16px 12px; }
      .layout-settings { margin: 0 16px 12px; }
      .title-block h1 { font-size: 24px; }
      .timer { font-size: 22px; }
      .content { padding: 8px 16px 24px; }
    }
  `],
})
export class TasksFocoPageComponent implements OnInit, OnDestroy {
  readonly formatDuration = formatDuration;
  readonly activityDurationSeconds = activityDurationSeconds;
  readonly totalTimeSpent = totalTimeSpent;

  readonly panelLabels = FOCO_PANEL_LABELS;
  readonly columnLabels = FOCO_COLUMN_LABELS;
  readonly columns = FOCO_COLUMNS;

  newSubtaskTitle = '';
  showLayoutSettings = false;
  dragIndex: number | null = null;
  dragOverIndex: number | null = null;


  private activityIdSignal = signal('');
  private readonly baseTitle = document.title;
  private nowTick = signal(Date.now());
  private tickInterval?: ReturnType<typeof setInterval>;

  activity = computed(() => this.activitiesService.activities().find((a) => a.id === this.activityIdSignal()) ?? null);
  task = computed(() => {
    const act = this.activity();
    if (!act?.taskId) return null;
    return this.store.tasks().find((t) => t.id === act.taskId) ?? null;
  });

  otherRunning = computed(() => this.activitiesService.runningAll().filter((a) => a.id !== this.activityIdSignal()));

  /** Título da aba do navegador, com o máximo de informação útil sobre o foco atual. */
  pageTitle = computed(() => {
    const act = this.activity();
    if (!act) return 'Foco · Tarefas';

    const parts: string[] = [];
    if (act.endedAt) {
      parts.push(`✔ ${formatDuration(activityDurationSeconds(act))}`);
      parts.push(act.name);
    } else {
      this.nowTick();
      parts.push(`▶ ${formatDuration(activityDurationSeconds(act))}`);
      parts.push(act.name);

      if (this.pomodoro.running() || this.pomodoro.secondsLeft() < this.pomodoro.phaseTotalSeconds()) {
        const phase = this.pomodoro.phase() === 'work' ? 'foco' : 'pausa';
        const state = this.pomodoro.running() ? '' : ' pausado';
        parts.push(`🍅 ${this.pomodoro.formatTime(this.pomodoro.secondsLeft())} ${phase}${state}`);
      }
    }

    const t = this.task();
    if (t) {
      parts.push(t.title);
      if (t.subtasks.length > 0) parts.push(`✓ ${this.completedSubtasks(t)}/${t.subtasks.length}`);
      if (t.dueDate) parts.push(`${this.isOverdue(t) ? '⚠ atrasada' : 'vence'} ${this.formatDueDate(t.dueDate)}`);
      if (!isNotesEmpty(t.notes)) parts.push('📝');
    }

    const others = this.otherRunning().length;
    if (others > 0) parts.push(`+${others} em andamento`);

    return parts.join(' · ');
  });

  tintColor = computed(() => {
    const t = this.task();
    if (!t) return null;
    return this.store.categoriesFor(t)[0]?.colorHex ?? PRIORITY_TINT[t.priority];
  });

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public activitiesService: TaskActivitiesService,
    public pomodoro: PomodoroService,
    public store: TasksStoreService,
    public layout: FocoLayoutService,
    private title: Title,
  ) {
    effect(() => this.title.setTitle(this.pageTitle()));
  }

  async ngOnInit(): Promise<void> {
    this.activityIdSignal.set(this.route.snapshot.paramMap.get('activityId') ?? '');
    this.route.paramMap.subscribe((params) => {
      const id = params.get('activityId') ?? '';
      this.activityIdSignal.set(id);
      const current = this.activitiesService.activities().find((a) => a.id === id);
      if (current?.taskId) this.pomodoro.setSelectedTask(current.taskId);
    });
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
    this.title.setTitle(this.baseTitle);
  }

  openActivity(id: string): void {
    this.router.navigate(['/tasks/foco', id]);
  }

  elapsedLabel(activity: TaskActivity): string {
    this.nowTick();
    return formatDuration(activityDurationSeconds(activity));
  }

  finishActivity(id: string): void {
    this.activitiesService.finish(id);
    this.router.navigateByUrl('/tasks');
  }

  isOverdue(task: TaskItem): boolean {
    return !!task.dueDate && !task.isCompleted && new Date(task.dueDate).getTime() < Date.now();
  }

  formatDueDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
      (d.getHours() || d.getMinutes() ? ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
  }

  completedSubtasks(task: TaskItem): number {
    return task.subtasks.filter((s) => s.isCompleted).length;
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

  /** Larguras das áreas visíveis: as laterais ficam estreitas e a central (quando existe) manda no
   * resto. Durante o arrasto todas aparecem, pra servirem de alvo. */
  /** Só aparecem na tela as áreas com painel e não ocultadas nas configurações. */
  isColumnVisible(column: FocoColumn): boolean {
    return this.layout.panelsIn(column).length > 0 && !this.layout.isColumnCollapsed(column);
  }

  gridTemplate(): string {
    const visible = this.columns.filter((c) => this.isColumnVisible(c));
    if (visible.length === 0) return 'minmax(0, 1fr)';
    const hasCenter = visible.includes('center');
    return visible.map((c) => (c === 'center' || !hasCenter ? 'minmax(0, 1fr)' : 'minmax(0, 320px)')).join(' ');
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
