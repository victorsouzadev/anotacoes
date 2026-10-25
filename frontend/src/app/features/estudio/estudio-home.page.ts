import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/icon';
import { AppEstudio, CRAFTS, FERRAMENTAS, IAS } from './apps';
import { EstudioService } from './estudio.service';
import { EstudioConfig, Job, dolares } from './estudio.models';
import { ESTUDIO_CSS } from './shared/estilos';
import { MidiaCardComponent } from './shared/midia';

interface Secao {
  titulo: string;
  texto: string;
  apps: AppEstudio[];
}

/** Tela inicial do Estúdio: a grade com os craft apps, as gerações por IA e as ferramentas. */
@Component({
  selector: 'app-estudio-home',
  standalone: true,
  imports: [RouterLink, IconComponent, MidiaCardComponent],
  template: `
    <div class="eh">
      <div class="eh-topo">
        <div>
          <h1 class="e-titulo">Estúdio</h1>
          <p class="e-sub">Os 13 craft apps do ArtCraft, geração por IA no fal.ai e as ferramentas de imagem do hub, com uma biblioteca só.</p>
        </div>
        <input class="e-input eh-busca" type="search" placeholder="Buscar app…" [value]="busca()" (input)="busca.set($any($event.target).value)" />
      </div>

      @if (config(); as c) {
        @if (!c.falConfigurada) {
          <a class="eh-aviso e-card" routerLink="/estudio/configuracoes">
            <app-icon name="sparkles" [size]="16" />
            <span>Para gerar com IA, cadastre sua chave do fal.ai em <strong>Configurações</strong>. Os craft apps funcionam sem chave.</span>
          </a>
        } @else {
          <p class="eh-gasto e-muted">Gasto estimado este mês: <strong>{{ dolar(c.gastoMesCentavos) }}</strong>{{ c.limiteMensalCentavos != null ? ' de ' + dolar(c.limiteMensalCentavos) : '' }} · {{ c.geracoesNoMes }} gerações</p>
        }
      }

      @if (recentes().length) {
        <section class="eh-sec">
          <h2>Recentes</h2>
          <div class="eh-recentes">
            @for (m of recentes(); track m.id) {
              <a [routerLink]="'/estudio/biblioteca'" [queryParams]="{ m: m.id }" class="eh-rec"><e-midia-card [midia]="m" /></a>
            }
          </div>
        </section>
      }

      @for (s of secoes(); track s.titulo) {
        @if (s.apps.length) {
          <section class="eh-sec">
            <h2>{{ s.titulo }}</h2>
            <p class="e-muted eh-texto">{{ s.texto }}</p>
            <div class="eh-grade">
              @for (a of s.apps; track a.id) {
                <a class="eh-app e-card" [routerLink]="rota(a)" [queryParams]="query(a)">
                  <span class="eh-icone"><app-icon [name]="a.icone" [size]="20" /></span>
                  <span class="eh-nome">{{ a.nome }} @if (a.selo) { <span class="e-tag">{{ a.selo }}</span> }</span>
                  <span class="eh-subt">{{ a.subtitulo }}</span>
                  <span class="eh-desc">{{ a.descricao }}</span>
                </a>
              }
            </div>
          </section>
        }
      }
      <p class="e-muted eh-credito">Craft apps © ArtCraft Team e colaboradores, licença MIT ou Apache-2.0 (github.com/storytold). Os nomes são marcas do ArtCraft.</p>
    </div>
  `,
  styles: [ESTUDIO_CSS, `
    .eh { max-width: 1180px; margin: 0 auto; padding: 28px 20px 48px; }
    .eh-topo { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
    .eh-busca { max-width: 260px; }
    .eh-aviso { display: flex; align-items: center; gap: 10px; padding: 12px 14px; text-decoration: none; color: inherit; margin-bottom: 8px; border-color: var(--accent); }
    .eh-gasto { font-size: 13px; margin: 0 0 8px; }
    .eh-sec { margin-top: 26px; }
    .eh-sec h2 { font-size: 15px; margin: 0; }
    .eh-texto { font-size: 13px; margin: 4px 0 12px; }
    .eh-grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
    .eh-app { display: flex; flex-direction: column; gap: 4px; padding: 16px; text-decoration: none; color: inherit; transition: border-color .12s, transform .12s; }
    .eh-app:hover { border-color: var(--accent); transform: translateY(-2px); }
    .eh-icone { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent-dark); margin-bottom: 6px; }
    .eh-nome { font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .eh-subt { font-size: 12px; font-weight: 600; color: var(--text-muted); }
    .eh-desc { font-size: 12.5px; color: var(--text-muted); line-height: 1.4; margin-top: 4px; }
    .eh-recentes { display: grid; grid-auto-flow: column; grid-auto-columns: 120px; gap: 10px; overflow-x: auto; padding-top: 10px; }
    .eh-rec { text-decoration: none; color: inherit; }
    .eh-credito { font-size: 11px; margin-top: 36px; }
  `],
})
export class EstudioHomePageComponent {
  private readonly api = inject(EstudioService);
  readonly busca = signal('');
  readonly config = signal<EstudioConfig | null>(null);
  readonly recentes = signal<Job['resultado']>([]);
  readonly dolar = dolares;

  readonly secoes = computed<Secao[]>(() => {
    const q = this.busca().trim().toLowerCase();
    const f = (l: AppEstudio[]) => q ? l.filter((a) => `${a.nome} ${a.subtitulo} ${a.descricao}`.toLowerCase().includes(q)) : l;
    return [
      { titulo: 'Craft apps', texto: 'Programas completos que rodam no navegador (e no desktop), abrindo e salvando direto na biblioteca.', apps: f(CRAFTS) },
      { titulo: 'Criar com IA', texto: 'Gerações no fal.ai, com o custo estimado antes de gerar.', apps: f(IAS) },
      { titulo: 'Ferramentas', texto: 'Telas para montar cenas, planejar e editar.', apps: f(FERRAMENTAS) },
    ];
  });

  constructor() {
    void this.api.config().then((c) => this.config.set(c), () => undefined);
    void this.api.midias({ limite: 12 }).then((m) => this.recentes.set(m), () => undefined);
  }

  rota(a: AppEstudio): string {
    return a.rota.split('?')[0];
  }

  query(a: AppEstudio): Record<string, string> | null {
    const q = a.rota.split('?')[1];
    return q ? Object.fromEntries(new URLSearchParams(q)) : null;
  }
}
