import { CurrencyPipe, DatePipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Chart } from 'chart.js';
import { ThemeService } from '../../../../core/theme.service';
import { opcoesBase, paletaAtual, registrarChartJs } from '../../chart-theme';
import { FluxoCaixa } from '../../models/planejamento.model';
import { PlanejamentoService } from '../../services/planejamento.service';

// Fluxo de caixa projetado: saldo dia a dia a partir de hoje, com recorrentes,
// parcelas e faturas que já se sabe que vêm.
@Component({
  selector: 'app-plan-fluxo',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, DatePipe],
  templateUrl: './fluxo.component.html',
  styleUrls: ['./planejamento-comum.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FluxoComponent implements AfterViewInit, OnDestroy {
  private readonly service = inject(PlanejamentoService);
  private readonly theme = inject(ThemeService);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('grafico');
  private grafico?: Chart<'line'>;

  readonly dias = signal(60);
  readonly fluxo = signal<FluxoCaixa | null>(null);
  readonly erro = signal<string | null>(null);
  readonly mostrarTodos = signal(false);

  readonly eventosVisiveis = computed(() => {
    const e = this.fluxo()?.eventos ?? [];
    return this.mostrarTodos() ? e : e.slice(0, 12);
  });

  constructor() {
    effect(() => {
      this.fluxo();
      this.theme.pref();
      void this.desenhar();
    });
    this.carregar();
  }

  ngAfterViewInit(): void {
    void this.desenhar();
  }

  ngOnDestroy(): void {
    this.grafico?.destroy();
  }

  carregar(): void {
    this.erro.set(null);
    this.service.fluxo(this.dias()).subscribe({
      next: (f) => this.fluxo.set(f),
      error: () => this.erro.set('Não foi possível projetar o fluxo de caixa.'),
    });
  }

  salvarSaldo(valor: string): void {
    const n = Number(valor);
    if (!Number.isFinite(n)) return;
    this.service.salvarPreferencias({ saldoInicialFluxo: n }).subscribe(() => this.carregar());
  }

  private async desenhar(): Promise<void> {
    const f = this.fluxo();
    const el = this.canvas()?.nativeElement;
    this.grafico?.destroy();
    this.grafico = undefined;
    if (!f || !el) return;

    await registrarChartJs();
    const paleta = paletaAtual();
    const base = opcoesBase<'line'>(paleta);
    this.grafico = new Chart(el, {
      type: 'line',
      data: {
        labels: f.pontos.map((p) => p.data.slice(8, 10) + '/' + p.data.slice(5, 7)),
        datasets: [
          {
            label: 'Saldo previsto',
            data: f.pontos.map((p) => p.saldo),
            borderColor: paleta.acento,
            backgroundColor: 'transparent',
            pointRadius: 0,
            tension: 0.15,
            // Abaixo de zero a linha fica vermelha.
            segment: { borderColor: (ctx) => ((ctx.p1.parsed.y ?? 0) < 0 ? paleta.negativo : paleta.acento) },
          },
        ],
      },
      options: {
        ...base,
        plugins: { ...base.plugins, legend: { display: false } },
        scales: {
          x: { ticks: { color: paleta.texto, maxTicksLimit: 8 }, grid: { color: paleta.grade } },
          y: {
            ticks: {
              color: paleta.texto,
              callback: (v) => `R$ ${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`,
            },
            grid: { color: (ctx) => (ctx.tick.value === 0 ? paleta.negativo : paleta.grade) },
          },
        },
      },
    });
  }
}
