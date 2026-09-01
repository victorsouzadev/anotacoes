import { CurrencyPipe, DecimalPipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Chart, ChartConfiguration } from 'chart.js';
import { ThemeService } from '../../../../core/theme.service';
import { opcoesBase, paletaAtual, registrarChartJs } from '../../chart-theme';
import { HistoricoMes } from '../../models/orcamento.model';
import { OrcamentoService } from '../../services/orcamento.service';

@Component({
  selector: 'app-historico-orcamentos',
  standalone: true,
  imports: [CurrencyPipe, DecimalPipe],
  templateUrl: './historico.component.html',
  styleUrl: './historico.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoricoComponent implements AfterViewInit, OnDestroy {
  /** Pedido para abrir um mês específico na aba de orçamento. */
  readonly mesEscolhido = output<{ ano: number; mes: number }>();

  private readonly service = inject(OrcamentoService);
  private readonly theme = inject(ThemeService);

  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('barrasCanvas');
  private grafico?: Chart<'bar'>;
  private viewPronta = false;

  private readonly mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  private readonly aoTrocarTemaDoSistema = () => void this.renderizar();

  readonly meses = signal<HistoricoMes[]>([]);
  readonly carregando = signal(true);
  readonly erro = signal<string | null>(null);
  readonly janela = signal(12);

  readonly comOrcamento = computed(() => this.meses().filter((m) => m.temOrcamento));

  readonly temDados = computed(() => this.meses().some((m) => m.totalRealizado > 0 || m.temOrcamento));

  /** Média do quanto do orçamento foi usado, só nos meses que tiveram orçamento. */
  readonly mediaUtilizacao = computed(() => {
    const meses = this.comOrcamento();
    if (meses.length === 0) return 0;
    return meses.reduce((s, m) => s + m.percentualUtilizado, 0) / meses.length;
  });

  readonly mesesEstourados = computed(() => this.comOrcamento().filter((m) => m.situacao === 'estourado').length);

  readonly totalRealizado = computed(() => this.meses().reduce((s, m) => s + m.totalRealizado, 0));

  constructor() {
    this.mediaQuery.addEventListener('change', this.aoTrocarTemaDoSistema);
    this.carregar();

    effect(() => {
      this.meses();
      this.theme.pref();
      if (this.viewPronta) void this.renderizar();
    });
  }

  async ngAfterViewInit(): Promise<void> {
    this.viewPronta = true;
    await this.renderizar();
  }

  ngOnDestroy(): void {
    this.mediaQuery.removeEventListener('change', this.aoTrocarTemaDoSistema);
    this.grafico?.destroy();
  }

  mudarJanela(meses: number): void {
    this.janela.set(meses);
    this.carregar();
  }

  private carregar(): void {
    this.carregando.set(true);
    this.erro.set(null);

    this.service.historico(this.janela()).subscribe({
      next: (meses) => {
        this.meses.set(meses);
        this.carregando.set(false);
      },
      error: () => {
        this.carregando.set(false);
        this.erro.set('Não foi possível carregar o histórico.');
      },
    });
  }

  abrirMes(mes: HistoricoMes): void {
    this.mesEscolhido.emit({ ano: mes.ano, mes: mes.mes });
  }

  private async renderizar(): Promise<void> {
    await registrarChartJs();

    const canvas = this.canvas()?.nativeElement;
    this.grafico?.destroy();
    this.grafico = undefined;

    const meses = this.meses();
    if (!canvas || meses.length === 0) return;

    const paleta = paletaAtual();
    const base = opcoesBase<'bar'>(paleta);

    const config: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels: meses.map((m) => m.rotulo),
        datasets: [
          {
            label: 'Planejado',
            data: meses.map((m) => m.valorTotal),
            backgroundColor: paleta.acento,
            borderRadius: 3,
          },
          {
            label: 'Gasto',
            // Barras coloridas por situação: um mês estourado é visível de longe,
            // sem precisar comparar as alturas.
            data: meses.map((m) => m.totalRealizado),
            backgroundColor: meses.map((m) =>
              m.situacao === 'estourado' ? paleta.negativo
                : m.situacao === 'atencao' ? paleta.atencao
                : paleta.positivo),
            borderRadius: 3,
          },
        ],
      },
      options: {
        ...base,
        plugins: {
          ...base.plugins,
          // A barra de gasto muda de cor conforme a situação do mês, e a legenda
          // padrão do Chart.js mostraria só a primeira cor da lista — dizendo
          // "Gasto" em verde ao lado de uma barra vermelha. A legenda é montada
          // em HTML abaixo do gráfico.
          legend: { display: false },
        },
        scales: {
          x: { ticks: { color: paleta.texto }, grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: {
              color: paleta.texto,
              callback: (v) => `R$ ${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`,
            },
            grid: { color: paleta.grade },
          },
        },
      },
    };

    this.grafico = new Chart(canvas, config);
  }

  classeDaSituacao(situacao: string): string {
    return situacao;
  }
}
