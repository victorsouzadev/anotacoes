import { HttpClient } from '@angular/common/http';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Chart } from 'chart.js';
import { firstValueFrom } from 'rxjs';
import { mensagemDeErro } from '../../core/erro-http';
import { IconComponent } from '../../shared/icon';
import { opcoesBase, paletaAtual, registrarChartJs } from '../financas/chart-theme';
import { ativas, duracao, km, porSemana, ritmo, totais } from './treino-calc';
import { Atividade, Plano } from './treino.models';

/** Tela web do Treino (spec 017): só leitura do que o app Treino Corrida envia. */
@Component({
  selector: 'app-treino-page',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header>
        <a routerLink="/" class="voltar" title="Voltar ao início"><app-icon name="grid" [size]="16" /></a>
        <h1><span class="marca"><app-icon name="run" [size]="14" /></span> Treino</h1>
      </header>
      <main>
        @if (erro(); as e) { <p class="erro">{{ e }}</p> }
        @if (carregado()) {
          @if (plano(); as p) {
            <section class="card">
              <h3>{{ p.programa }}</h3>
              <p>Semana {{ p.semana }} de {{ p.semanasTotal }} · {{ p.sessoesFeitas }}/{{ p.sessoesTotal }} sessões</p>
              <div class="trilho"><div class="cheio" [style.width.%]="p.sessoesTotal ? (p.sessoesFeitas / p.sessoesTotal) * 100 : 0"></div></div>
              @if (p.proximaSessao) { <p class="sub">Próxima: {{ p.proximaSessao }}</p> }
            </section>
          }
          @if (lista().length === 0) {
            <section class="card vazio">
              <p>Nenhum treino ainda. Os treinos chegam do app <strong>Treino Corrida</strong> no Android, quando ele está
                logado na mesma conta do hub.</p>
            </section>
          } @else {
            <div class="totais">
              @for (t of janelas(); track t.dias) {
                <div class="card">
                  <span class="sub">{{ t.dias }} dias</span>
                  <span class="num">{{ t.treinos }} treino(s)</span>
                  <span>{{ km(t.metros) }} · {{ duracao(t.segundos) }}</span>
                  @if (t.esforcoMedio !== null) { <span class="sub">esforço médio {{ t.esforcoMedio.toFixed(1).replace('.', ',') }}/10</span> }
                  @if (t.comDor) { <span class="sub dor">dor relatada em {{ t.comDor }}</span> }
                </div>
              }
            </div>
            <div class="graficos">
              <section class="card"><h3>km por semana</h3><div class="grafico"><canvas #graficoKm></canvas></div></section>
              <section class="card"><h3>Ritmo médio (min/km)</h3><div class="grafico"><canvas #graficoRitmo></canvas></div></section>
            </div>
            <section class="card">
              <h3>Treinos</h3>
              <table>
                <thead><tr><th>Data</th><th>Treino</th><th>Distância</th><th>Tempo</th><th>Ritmo</th><th>Esforço</th><th>FC</th></tr></thead>
                <tbody>
                  @for (a of lista(); track a.id) {
                    <tr>
                      <td>{{ data(a.inicio) }}</td>
                      <td>{{ a.titulo }} <span class="sub">{{ a.tipo === 'sessao' ? 'plano' : 'livre' }}</span>
                        @if (a.dor) { <span class="dor">· dor</span> }
                        @if (a.nota) { <div class="sub">{{ a.nota }}</div> }</td>
                      <td>{{ a.distanciaM > 0 ? km(a.distanciaM) : '—' }}</td>
                      <td>{{ duracao(a.duracaoSeg) }}</td>
                      <td>{{ ritmo(a) ?? '—' }}</td>
                      <td>{{ a.esforco !== null ? a.esforco + '/10' : '—' }}</td>
                      <td>{{ a.fcMedia !== null ? a.fcMedia + (a.fcMax !== null ? ' / ' + a.fcMax : '') : '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </section>
          }
        } @else if (!erro()) {
          <p class="sub">Carregando…</p>
        }
      </main>
    </div>
  `,
  styles: [`
    .page { min-height: 100dvh; background: var(--bg); }
    header { display: flex; align-items: center; gap: 12px; padding: 14px 20px; background: var(--surface); border-bottom: 1px solid var(--border); }
    h1 { font-size: 16px; margin: 0; display: flex; align-items: center; gap: 8px; }
    .marca { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 8px; background: var(--accent); color: var(--accent-contrast); }
    .voltar { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-muted); }
    main { max-width: 980px; margin: 0 auto; padding: 16px 20px 40px; display: flex; flex-direction: column; gap: 12px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
    h3 { margin: 0 0 6px; font-size: 15px; } p { margin: 0; font-size: 13.5px; }
    .sub { font-size: 12px; color: var(--text-muted); }
    .num { font-size: 18px; font-weight: 700; }
    .dor { color: var(--atencao); font-size: 12px; }
    .trilho { height: 8px; background: var(--bg); border-radius: 999px; overflow: hidden; margin: 6px 0; }
    .cheio { height: 100%; background: var(--accent); }
    .totais { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .graficos { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
    .grafico { position: relative; height: 220px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); padding: 6px 8px; border-bottom: 1px solid var(--border); }
    td { padding: 8px; border-bottom: 1px solid var(--border); vertical-align: top; font-variant-numeric: tabular-nums; }
    .vazio p { line-height: 1.5; }
    .erro { color: var(--danger); font-size: 13px; }
    section:has(table) { overflow-x: auto; }
    @media (max-width: 600px) { header, main { padding-left: 16px; padding-right: 16px; } }
  `],
})
export class TreinoPageComponent implements AfterViewInit, OnDestroy {
  private http = inject(HttpClient);
  readonly km = km;
  readonly duracao = duracao;
  readonly ritmo = ritmo;

  readonly lista = signal<Atividade[]>([]);
  readonly plano = signal<Plano | null>(null);
  readonly carregado = signal(false);
  readonly erro = signal<string | null>(null);
  readonly janelas = signal<ReturnType<typeof totais>[]>([]);

  @ViewChild('graficoKm') kmRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('graficoRitmo') ritmoRef?: ElementRef<HTMLCanvasElement>;
  private graficos: Chart[] = [];

  async ngAfterViewInit(): Promise<void> {
    try {
      const [atividades, plano] = await Promise.all([
        firstValueFrom(this.http.get<Atividade[]>('/api/treino/atividades')),
        firstValueFrom(this.http.get<Plano | null>('/api/treino/plano')),
      ]);
      const lista = ativas(atividades);
      this.lista.set(lista);
      this.plano.set(plano);
      this.janelas.set([7, 30, 90].map((d) => totais(lista, d)));
      this.carregado.set(true);
      setTimeout(() => void this.desenhar(lista), 0);
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não foi possível carregar os treinos'));
    }
  }

  ngOnDestroy(): void {
    this.graficos.forEach((g) => g.destroy());
  }

  data(iso: string): string {
    return new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  private async desenhar(lista: Atividade[]): Promise<void> {
    if (!this.kmRef || !this.ritmoRef) return;
    await registrarChartJs();
    const { Chart } = await import('chart.js');
    const paleta = paletaAtual();
    const base = opcoesBase<'bar'>(paleta);
    const semanas = porSemana(lista, 12);
    const rotulos = semanas.map((s) => s.semana.slice(5).split('-').reverse().join('/'));
    const eixos = { x: { ticks: { color: paleta.texto } }, y: { ticks: { color: paleta.texto }, grid: { color: paleta.grade } } };
    this.graficos.push(new Chart(this.kmRef.nativeElement, {
      type: 'bar',
      data: { labels: rotulos, datasets: [{ label: 'km', data: semanas.map((s) => Number(s.km.toFixed(2))), backgroundColor: paleta.acento }] },
      options: { ...(base as object), plugins: { legend: { display: false } }, scales: eixos },
    }));
    this.graficos.push(new Chart(this.ritmoRef.nativeElement, {
      type: 'line',
      data: { labels: rotulos, datasets: [{ label: 'min/km', data: semanas.map((s) => (s.ritmoSegKm ? Number((s.ritmoSegKm / 60).toFixed(2)) : null)), borderColor: paleta.categorias[1], backgroundColor: paleta.categorias[1], spanGaps: true }] },
      options: { ...(base as object), plugins: { legend: { display: false } }, scales: { ...eixos, y: { ...eixos.y, reverse: true } } },
    }));
  }
}
