import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Chart, ChartConfiguration } from 'chart.js';
import { ThemeService } from '../../../../core/theme.service';
import { opcoesBase, paletaAtual, registrarChartJs } from '../../chart-theme';
import {
  CategoriaResumo,
  Compromissos,
  Recorrente,
  ResumoResponse,
  TagResumo,
  TendenciaPeriodo,
} from '../../models/dashboard.model';
import { AuvpConta } from '../../services/auvp.service';
import { Transacao } from '../../models/transacao.model';

export interface GastoPorConta {
  conta: string;
  total: number;
  percentual: number;
  quantidade: number;
}

@Component({
  selector: 'app-financas-dashboard',
  standalone: true,
  imports: [CurrencyPipe, DatePipe, DecimalPipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements AfterViewInit, OnDestroy {
  readonly resumo = input<ResumoResponse | null>(null);
  readonly categorias = input<CategoriaResumo[]>([]);
  readonly tendencias = input<TendenciaPeriodo[]>([]);
  /** Lançamentos do mês exibido — base do ranking e da divisão por conta. */
  readonly transacoes = input<Transacao[]>([]);
  readonly recorrentes = input<Recorrente[]>([]);
  readonly compromissos = input<Compromissos | null>(null);
  readonly gastosPorTag = input<TagResumo[]>([]);
  /** Saldos, limites e faturas ao vivo da AUVP (vazio sem integração). */
  readonly contas = input<AuvpConta[]>([]);

  /** Clique numa tag ou conta: a página filtra a lista por ela. */
  readonly filtrar = output<{ tag?: string; conta?: string }>();

  readonly totalRecorrente = computed(() => this.recorrentes().reduce((s, r) => s + r.valorMedio, 0));

  /** Próximos meses com algo já comprometido; a barra é relativa ao maior. */
  readonly mesesComprometidos = computed(() => {
    const meses = (this.compromissos()?.meses ?? []).filter((m) => m.total > 0);
    const maior = Math.max(0, ...meses.map((m) => m.total));
    return meses.map((m) => ({
      ...m,
      rotulo: new Date(m.ano, m.mes - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      altura: maior > 0 ? (m.total / maior) * 100 : 0,
    }));
  });

  readonly cartoes = computed(() =>
    this.contas()
      .filter((c) => c.tipo === 'cartao' && (c.limiteTotal || c.faturaAberta))
      .map((c) => ({
        ...c,
        usado: c.limiteTotal && c.limiteDisponivel !== null ? c.limiteTotal - c.limiteDisponivel : null,
        percentualUsado:
          c.limiteTotal && c.limiteDisponivel !== null
            ? Math.min(100, ((c.limiteTotal - c.limiteDisponivel) / c.limiteTotal) * 100)
            : 0,
      })),
  );
  readonly contasCorrentes = computed(() => this.contas().filter((c) => c.tipo === 'conta'));
  readonly saldoEmConta = computed(() => this.contasCorrentes().reduce((s, c) => s + c.saldo, 0));

  private readonly pizzaCanvas = viewChild<ElementRef<HTMLCanvasElement>>('pizzaCanvas');
  private readonly linhaCanvas = viewChild<ElementRef<HTMLCanvasElement>>('linhaCanvas');

  private readonly theme = inject(ThemeService);

  private pizzaChart?: Chart<'doughnut'>;
  private linhaChart?: Chart<'line'>;
  private viewPronta = false;

  // Quando o tema é "system", trocar o modo do sistema operacional não muda a
  // preferência salva — só a media query. Os gráficos precisam dos dois sinais.
  private readonly mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  private readonly aoTrocarTemaDoSistema = () => this.renderizar();

  readonly semDespesas = computed(() => this.categorias().length === 0);
  private readonly despesasQueContam = computed(() =>
    this.transacoes().filter((t) => t.tipo === 'despesa' && !t.foraDosTotais),
  );

  readonly maioresDespesas = computed(() =>
    [...this.despesasQueContam()].sort((a, b) => b.valor - a.valor).slice(0, 5),
  );

  /** Despesas agrupadas pela conta/cartão de origem; lançamentos digitados aqui ficam em "Manual". */
  readonly gastosPorConta = computed<GastoPorConta[]>(() => {
    const despesas = this.despesasQueContam();
    const total = despesas.reduce((s, t) => s + t.valor, 0);
    const grupos = new Map<string, { total: number; quantidade: number }>();
    for (const t of despesas) {
      const conta = nomeDaConta(t);
      const g = grupos.get(conta) ?? { total: 0, quantidade: 0 };
      g.total += t.valor;
      g.quantidade++;
      grupos.set(conta, g);
    }
    return [...grupos.entries()]
      .map(([conta, g]) => ({
        conta,
        total: g.total,
        quantidade: g.quantidade,
        percentual: total > 0 ? (g.total / total) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);
  });

  /**
   * Gasto médio por dia no mês e, se for o mês corrente, a projeção para o fim
   * dele. Parcelas já têm valor certo no mês (o banco lança todas de uma vez),
   * então entram inteiras na projeção; só o gasto variável é extrapolado pelo
   * ritmo — senão uma parcela de R$ 800 lançada no dia 1 viraria R$ 24 mil.
   */
  readonly ritmo = computed(() => {
    const r = this.resumo();
    if (!r || r.totalDespesas <= 0) return null;
    const hoje = new Date();
    const diasNoMes = new Date(r.ano, r.mes, 0).getDate();
    const ehMesAtual = hoje.getFullYear() === r.ano && hoje.getMonth() + 1 === r.mes;
    const ehFuturo = new Date(r.ano, r.mes - 1, 1) > hoje;
    if (ehFuturo) return null;
    const dias = ehMesAtual ? hoje.getDate() : diasNoMes;
    const despesas = this.despesasQueContam();
    const parcelas = despesas.filter((t) => t.totalParcelas).reduce((s, t) => s + t.valor, 0);
    const variavel = Math.max(0, r.totalDespesas - parcelas);
    const porDia = variavel / dias;
    return { porDia, projecao: ehMesAtual ? parcelas + porDia * diasNoMes : null };
  });

  readonly semTendencias = computed(() => this.tendencias().every((t) => t.receitas === 0 && t.despesas === 0));

  constructor() {
    this.mediaQuery.addEventListener('change', this.aoTrocarTemaDoSistema);

    effect(() => {
      // Lê os sinais para que o efeito seja reexecutado quando qualquer um mudar.
      this.categorias();
      this.tendencias();
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
    this.pizzaChart?.destroy();
    this.linhaChart?.destroy();
  }

  private async renderizar(): Promise<void> {
    await registrarChartJs();
    this.renderizarPizza();
    this.renderizarLinha();
  }

  private renderizarPizza(): void {
    const canvas = this.pizzaCanvas()?.nativeElement;
    this.pizzaChart?.destroy();
    this.pizzaChart = undefined;

    const categorias = this.categorias();
    if (!canvas || categorias.length === 0) return;

    const paleta = paletaAtual();
    const config: ChartConfiguration<'doughnut'> = {
      type: 'doughnut',
      data: {
        labels: categorias.map((c) => c.categoriaRotulo),
        datasets: [
          {
            data: categorias.map((c) => c.total),
            backgroundColor: categorias.map((_, i) => paleta.categorias[i % paleta.categorias.length]),
            // A borda na cor da superfície separa as fatias sem desenhar linha.
            borderColor: paleta.superficie,
            borderWidth: 2,
          },
        ],
      },
      options: { ...opcoesBase<'doughnut'>(paleta), cutout: '58%' },
    };

    this.pizzaChart = new Chart(canvas, config);
  }

  private renderizarLinha(): void {
    const canvas = this.linhaCanvas()?.nativeElement;
    this.linhaChart?.destroy();
    this.linhaChart = undefined;

    const tendencias = this.tendencias();
    if (!canvas || tendencias.length === 0) return;

    const paleta = paletaAtual();
    const base = opcoesBase<'line'>(paleta);

    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels: tendencias.map((t) => t.periodoRotulo),
        datasets: [
          {
            label: 'Receitas',
            data: tendencias.map((t) => t.receitas),
            borderColor: paleta.positivo,
            backgroundColor: 'transparent',
            pointBackgroundColor: paleta.positivo,
            tension: 0.3,
          },
          {
            label: 'Despesas',
            data: tendencias.map((t) => t.despesas),
            borderColor: paleta.negativo,
            backgroundColor: 'transparent',
            pointBackgroundColor: paleta.negativo,
            tension: 0.3,
          },
        ],
      },
      options: {
        ...base,
        scales: {
          x: { ticks: { color: paleta.texto }, grid: { color: paleta.grade } },
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

    this.linhaChart = new Chart(canvas, config);
  }
}

function nomeDaConta(t: Transacao): string {
  if (t.origem !== 'auvp') return 'Manual';
  return t.conta ?? 'Banco';
}
