import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { IconComponent, IconName } from '../../shared/icon';
import { ThemeService } from '../../core/theme.service';
import { isDesktop } from '../../core/desktop';
import { TODOS } from './apps';
import { ESTUDIO_CSS } from './shared/estilos';

/** Barra do Estúdio em volta de todas as telas dele (menos o Editor de Imagens, que tem a própria). */
@Component({
  selector: 'app-estudio-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, IconComponent],
  template: `
    <div class="sh">
      <header class="sh-barra">
        @if (!desktop) { <a class="e-ib" routerLink="/" title="Ferramentas do hub" aria-label="Ferramentas do hub"><app-icon name="grid" [size]="15" /></a> }
        <a class="sh-marca" routerLink="/estudio"><span class="sh-logo"><app-icon name="sparkles" [size]="13" /></span> Estúdio</a>
        @if (atual(); as a) {
          <span class="sh-sep">/</span>
          <span class="sh-app"><app-icon [name]="a.icone" [size]="14" /> {{ a.nome }}</span>
        }
        <span class="sh-espaco"></span>
        <a class="e-btn e-sm" routerLink="/estudio/biblioteca"><app-icon name="folder" [size]="14" /> <span class="sh-rot">Biblioteca</span></a>
        <a class="e-ib" routerLink="/estudio/configuracoes" title="Chaves e teto de gasto" aria-label="Configurações do Estúdio"><app-icon name="settings" [size]="15" /></a>
        <button type="button" class="e-ib" (click)="theme.cycle()" [title]="'Tema'" aria-label="Trocar tema"><app-icon [name]="iconeTema()" [size]="15" /></button>
      </header>
      <main class="sh-corpo"><router-outlet /></main>
    </div>
  `,
  styles: [ESTUDIO_CSS, `
    .sh { height: 100dvh; display: flex; flex-direction: column; background: var(--bg); }
    .sh-barra { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; height: 50px; padding: 0 14px; background: var(--surface); border-bottom: 1px solid var(--border); }
    .sh-marca { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--text); text-decoration: none; font-size: 15px; }
    .sh-logo { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 7px; background: var(--accent); color: var(--accent-contrast); }
    .sh-sep { color: var(--text-muted); }
    .sh-app { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sh-espaco { flex: 1; }
    .sh-corpo { flex: 1; min-height: 0; overflow: auto; position: relative; }
    @media (max-width: 600px) { .sh-rot { display: none; } }
  `],
})
export class EstudioShellComponent {
  readonly theme = inject(ThemeService);
  readonly desktop = isDesktop();
  private readonly router = inject(Router);
  private readonly url = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => this.router.url)), { initialValue: this.router.url });
  readonly atual = computed(() => {
    const caminho = this.url().split('?')[0];
    return TODOS.find((a) => a.rota.split('?')[0] === caminho) ?? null;
  });
  readonly tema = signal(0);

  iconeTema(): IconName {
    switch (this.theme.pref()) {
      case 'dark': return 'moon';
      case 'light': return 'sun';
      default: return 'monitor';
    }
  }
}
