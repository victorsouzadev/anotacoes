import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import { ThemeService } from '../../../core/theme.service';
import { IconComponent, IconName } from '../../../shared/icon';
import { TasksStoreService } from '../services/tasks-store.service';
import { PomodoroService } from '../services/pomodoro.service';
import { TaskActivitiesService } from '../services/task-activities.service';
import { TaskActivity, activityDurationSeconds } from '../models/task.model';

@Component({
  selector: 'app-tasks-top-bar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive, IconComponent],
  template: `
    <header class="top-bar">
      <div class="brand">
        <a class="hub-link" routerLink="/" title="Voltar ao início"><app-icon name="grid" [size]="16" /></a>
        <h1><span class="brand-mark"><app-icon name="checklist" [size]="14" /></span><span class="brand-text">Tarefas</span></h1>
      </div>
      <nav class="tabs">
        <a routerLink="/tasks" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Lista</a>
        <a routerLink="/tasks/kanban" routerLinkActive="active">Kanban</a>
        <a routerLink="/tasks/calendario" routerLinkActive="active">Calendário</a>
        <a routerLink="/tasks/categorias" routerLinkActive="active">Categorias</a>
        <a routerLink="/tasks/pomodoro" routerLinkActive="active">Pomodoro</a>
        <a routerLink="/tasks/estatisticas" routerLinkActive="active">Estatísticas</a>
        <a routerLink="/tasks/lixeira" routerLinkActive="active">Lixeira</a>
      </nav>
      <div class="top-bar-actions">
        @if (pomodoro.running()) {
          <a class="pomodoro-badge" [class.break]="pomodoro.phase() === 'break'" routerLink="/tasks/pomodoro" title="Pomodoro em andamento">
            <app-icon name="pomodoro" [size]="13" />
            {{ pomodoro.formatTime(pomodoro.secondsLeft()) }}
          </a>
        }

        <div class="activity-menu">
          @if (activities.running(); as running) {
            <button class="activity-toggle running" (click)="finishActivity()" title="Finalizar atividade">
              <app-icon name="pomodoro" [size]="13" />
              {{ running.name }} · {{ elapsedLabel(running) }}
            </button>
          } @else {
            <button class="activity-toggle" (click)="showActivityForm = !showActivityForm" title="Iniciar atividade">
              <app-icon name="plus" [size]="13" /> Atividade
            </button>
          }
          @if (showActivityForm && !activities.running()) {
            <div class="activity-panel" (click)="$event.stopPropagation()">
              <input [(ngModel)]="activityName" placeholder="Nome da atividade" (keydown.enter)="startActivity()" autofocus />
              <select [(ngModel)]="activityTaskId">
                <option [ngValue]="null">Sem tarefa vinculada</option>
                @for (t of store.activeTasks(); track t.id) {
                  <option [ngValue]="t.id">{{ t.title }}</option>
                }
              </select>
              <button class="primary" (click)="startActivity()">Iniciar</button>
            </div>
          }
        </div>

        <a class="theme-toggle" routerLink="/tasks/ajuda" routerLinkActive="active" title="Ajuda"><app-icon name="help" [size]="16" /></a>
        <button class="theme-toggle" (click)="theme.cycle()" [title]="themeLabel()"><app-icon [name]="themeIconName()" [size]="16" /></button>
        <span class="user-email">{{ auth.user()?.email }}</span>
        <button class="logout" (click)="auth.logout()"><app-icon name="logout" [size]="14" /> Sair</button>
      </div>
    </header>
  `,
  styles: [`
    .top-bar {
      display: flex;
      align-items: center;
      gap: 20px;
      padding: 14px 28px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .hub-link {
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      text-decoration: none;
    }
    .hub-link:hover { border-color: var(--accent); color: var(--accent); }
    .top-bar h1 { font-size: 16px; margin: 0; display: flex; align-items: center; gap: 8px; letter-spacing: -0.01em; }
    .brand-mark {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 8px;
      background: var(--accent); color: #fff;
      flex-shrink: 0;
    }
    .tabs { display: flex; gap: 4px; flex: 1; flex-wrap: wrap; min-width: 0; }
    .tabs a {
      padding: 7px 12px;
      border-radius: var(--radius-sm);
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      text-decoration: none;
      white-space: nowrap;
    }
    .tabs a:hover { background: var(--bg); color: var(--text); }
    .tabs a.active { background: var(--accent-soft); color: var(--accent-dark); }
    .top-bar-actions { display: flex; align-items: center; gap: 14px; margin-left: auto; }

    .pomodoro-badge {
      display: flex; align-items: center; gap: 6px;
      border: 1px solid var(--accent);
      background: var(--accent-soft);
      color: var(--accent-dark);
      border-radius: var(--radius-sm);
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      text-decoration: none;
      white-space: nowrap;
    }
    .pomodoro-badge.break { background: var(--bg); border-color: var(--border); color: var(--text-muted); }

    .activity-menu { position: relative; }
    .activity-toggle {
      display: flex; align-items: center; gap: 6px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-muted);
      border-radius: var(--radius-sm);
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }
    .activity-toggle:hover { border-color: var(--accent); color: var(--accent); }
    .activity-toggle.running { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-dark); font-variant-numeric: tabular-nums; }

    .activity-panel {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      width: 220px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-lg);
      padding: 10px;
      z-index: 20;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .activity-panel input, .activity-panel select {
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 7px 8px;
      background: var(--bg);
      color: var(--text);
      font-size: 13px;
    }
    .activity-panel .primary {
      border: none;
      background: var(--accent);
      color: #fff;
      border-radius: var(--radius-sm);
      padding: 8px;
      font-size: 13px;
      font-weight: 600;
    }
    .activity-panel .primary:hover { background: var(--accent-dark); }

    .theme-toggle {
      border: 1px solid var(--border);
      background: var(--bg);
      border-radius: var(--radius-sm);
      width: 32px; height: 32px;
      display: flex; align-items: center; justify-content: center;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .theme-toggle:hover { border-color: var(--accent); color: var(--accent); }
    .user-email { font-size: 12px; color: var(--text-muted); }
    .logout { display: flex; align-items: center; gap: 5px; border: none; background: none; color: var(--text-muted); font-size: 12px; font-weight: 600; }
    .logout:hover { color: var(--danger); }

    @media (max-width: 900px) {
      .top-bar { padding: 12px 16px; }
      .user-email { display: none; }
    }

    @media (max-width: 640px) {
      .top-bar { gap: 10px; }
      .tabs {
        flex: 1 1 100%;
        flex-wrap: nowrap;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        order: 3;
        padding-bottom: 2px;
      }
      .tabs::-webkit-scrollbar { display: none; }
      .tabs a { flex-shrink: 0; }
      .top-bar-actions { gap: 8px; }
    }
  `],
})
export class TasksTopBarComponent implements OnInit, OnDestroy {
  @Input() showActions = true;

  showActivityForm = false;
  activityName = '';
  activityTaskId: string | null = null;

  /** Só serve pra forçar recomputo do rótulo de tempo decorrido a cada segundo. */
  private nowTick = signal(Date.now());
  private tickInterval?: ReturnType<typeof setInterval>;

  constructor(
    public auth: AuthService,
    public theme: ThemeService,
    public store: TasksStoreService,
    public pomodoro: PomodoroService,
    public activities: TaskActivitiesService,
  ) {}

  ngOnInit(): void {
    this.tickInterval = setInterval(() => this.nowTick.set(Date.now()), 1000);
  }

  ngOnDestroy(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  themeIconName(): IconName {
    switch (this.theme.pref()) {
      case 'dark': return 'moon';
      case 'light': return 'sun';
      default: return 'monitor';
    }
  }

  themeLabel(): string {
    switch (this.theme.pref()) {
      case 'dark': return 'Tema: escuro (clique para claro)';
      case 'light': return 'Tema: claro (clique para automático)';
      default: return 'Tema: automático (clique para escuro)';
    }
  }

  elapsedLabel(activity: TaskActivity): string {
    this.nowTick();
    const seconds = activityDurationSeconds(activity);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  startActivity(): void {
    if (!this.activityName.trim()) return;
    this.activities.start(this.activityName, this.activityTaskId);
    this.activityName = '';
    this.activityTaskId = null;
    this.showActivityForm = false;
  }

  finishActivity(): void {
    const running = this.activities.running();
    if (running) this.activities.finish(running.id);
  }
}
