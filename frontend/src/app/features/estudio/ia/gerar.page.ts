import { Component, OnInit, ViewChild, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IconComponent } from '../../../shared/icon';
import { AppIa, craftsQueAbrem, ia } from '../apps';
import { EstudioService } from '../estudio.service';
import { Midia } from '../estudio.models';
import { ESTUDIO_CSS } from '../shared/estilos';
import { FormGeracaoComponent } from '../shared/form-geracao';
import { HistoricoGeracoes } from '../shared/historico';
import { JobCardComponent } from '../shared/job-card';
import { MidiaVisorComponent } from '../shared/midia';

/** Tela de uma ferramenta de IA (/estudio/ia/:app): formulário do catálogo + histórico. */
@Component({
  selector: 'app-estudio-gerar',
  standalone: true,
  imports: [IconComponent, RouterLink, FormGeracaoComponent, JobCardComponent, MidiaVisorComponent],
  template: `
    @if (app(); as a) {
      <div class="gp">
        <section class="gp-form e-card">
          <h1 class="e-titulo">{{ a.nome }}</h1>
          <p class="e-sub">{{ a.descricao }}</p>
          @if (pronto()) {
            <e-form-geracao #form [config]="a" [entradasIniciais]="iniciais()" [opInicial]="opInicial" (gerado)="historico.adicionar($event)" />
          }
        </section>
        <section class="gp-hist">
          <h2>Gerações</h2>
          @for (j of historico.jobs(); track j.id) {
            <e-job-card [job]="j" (abrir)="visor.set($event)" (cancelar)="historico.cancelar($event)" (repetir)="form?.preencher($event)" (ocultar)="historico.ocultar($event)" />
          } @empty {
            <p class="e-vazio">{{ historico.carregando() ? 'Carregando…' : 'O que você gerar aqui aparece nesta coluna e na Biblioteca.' }}</p>
          }
        </section>
      </div>
    } @else {
      <p class="e-vazio">Ferramenta não encontrada. <a routerLink="/estudio">Voltar ao Estúdio</a></p>
    }

    @if (visor(); as m) {
      <div class="gp-modal" (click)="visor.set(null)">
        <div class="gp-modal-caixa e-card" (click)="$event.stopPropagation()">
          <div class="gp-modal-topo">
            <strong>{{ m.nome }}</strong>
            <button type="button" class="e-ib" (click)="visor.set(null)" aria-label="Fechar"><app-icon name="x" [size]="15" /></button>
          </div>
          <e-midia-visor [midia]="m" />
          <div class="gp-modal-acoes">
            <a class="e-btn e-sm" [href]="m.url" [attr.download]="m.nome"><app-icon name="download" [size]="13" /> Baixar</a>
            <a class="e-btn e-sm" routerLink="/estudio/biblioteca" [queryParams]="{ m: m.id }"><app-icon name="folder" [size]="13" /> Na biblioteca</a>
            <button type="button" class="e-btn e-sm" (click)="usarAqui(m)"><app-icon name="plus" [size]="13" /> Usar como entrada</button>
            @for (c of craftsDe(m); track c.id) {
              <a class="e-btn e-sm" [routerLink]="c.rota" [queryParams]="{ abrir: m.id }"><app-icon [name]="c.icone" [size]="13" /> {{ c.nome }}</a>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [ESTUDIO_CSS, `
    .gp { display: grid; grid-template-columns: minmax(320px, 420px) 1fr; gap: 18px; padding: 20px; align-items: start; max-width: 1400px; margin: 0 auto; }
    .gp-form { padding: 18px; display: flex; flex-direction: column; gap: 14px; position: sticky; top: 0; max-height: calc(100dvh - 90px); overflow: auto; }
    .gp-hist { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .gp-hist h2 { font-size: 15px; margin: 0; }
    .gp-modal { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; padding: 16px; }
    .gp-modal-caixa { width: min(960px, 100%); max-height: 92vh; overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
    .gp-modal-topo { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .gp-modal-acoes { display: flex; flex-wrap: wrap; gap: 6px; }
    @media (max-width: 860px) { .gp { grid-template-columns: 1fr; } .gp-form { position: static; max-height: none; } }
  `],
})
export class GerarPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(EstudioService);
  @ViewChild('form') form?: FormGeracaoComponent;

  readonly app = signal<AppIa | null>(null);
  readonly iniciais = signal<Record<string, Midia[]>>({});
  readonly pronto = signal(false);
  readonly visor = signal<Midia | null>(null);
  historico!: HistoricoGeracoes;
  opInicial: string | null = null;

  constructor() {
    const id = this.route.snapshot.paramMap.get('app') ?? '';
    this.app.set(ia(id) ?? null);
    this.historico = new HistoricoGeracoes(id);
    this.opInicial = this.route.snapshot.queryParamMap.get('op');
  }

  async ngOnInit(): Promise<void> {
    void this.historico.carregar();
    const entrada = this.route.snapshot.queryParamMap.get('entrada');
    if (entrada) {
      try {
        this.iniciais.set({ entrada: [await this.api.midia(entrada)] });
      } catch { /* arquivo apagado: abre sem entrada */ }
    }
    this.pronto.set(true);
  }

  usarAqui(m: Midia): void {
    this.visor.set(null);
    const f = this.form;
    if (!f) return;
    const destino = f.entradasVisiveis().find((e) => f.tiposDaEntrada(e).includes(m.tipo));
    if (destino) f.escolher(destino, [m]);
  }

  craftsDe(m: Midia) {
    return craftsQueAbrem(m.nome).slice(0, 3);
  }
}
