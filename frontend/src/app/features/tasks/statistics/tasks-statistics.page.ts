import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { TasksTopBarComponent } from '../components/tasks-top-bar.component';
import { TasksStoreService } from '../services/tasks-store.service';

Chart.register(...registerables);

const CATEGORY_FALLBACK_COLOR = '#6b7280';

@Component({
  selector: 'app-tasks-statistics-page',
  standalone: true,
  imports: [TasksTopBarComponent],
  template: `
    <div class="page">
      <app-tasks-top-bar />
      <main class="content">
        <div class="cards">
          <div class="card">
            <span class="label">Total de tarefas</span>
            <span class="value">{{ total }}</span>
          </div>
          <div class="card">
            <span class="label">Concluídas</span>
            <span class="value positive">{{ completed }}</span>
          </div>
          <div class="card">
            <span class="label">Pendentes</span>
            <span class="value">{{ pending }}</span>
          </div>
          <div class="card">
            <span class="label">Concluídas hoje</span>
            <span class="value positive">{{ completedToday }}</span>
          </div>
          <div class="card">
            <span class="label">Pomodoros concluídos</span>
            <span class="value">{{ totalPomodoros }}</span>
          </div>
        </div>

        <div class="card chart-card">
          <h2>Tarefas por categoria</h2>
          @if (categoryLabels.length === 0) {
            <p class="empty">Sem tarefas categorizadas.</p>
          }
          <canvas #categoryCanvas [style.display]="categoryLabels.length ? 'block' : 'none'"></canvas>
        </div>
      </main>
    </div>
  `,
  styles: [`
    .page { min-height: 100dvh; background: var(--bg); }
    .content { max-width: 800px; margin: 0 auto; padding: 24px 28px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.1rem; box-shadow: var(--shadow-sm); }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .cards .card { display: flex; flex-direction: column; gap: 0.3rem; }
    .label { font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.02em; }
    .value { font-size: 1.3rem; font-weight: 700; color: var(--text); }
    .value.positive { color: #16a34a; }
    .chart-card h2 { margin: 0 0 12px; font-size: 1.05rem; }
    .chart-card canvas { max-height: 300px; }
    .empty { color: var(--text-muted); font-size: 0.9rem; }
  `],
})
export class TasksStatisticsPageComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('categoryCanvas') categoryCanvas?: ElementRef<HTMLCanvasElement>;
  private chart?: Chart;

  total = 0;
  completed = 0;
  pending = 0;
  completedToday = 0;
  totalPomodoros = 0;
  categoryLabels: string[] = [];
  categoryData: number[] = [];
  categoryColors: string[] = [];

  constructor(public store: TasksStoreService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    if (this.store.tasks().length === 0) await this.store.reload();
    this.computeStats();
    this.cdr.markForCheck();
  }

  ngAfterViewInit(): void {
    this.renderChart();
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private computeStats(): void {
    const active = this.store.activeTasks();
    this.total = active.length;
    this.completed = active.filter((t) => t.isCompleted).length;
    this.pending = this.total - this.completed;
    const today = new Date().toDateString();
    this.completedToday = active.filter((t) => t.isCompleted && t.completedAt && new Date(t.completedAt).toDateString() === today).length;
    this.totalPomodoros = active.reduce((sum, t) => sum + t.completedPomodoros, 0);

    const byCategory = new Map<string, number>();
    for (const t of active) {
      const label = this.store.categoryFor(t)?.name ?? 'Sem categoria';
      byCategory.set(label, (byCategory.get(label) ?? 0) + 1);
    }
    this.categoryLabels = [...byCategory.keys()];
    this.categoryData = [...byCategory.values()];
    this.categoryColors = this.categoryLabels.map((label) => {
      const category = this.store.categories().find((c) => c.name === label);
      return category?.colorHex ?? CATEGORY_FALLBACK_COLOR;
    });
    this.renderChart();
  }

  private renderChart(): void {
    if (!this.categoryCanvas || this.categoryLabels.length === 0) return;
    const config: ChartConfiguration<'pie'> = {
      type: 'pie',
      data: {
        labels: this.categoryLabels,
        datasets: [{ data: this.categoryData, backgroundColor: this.categoryColors }],
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } },
    };
    this.chart?.destroy();
    this.chart = new Chart(this.categoryCanvas.nativeElement, config);
  }
}
