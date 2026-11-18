import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import type { Chart } from 'chart.js';
import { mensagemDeErro } from '../../../core/erro-http';
import { opcoesBase, paletaAtual, registrarChartJs } from '../../financas/chart-theme';
import { DietaApiService } from '../dieta-api.service';
import { arred, heatmap, nivelDia } from '../dieta-calc';
import { Progresso } from '../dieta.models';

/** Aba "Progresso" (spec 016): nível, sequências, conquistas, desafio, peso, kcal e heatmap. */
@Component({
  selector: 'app-dieta-progresso',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (erro(); as e) { <p class="erro">{{ e }}</p> }
    @if (p(); as p) {
      <div class="cards">
        <div class="card"><span class="num">Nível {{ p.nivel }}</span><span class="sub">{{ p.xpNoNivel }} / {{ p.xpParaProximo }} XP para o próximo</span>
          <div class="trilho"><div class="cheio" [style.width.%]="p.xpParaProximo ? (p.xpNoNivel / p.xpParaProximo) * 100 : 0"></div></div></div>
        <div class="card"><span class="num">{{ p.sequenciaRegistro }} dias</span><span class="sub">registrando seguidos (melhor: {{ p.melhorSequencia }})</span></div>
        <div class="card"><span class="num">{{ p.sequenciaMeta }} dias</span><span class="sub">na meta seguidos</span></div>
        <div class="card"><span class="num">{{ p.diasRegistrados }}</span><span class="sub">dias registrados · {{ p.xpTotal }} XP</span></div>
      </div>

      <section class="card">
        <h3>Desafio da semana</h3>
        <p>{{ p.desafio.descricao }} — {{ p.desafio.feito }} / {{ p.desafio.alvo }}</p>
        <div class="trilho"><div class="cheio" [style.width.%]="p.desafio.alvo ? (p.desafio.feito / p.desafio.alvo) * 100 : 0"></div></div>
      </section>

      <section class="card">
        <h3>Adesão (12 semanas)</h3>
        <div class="heatmap" role="img" aria-label="Dias registrados e metas batidas nas últimas 12 semanas">
          @for (coluna of mapa(); track $index) {
            <div class="coluna">
              @for (d of coluna; track d.data) {
                <span class="dia" [class.futuro]="d.futuro" [attr.data-nivel]="d.nivel" [title]="d.data + ' · nível ' + d.nivel"></span>
              }
            </div>
          }
        </div>
        <p class="sub">Mais escuro = registrou e bateu mais metas (calorias, proteína, água).</p>
      </section>

      <div class="graficos">
        <section class="card"><h3>Peso</h3><div class="grafico"><canvas #peso></canvas></div></section>
        <section class="card"><h3>Calorias por dia</h3><div class="grafico"><canvas #kcal></canvas></div></section>
      </div>

      <section class="card">
        <h3>Conquistas</h3>
        <ul class="conquistas">
          @for (c of p.conquistas; track c.codigo) {
            <li [class.feita]="!!c.em"><strong>{{ c.nome }}</strong><span>{{ c.descricao }}</span>@if (c.em) { <em>{{ c.em }}</em> }</li>
          }
        </ul>
      </section>
    } @else if (!erro()) {
      <p class="sub">Carregando…</p>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 12px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
    h3 { margin: 0 0 6px; font-size: 15px; }
    p { margin: 0 0 6px; font-size: 13px; }
    .num { font-size: 20px; font-weight: 700; }
    .sub { font-size: 12.5px; color: var(--text-muted); }
    .trilho { height: 8px; background: var(--bg); border-radius: 999px; overflow: hidden; margin-top: 6px; }
    .cheio { height: 100%; background: var(--accent); }
    .heatmap { display: flex; gap: 3px; overflow-x: auto; padding-bottom: 4px; }
    .coluna { display: flex; flex-direction: column; gap: 3px; }
    .dia { width: 14px; height: 14px; border-radius: 3px; background: var(--bg); border: 1px solid var(--border); }
    .dia[data-nivel="1"] { background: color-mix(in srgb, var(--accent) 25%, var(--bg)); }
    .dia[data-nivel="2"] { background: color-mix(in srgb, var(--accent) 50%, var(--bg)); }
    .dia[data-nivel="3"] { background: color-mix(in srgb, var(--accent) 75%, var(--bg)); }
    .dia[data-nivel="4"] { background: var(--accent); }
    .dia.futuro { opacity: .25; }
    .graficos { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
    .grafico { position: relative; height: 220px; }
    .conquistas { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
    .conquistas li { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; font-size: 12.5px; display: flex; flex-direction: column; gap: 2px; opacity: .5; }
    .conquistas li.feita { opacity: 1; border-color: var(--accent); }
    .conquistas span, .conquistas em { color: var(--text-muted); }
    .erro { color: var(--danger); font-size: 13px; }
  `],
})
export class ProgressoComponent implements AfterViewInit, OnDestroy {
  private api = inject(DietaApiService);
  readonly p = signal<Progresso | null>(null);
  readonly erro = signal<string | null>(null);
  readonly mapa = signal<ReturnType<typeof heatmap>>([]);
  readonly arred = arred;

  @ViewChild('peso') pesoRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('kcal') kcalRef?: ElementRef<HTMLCanvasElement>;
  private graficos: Chart[] = [];

  async ngAfterViewInit(): Promise<void> {
    try {
      const p = await this.api.progresso();
      this.p.set(p);
      this.mapa.set(heatmap(p.dias.map((d) => ({ data: d.data, nivel: d.nivel ?? nivelDia(d) }))));
      setTimeout(() => void this.desenhar(p), 0);
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não foi possível carregar o progresso'));
    }
  }

  ngOnDestroy(): void {
    this.graficos.forEach((g) => g.destroy());
  }

  private async desenhar(p: Progresso): Promise<void> {
    await registrarChartJs();
    const { Chart } = await import('chart.js');
    const paleta = paletaAtual();
    const base = opcoesBase<'line'>(paleta);
    const semMoeda = { ...base, plugins: { ...base.plugins, tooltip: {} } };
    if (this.pesoRef) {
      this.graficos.push(new Chart(this.pesoRef.nativeElement, {
        type: 'line',
        data: {
          labels: p.peso.map((x) => x.data.slice(5).split('-').reverse().join('/')),
          datasets: [
            { label: 'Peso (kg)', data: p.peso.map((x) => x.kg), borderColor: paleta.categorias[0], backgroundColor: paleta.categorias[0], pointRadius: 2 },
            { label: 'Média de 7 dias', data: p.peso.map((x) => x.media7), borderColor: paleta.categorias[1], backgroundColor: paleta.categorias[1], pointRadius: 0, borderDash: [5, 4] },
          ],
        },
        options: { ...semMoeda, scales: { x: { ticks: { color: paleta.texto } }, y: { ticks: { color: paleta.texto }, grid: { color: paleta.grade } } } },
      }));
    }
    if (this.kcalRef) {
      const dias = p.dias.slice(-30);
      this.graficos.push(new Chart(this.kcalRef.nativeElement, {
        type: 'bar',
        data: {
          labels: dias.map((x) => x.data.slice(5).split('-').reverse().join('/')),
          datasets: [{ label: 'kcal', data: dias.map((x) => Math.round(x.kcal)), backgroundColor: dias.map((x) => (x.kcalNaMeta ? paleta.acento : paleta.texto)) }],
        },
        options: { ...(semMoeda as object), plugins: { legend: { display: false } }, scales: { x: { ticks: { color: paleta.texto } }, y: { ticks: { color: paleta.texto }, grid: { color: paleta.grade } } } },
      }));
    }
  }
}
