import { Component, Input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import { ThemeService } from '../../../core/theme.service';
import { IconComponent, IconName } from '../../../shared/icon';

@Component({
  selector: 'app-tasks-top-bar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  template: `
    <header class="top-bar">
      <div class="brand">
        <a class="hub-link" routerLink="/" title="Voltar ao início"><app-icon name="grid" [size]="16" /></a>
        <h1><span class="brand-mark"><app-icon name="checklist" [size]="14" /></span> Tarefas</h1>
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
    .tabs { display: flex; gap: 4px; flex: 1; flex-wrap: wrap; }
    .tabs a {
      padding: 7px 12px;
      border-radius: var(--radius-sm);
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      text-decoration: none;
    }
    .tabs a:hover { background: var(--bg); color: var(--text); }
    .tabs a.active { background: var(--accent-soft); color: var(--accent-dark); }
    .top-bar-actions { display: flex; align-items: center; gap: 14px; margin-left: auto; }
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
  `],
})
export class TasksTopBarComponent {
  @Input() showActions = true;

  constructor(public auth: AuthService, public theme: ThemeService) {}

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
}
