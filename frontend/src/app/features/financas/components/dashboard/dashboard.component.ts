import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { CategoriaResumo, ResumoResponse, TendenciaPeriodo } from '../../models/dashboard.model';

Chart.register(...registerables);

const CORES_CATEGORIA = [
  '#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#4b5563', '#ea580c', '#0f766e',
];

@Component({
  selector: 'app-financas-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() resumo: ResumoResponse | null = null;
  @Input() categorias: CategoriaResumo[] = [];
  @Input() tendencias: TendenciaPeriodo[] = [];

  @ViewChild('pizzaCanvas') pizzaCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('linhaCanvas') linhaCanvas?: ElementRef<HTMLCanvasElement>;

  private pizzaChart?: Chart;
  private linhaChart?: Chart;
  private viewPronta = false;

  ngAfterViewInit(): void {
    this.viewPronta = true;
    this.renderizarGraficos();
  }

  ngOnChanges(): void {
    if (this.viewPronta) {
      this.renderizarGraficos();
    }
  }

  ngOnDestroy(): void {
    this.pizzaChart?.destroy();
    this.linhaChart?.destroy();
  }

  private renderizarGraficos(): void {
    this.renderizarPizza();
    this.renderizarLinha();
  }

  private renderizarPizza(): void {
    if (!this.pizzaCanvas) return;

    const config: ChartConfiguration<'pie'> = {
      type: 'pie',
      data: {
        labels: this.categorias.map((c) => c.categoria),
        datasets: [
          {
            data: this.categorias.map((c) => c.total),
            backgroundColor: this.categorias.map((_, i) => CORES_CATEGORIA[i % CORES_CATEGORIA.length]),
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' },
        },
      },
    };

    this.pizzaChart?.destroy();
    this.pizzaChart = new Chart(this.pizzaCanvas.nativeElement, config);
  }

  private renderizarLinha(): void {
    if (!this.linhaCanvas) return;

    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels: this.tendencias.map((t) => t.periodo),
        datasets: [
          {
            label: 'Receitas',
            data: this.tendencias.map((t) => t.receitas),
            borderColor: '#16a34a',
            backgroundColor: 'rgba(22, 163, 74, 0.1)',
            tension: 0.3,
          },
          {
            label: 'Despesas',
            data: this.tendencias.map((t) => t.despesas),
            borderColor: '#dc2626',
            backgroundColor: 'rgba(220, 38, 38, 0.1)',
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' },
        },
      },
    };

    this.linhaChart?.destroy();
    this.linhaChart = new Chart(this.linhaCanvas.nativeElement, config);
  }
}
