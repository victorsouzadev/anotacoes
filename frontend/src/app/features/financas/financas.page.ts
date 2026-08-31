import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { IconComponent, IconName } from '../../shared/icon';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { LancamentoFormComponent } from './components/lancamento-form/lancamento-form.component';
import { OrcamentoComponent } from './components/orcamento/orcamento.component';
import { TransacoesListaComponent } from './components/transacoes-lista/transacoes-lista.component';
import { CategoriaResumo, ResumoResponse, TendenciaPeriodo } from './models/dashboard.model';
import { CATEGORIAS, Categoria, TipoTransacao, Transacao } from './models/transacao.model';
import { DashboardService } from './services/dashboard.service';
import { TransacaoService } from './services/transacao.service';

type Aba = 'lancamentos' | 'orcamento';

@Component({
  selector: 'app-financas-page',
  standalone: true,
  imports: [
    RouterLink,
    FormsModule,
    IconComponent,
    LancamentoFormComponent,
    DashboardComponent,
    TransacoesListaComponent,
    OrcamentoComponent,
  ],
  templateUrl: './financas.page.html',
  styleUrl: './financas.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinancasPageComponent {
  private readonly transacaoService = inject(TransacaoService);
  private readonly dashboardService = inject(DashboardService);
  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);

  readonly categorias = CATEGORIAS;

  readonly aba = signal<Aba>('lancamentos');

  private readonly hoje = new Date();
  readonly ano = signal(this.hoje.getFullYear());
  readonly mes = signal(this.hoje.getMonth() + 1);

  readonly transacoes = signal<Transacao[]>([]);
  readonly resumo = signal<ResumoResponse | null>(null);
  readonly resumoCategorias = signal<CategoriaResumo[]>([]);
  readonly tendencias = signal<TendenciaPeriodo[]>([]);

  readonly carregando = signal(true);
  readonly erro = signal<string | null>(null);

  // Filtros da lista. São signals, e não campos comuns, porque `temFiltro` é um
  // computed: sobre campos comuns ele nunca recalcularia e o botão de limpar
  // jamais apareceria.
  readonly filtroCategoria = signal<Categoria | ''>('');
  readonly filtroTipo = signal<TipoTransacao | ''>('');
  readonly filtroStatus = signal<'' | 'PendenteRevisao'>('');

  readonly nomeDoMes = computed(() =>
    new Date(this.ano(), this.mes() - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  );

  readonly ehMesAtual = computed(() =>
    this.ano() === this.hoje.getFullYear() && this.mes() === this.hoje.getMonth() + 1,
  );

  readonly temFiltro = computed(() => !!(this.filtroCategoria() || this.filtroTipo() || this.filtroStatus()));

  constructor() {
    this.carregarTudo();
  }

  // ------------------------------------------------------------ navegação

  mudarMes(delta: number): void {
    const data = new Date(this.ano(), this.mes() - 1 + delta, 1);
    this.ano.set(data.getFullYear());
    this.mes.set(data.getMonth() + 1);
    this.carregarTudo();
  }

  irParaMesAtual(): void {
    this.ano.set(this.hoje.getFullYear());
    this.mes.set(this.hoje.getMonth() + 1);
    this.carregarTudo();
  }

  trocarAba(aba: Aba): void {
    this.aba.set(aba);
  }

  // ----------------------------------------------------------- carregamento

  aplicarFiltros(): void {
    this.carregarTransacoes();
  }

  limparFiltros(): void {
    this.filtroCategoria.set('');
    this.filtroTipo.set('');
    this.filtroStatus.set('');
    this.carregarTransacoes();
  }

  /** Chamado quando um lançamento ou o orçamento muda, para refazer os agregados. */
  recarregar(): void {
    this.carregarTudo();
  }

  private carregarTransacoes(): void {
    this.transacaoService.listar(this.filtroAtual()).subscribe({
      next: (transacoes) => this.transacoes.set(transacoes),
      error: () => this.erro.set('Não foi possível carregar os lançamentos.'),
    });
  }

  private filtroAtual() {
    return {
      ano: this.ano(),
      mes: this.mes(),
      categoria: this.filtroCategoria() || undefined,
      tipo: this.filtroTipo() || undefined,
      status: this.filtroStatus() || undefined,
    };
  }

  private carregarTudo(): void {
    this.carregando.set(true);
    this.erro.set(null);

    forkJoin({
      transacoes: this.transacaoService.listar(this.filtroAtual()),
      resumo: this.dashboardService.resumo(this.ano(), this.mes()),
      categorias: this.dashboardService.categorias(this.ano(), this.mes()),
      tendencias: this.dashboardService.tendencias(),
    }).subscribe({
      next: ({ transacoes, resumo, categorias, tendencias }) => {
        this.transacoes.set(transacoes);
        this.resumo.set(resumo);
        this.resumoCategorias.set(categorias);
        this.tendencias.set(tendencias);
        this.carregando.set(false);
      },
      error: () => {
        this.carregando.set(false);
        // Falhar em silêncio faria um erro de servidor parecer "você não tem
        // lançamentos", que é exatamente a leitura errada.
        this.erro.set('Não foi possível carregar seus dados financeiros. Verifique a conexão e tente de novo.');
      },
    });
  }

  // ------------------------------------------------------------------ tema

  themeIconName(): IconName {
    switch (this.theme.pref()) {
      case 'dark': return 'moon';
      case 'light': return 'sun';
      default: return 'monitor';
    }
  }

  themeLabel(): string {
    switch (this.theme.pref()) {
      case 'dark': return 'Tema: escuro (clique para claro)';
      case 'light': return 'Tema: claro (clique para automático)';
      default: return 'Tema: automático (clique para escuro)';
    }
  }
}
