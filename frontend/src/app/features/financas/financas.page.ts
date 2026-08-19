import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { IconComponent, IconName } from '../../shared/icon';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { LancamentoFormComponent } from './components/lancamento-form/lancamento-form.component';
import { TransacoesListaComponent } from './components/transacoes-lista/transacoes-lista.component';
import { CategoriaResumo, ResumoResponse, TendenciaPeriodo } from './models/dashboard.model';
import { Transacao } from './models/transacao.model';
import { DashboardService } from './services/dashboard.service';
import { TransacaoService } from './services/transacao.service';

@Component({
  selector: 'app-financas-page',
  standalone: true,
  imports: [
    RouterLink,
    IconComponent,
    LancamentoFormComponent,
    DashboardComponent,
    TransacoesListaComponent,
  ],
  template: `
    <div class="page">
      <header class="top-bar">
        <div class="brand">
          <a class="hub-link" routerLink="/" title="Voltar ao início"><app-icon name="grid" [size]="16" /></a>
          <h1><span class="brand-mark"><app-icon name="wallet" [size]="14" /></span> Finanças</h1>
        </div>
        <div class="top-bar-actions">
          <button class="theme-toggle" (click)="theme.cycle()" [title]="themeLabel()"><app-icon [name]="themeIconName()" [size]="16" /></button>
          <span class="user-email">{{ auth.user()?.email }}</span>
          <button class="logout" (click)="auth.logout()"><app-icon name="logout" [size]="14" /> Sair</button>
        </div>
      </header>

      <main class="content">
        <app-lancamento-form (lancamentoCriado)="onLancamentoCriado()" />

        @if (carregando) {
          <p class="carregando">Carregando...</p>
        } @else {
          <app-financas-dashboard [resumo]="resumo" [categorias]="categorias" [tendencias]="tendencias" />
          <app-transacoes-lista [transacoes]="transacoes" />
        }
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
    .content { max-width: 1080px; margin: 0 auto; padding: 24px 28px; }
    .carregando { color: var(--text-muted); text-align: center; padding: 2rem 0; }

    @media (max-width: 760px) {
      .top-bar { padding: 12px 16px; flex-wrap: wrap; }
      .user-email { display: none; }
      .content { padding: 16px; }
    }
  `],
})
export class FinancasPageComponent implements OnInit {
  transacoes: Transacao[] = [];
  resumo: ResumoResponse | null = null;
  categorias: CategoriaResumo[] = [];
  tendencias: TendenciaPeriodo[] = [];
  carregando = true;

  constructor(
    private readonly transacaoService: TransacaoService,
    private readonly dashboardService: DashboardService,
    public auth: AuthService,
    public theme: ThemeService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.carregarTudo();
  }

  onLancamentoCriado(): void {
    this.carregarTudo();
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

  private carregarTudo(): void {
    this.carregando = true;
    forkJoin({
      transacoes: this.transacaoService.listar(),
      resumo: this.dashboardService.resumo(),
      categorias: this.dashboardService.categorias(),
      tendencias: this.dashboardService.tendencias(),
    }).subscribe({
      next: ({ transacoes, resumo, categorias, tendencias }) => {
        this.transacoes = transacoes;
        this.resumo = resumo;
        this.categorias = categorias;
        this.tendencias = tendencias;
        this.carregando = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.carregando = false;
        this.cdr.markForCheck();
      },
    });
  }
}
