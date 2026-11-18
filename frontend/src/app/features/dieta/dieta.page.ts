import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/icon';
import { AssistenteComponent } from './assistente/assistente.component';
import { CompartilharComponent } from './compartilhar/compartilhar.component';
import { DiaComponent } from './dia/dia.component';
import { PerfilComponent } from './perfil/perfil.component';
import { ProgressoComponent } from './progresso/progresso.component';

type Aba = 'dia' | 'progresso' | 'perfil' | 'compartilhar' | 'assistente';

/** Tela web da Dieta (spec 016). O app Android continua sendo o caminho principal (offline). */
@Component({
  selector: 'app-dieta-page',
  standalone: true,
  imports: [RouterLink, IconComponent, DiaComponent, ProgressoComponent, PerfilComponent, CompartilharComponent, AssistenteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header>
        <a routerLink="/" class="voltar" title="Voltar ao início"><app-icon name="grid" [size]="16" /></a>
        <h1><span class="marca"><app-icon name="apple" [size]="14" /></span> Dieta</h1>
        <a class="apk" href="/downloads/android/Dieta.apk" download>
          <app-icon name="download" [size]="13" /> App Android
        </a>
      </header>
      <nav class="abas" role="tablist">
        @for (a of abas; track a.id) {
          <button role="tab" [class.ativa]="aba() === a.id" [attr.aria-selected]="aba() === a.id" (click)="aba.set(a.id)">{{ a.nome }}</button>
        }
      </nav>
      <main>
        @switch (aba()) {
          @case ('dia') { <app-dieta-dia /> }
          @case ('progresso') { <app-dieta-progresso /> }
          @case ('perfil') { <app-dieta-perfil /> }
          @case ('compartilhar') { <app-dieta-compartilhar /> }
          @case ('assistente') { <app-dieta-assistente /> }
        }
      </main>
    </div>
  `,
  styles: [`
    .page { min-height: 100dvh; background: var(--bg); }
    header { display: flex; align-items: center; gap: 12px; padding: 14px 20px; background: var(--surface); border-bottom: 1px solid var(--border); }
    h1 { font-size: 16px; margin: 0; display: flex; align-items: center; gap: 8px; flex: 1; }
    .marca { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 8px; background: var(--accent); color: var(--accent-contrast); }
    .voltar { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-muted); }
    .apk { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--text-muted); text-decoration: none; }
    .abas { display: flex; gap: 4px; padding: 10px 20px 0; max-width: 900px; margin: 0 auto; overflow-x: auto; }
    .abas button { border: none; background: none; padding: 8px 12px; border-radius: var(--radius-sm); font-size: 13.5px; font-weight: 600; color: var(--text-muted); white-space: nowrap; }
    .abas button.ativa { background: var(--accent-soft); color: var(--accent-dark); }
    main { max-width: 900px; margin: 0 auto; padding: 14px 20px 40px; }
    @media (max-width: 600px) { header { padding: 10px 16px; } .abas, main { padding-left: 16px; padding-right: 16px; } }
  `],
})
export class DietaPageComponent {
  readonly abas: { id: Aba; nome: string }[] = [
    { id: 'dia', nome: 'Dia' },
    { id: 'progresso', nome: 'Progresso' },
    { id: 'perfil', nome: 'Perfil e plano' },
    { id: 'compartilhar', nome: 'Compartilhar' },
    { id: 'assistente', nome: 'Assistente' },
  ];
  readonly aba = signal<Aba>('dia');
}
