import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { IconComponent, IconName } from '../../shared/icon';

interface ToolCard {
  path: string;
  icon: IconName;
  title: string;
  description: string;
  downloadUrl?: string;
  downloadFileName?: string;
  downloadLabel?: string;
}

const TOOLS: ToolCard[] = [
  { path: '/notes', icon: 'pen', title: 'Notas', description: 'Notas manuscritas, texto, desenho e checklists num canvas por página.' },
  { path: '/financas', icon: 'wallet', title: 'Finanças', description: 'Lançamentos financeiros a partir de texto livre, com dashboard de receitas e despesas.' },
  {
    path: '/tasks',
    icon: 'checklist',
    title: 'Tarefas',
    description: 'Tarefas com subtarefas, categorias, prioridade, recorrência, pomodoro e estatísticas — sincronizadas com o app Android.',
    downloadUrl: '/downloads/organizador.apk',
    downloadFileName: 'organizador.apk',
    downloadLabel: 'Baixar app Android (.apk)',
  },
  {
    path: '/bolo-3d',
    icon: 'cake',
    title: 'Simulador de Bolo 3D',
    description: 'Monte um bolo em 3D: camadas, sabores, cobertura, granulado, cerejas e velas para acender.',
  },
];

@Component({
  selector: 'app-hub-page',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="page">
      <header class="top-bar">
        <h1><span class="brand-mark"><app-icon name="grid" [size]="14" /></span> Ferramentas</h1>
        <div class="top-bar-actions">
          <button class="theme-toggle" (click)="theme.cycle()" [title]="themeLabel()"><app-icon [name]="themeIconName()" [size]="16" /></button>
          <span class="user-email">{{ auth.user()?.email }}</span>
          <button class="logout" (click)="auth.logout()"><app-icon name="logout" [size]="14" /> Sair</button>
        </div>
      </header>

      <main class="content">
        <div class="grid">
          @for (tool of tools; track tool.path) {
            <div class="tool-card-wrapper">
              <a class="tool-card" [routerLink]="tool.path">
                <span class="tool-icon"><app-icon [name]="tool.icon" [size]="22" /></span>
                <span class="tool-title">{{ tool.title }}</span>
                <span class="tool-description">{{ tool.description }}</span>
              </a>
              @if (tool.downloadUrl) {
                <a class="tool-download" [href]="tool.downloadUrl" [attr.download]="tool.downloadFileName">
                  <app-icon name="download" [size]="13" /> {{ tool.downloadLabel }}
                </a>
              }
            </div>
          }
        </div>
      </main>
    </div>
  `,
  styles: [`
    .page { min-height: 100dvh; background: var(--bg); }
    .top-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 28px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }
    .top-bar h1 { font-size: 16px; margin: 0; display: flex; align-items: center; gap: 8px; letter-spacing: -0.01em; }
    .brand-mark {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 8px;
      background: var(--accent); color: #fff;
      flex-shrink: 0;
    }
    .top-bar-actions { display: flex; align-items: center; gap: 14px; }
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

    .content { max-width: 900px; margin: 0 auto; padding: 48px 28px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 18px; align-items: start; }
    .tool-card-wrapper { display: flex; flex-direction: column; gap: 8px; }
    .tool-card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 24px;
      text-decoration: none;
      color: inherit;
      box-shadow: var(--shadow-sm);
      transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
    }
    .tool-card:hover { transform: translateY(-3px); box-shadow: var(--shadow); border-color: var(--accent); }
    .tool-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 44px; height: 44px; border-radius: var(--radius);
      background: var(--accent-soft); color: var(--accent-dark);
    }
    .tool-title { font-size: 16px; font-weight: 700; }
    .tool-description { font-size: 13px; color: var(--text-muted); line-height: 1.4; }
    .tool-download {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
    }
    .tool-download:hover { border-color: var(--accent); color: var(--accent); }

    @media (max-width: 760px) {
      .top-bar { padding: 12px 16px; }
      .user-email { display: none; }
      .content { padding: 28px 16px; }
    }
  `],
})
export class HubPageComponent {
  tools = TOOLS;

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
