import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, catchError, debounceTime, forkJoin, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { IconComponent, IconName } from '../../shared/icon';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { HistoricoComponent } from './components/historico/historico.component';
import { ImportarComponent } from './components/importar/importar.component';
import { AuvpSyncComponent } from './components/auvp/auvp-sync.component';
import { LancamentoFormComponent } from './components/lancamento-form/lancamento-form.component';
import { MetasComponent } from './components/metas/metas.component';
import { OrcamentoComponent } from './components/orcamento/orcamento.component';
import { OrcamentoAuvpComponent } from './components/orcamento-auvp/orcamento-auvp.component';
import { PlanejamentoComponent } from './components/planejamento/planejamento.component';
import { PassoTutorial, TutorialComponent } from './components/tutorial/tutorial.component';
import { TransacoesListaComponent } from './components/transacoes-lista/transacoes-lista.component';
import {
  CategoriaResumo,
  Compromissos,
  Recorrente,
  ResumoResponse,
  TagResumo,
  TendenciaPeriodo,
} from './models/dashboard.model';
import { AuvpConta, AuvpOrcamento, AuvpService } from './services/auvp.service';
import { CATEGORIAS, Categoria, TipoTransacao, Transacao } from './models/transacao.model';
import { DashboardService } from './services/dashboard.service';
import { OrcamentoService } from './services/orcamento.service';
import { TransacaoService } from './services/transacao.service';
import { nomeArquivoCsv, transacoesParaCsv } from './financas-csv';
import { baixarCsv } from '../../shared/csv';
import { mensagemDeErro } from '../../core/erro-http';
import {
  AlertaCategoria,
  alertasNovos,
  chaveDoEstado,
  estadoDe,
  mensagemDoAlerta,
} from './alertas-orcamento';

type Aba = 'painel' | 'lancamentos' | 'planejamento' | 'orcamento' | 'metas' | 'historico';

@Component({
  selector: 'app-financas-page',
  standalone: true,
  imports: [
    RouterLink,
    FormsModule,
    IconComponent,
    LancamentoFormComponent,
    ImportarComponent,
    AuvpSyncComponent,
    DashboardComponent,
    TransacoesListaComponent,
    OrcamentoComponent,
    OrcamentoAuvpComponent,
    PlanejamentoComponent,
    TutorialComponent,
    MetasComponent,
    HistoricoComponent,
  ],
  templateUrl: './financas.page.html',
  styleUrl: './financas.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinancasPageComponent {
  private readonly transacaoService = inject(TransacaoService);
  private readonly dashboardService = inject(DashboardService);
  private readonly orcamentoService = inject(OrcamentoService);
  private readonly auvpService = inject(AuvpService);
  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);

  readonly categorias = CATEGORIAS;

  readonly aba = signal<Aba>('painel');

  // ------------------------------------------------------------ tutorial
  readonly tutorialAberto = signal(false);
  readonly passosTutorial: PassoTutorial[] = PASSOS_TUTORIAL;

  private readonly hoje = new Date();
  readonly ano = signal(this.hoje.getFullYear());
  readonly mes = signal(this.hoje.getMonth() + 1);

  readonly transacoes = signal<Transacao[]>([]);
  readonly resumo = signal<ResumoResponse | null>(null);
  readonly resumoCategorias = signal<CategoriaResumo[]>([]);
  readonly tendencias = signal<TendenciaPeriodo[]>([]);

  readonly carregando = signal(true);
  readonly erro = signal<string | null>(null);

  readonly mostrarImportacao = signal(false);
  /** Categorias que acabaram de entrar em atenção ou estourar. */
  readonly alertas = signal<AlertaCategoria[]>([]);
  readonly mensagemDoAlerta = mensagemDoAlerta;

  // Filtros da lista. São signals, e não campos comuns, porque `temFiltro` é um
  // computed: sobre campos comuns ele nunca recalcularia e o botão de limpar
  // jamais apareceria.
  readonly filtroCategoria = signal<Categoria | ''>('');
  readonly filtroTipo = signal<TipoTransacao | ''>('');
  readonly filtroStatus = signal<'' | 'PendenteRevisao'>('');
  readonly filtroBusca = signal('');
  readonly filtroTag = signal('');
  readonly filtroConta = signal('');
  private readonly busca$ = new Subject<void>();

  /** O mês inteiro, sem os filtros da lista — base do dashboard. */
  readonly transacoesDoMes = signal<Transacao[]>([]);
  readonly recorrentes = signal<Recorrente[]>([]);
  readonly compromissos = signal<Compromissos | null>(null);
  readonly gastosPorTag = signal<TagResumo[]>([]);

  // Da AUVP, quando há chave: o que existe lá para escolher na edição.
  readonly tagsAuvp = signal<string[]>([]);
  readonly orcamentosAuvp = signal<AuvpOrcamento[]>([]);
  readonly contasAuvp = signal<AuvpConta[]>([]);

  /** Tags e contas que aparecem no mês, para os filtros. */
  readonly tagsDoMes = computed(() =>
    [...new Set(this.transacoesDoMes().flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  );
  readonly contasDoMes = computed(() =>
    [...new Set(this.transacoesDoMes().map((t) => (t.origem === 'auvp' ? t.conta ?? 'Banco' : 'Manual')))].sort(),
  );

  readonly nomeDoMes = computed(() =>
    new Date(this.ano(), this.mes() - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  );

  readonly ehMesAtual = computed(() =>
    this.ano() === this.hoje.getFullYear() && this.mes() === this.hoje.getMonth() + 1,
  );

  readonly temFiltro = computed(
    () =>
      !!(
        this.filtroCategoria() ||
        this.filtroTipo() ||
        this.filtroStatus() ||
        this.filtroBusca().trim() ||
        this.filtroTag() ||
        this.filtroConta()
      ),
  );

  constructor() {
    this.carregarTudo();
    this.carregarAuvp();
    // Primeira visita: o tutorial abre sozinho.
    try {
      if (!localStorage.getItem(CHAVE_TUTORIAL)) this.tutorialAberto.set(true);
    } catch {
      // Modo privado: não insiste.
    }
    // Busca enquanto digita, sem uma requisição por tecla.
    this.busca$.pipe(debounceTime(300), takeUntilDestroyed()).subscribe(() => this.carregarTransacoes());
  }

  abrirTutorial(): void {
    this.tutorialAberto.set(true);
  }

  fecharTutorial(): void {
    this.tutorialAberto.set(false);
    this.aba.set('painel');
    try {
      localStorage.setItem(CHAVE_TUTORIAL, '1');
    } catch {
      // Sem armazenamento, o tutorial aparece de novo na próxima visita.
    }
  }

  buscar(texto: string): void {
    this.filtroBusca.set(texto);
    this.busca$.next();
  }

  /** Clicar numa tag ou conta do dashboard filtra a lista por ela. */
  filtrarPor(filtro: { tag?: string; conta?: string }): void {
    if (filtro.tag !== undefined) this.filtroTag.set(filtro.tag);
    if (filtro.conta !== undefined) this.filtroConta.set(filtro.conta);
    // O filtro vale para a lista, que mora na aba Lançamentos.
    this.aba.set('lancamentos');
    this.carregarTransacoes();
  }

  private carregarAuvp(): void {
    // Sem chave ou sem integração, cada chamada falha e a tela segue sem esses extras.
    this.auvpService.obter().subscribe({
      next: (c) => {
        if (!c.habilitado || !c.chaveConfigurada) return;
        this.auvpService.tags().pipe(catchError(() => of([]))).subscribe((t) => this.tagsAuvp.set(t.map((x) => x.nome)));
        this.auvpService.orcamentos().pipe(catchError(() => of([]))).subscribe((o) => this.orcamentosAuvp.set(o));
        this.auvpService.contas().pipe(catchError(() => of([]))).subscribe((c2) => this.contasAuvp.set(c2));
      },
      error: () => {},
    });
  }

  aoSincronizar(): void {
    this.recarregar();
    this.carregarAuvp();
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

  alternarImportacao(): void {
    this.mostrarImportacao.update((v) => !v);
  }

  /** Vindo do histórico: abre o orçamento do mês clicado. */
  abrirMesNoOrcamento(alvo: { ano: number; mes: number }): void {
    this.ano.set(alvo.ano);
    this.mes.set(alvo.mes);
    this.aba.set('orcamento');
    this.carregarTudo();
  }

  exportarCsv(): void {
    const transacoes = this.transacoes();
    if (transacoes.length === 0) return;

    baixarCsv(nomeArquivoCsv('lancamentos', this.ano(), this.mes()), transacoesParaCsv(transacoes));
  }

  dispensarAlertas(): void {
    this.alertas.set([]);
  }

  // Compara a situação de cada categoria com a da última verificação e avisa só o
  // que piorou. Sem isso, toda recarga repetiria o mesmo aviso de uma categoria
  // que já estava estourada, e o usuário aprenderia a ignorá-lo.
  private verificarAlertas(): void {
    this.orcamentoService.acompanhamento(this.ano(), this.mes()).subscribe({
      next: (a) => {
        if (!a.temOrcamento) return;

        const chave = chaveDoEstado(this.ano(), this.mes());
        const anterior = this.lerEstado(chave);

        this.alertas.set(alertasNovos(a.itens, anterior));
        this.gravarEstado(chave, estadoDe(a.itens));
      },
      // Alerta é acessório: falhar aqui não pode atrapalhar o resto da tela.
      error: () => {},
    });
  }

  private lerEstado(chave: string): ReturnType<typeof estadoDe> | null {
    try {
      const bruto = localStorage.getItem(chave);
      return bruto ? JSON.parse(bruto) : null;
    } catch {
      // Modo privado ou armazenamento bloqueado: sem histórico, sem alerta.
      return null;
    }
  }

  private gravarEstado(chave: string, estado: ReturnType<typeof estadoDe>): void {
    try {
      localStorage.setItem(chave, JSON.stringify(estado));
    } catch {
      // Ignorado de propósito: o alerta é um extra, não pode quebrar a página.
    }
  }

  // ----------------------------------------------------------- carregamento

  aplicarFiltros(): void {
    this.carregarTransacoes();
  }

  limparFiltros(): void {
    this.filtroCategoria.set('');
    this.filtroTipo.set('');
    this.filtroStatus.set('');
    this.filtroBusca.set('');
    this.filtroTag.set('');
    this.filtroConta.set('');
    this.carregarTransacoes();
  }

  /** Chamado quando um lançamento ou o orçamento muda, para refazer os agregados. */
  recarregar(): void {
    this.carregarTudo();
  }

  private carregarTransacoes(): void {
    this.transacaoService.listar(this.filtroAtual()).subscribe({
      next: (transacoes) => this.transacoes.set(transacoes),
      error: (err) => this.erro.set(mensagemDeErro(err, 'Não foi possível carregar os lançamentos')),
    });
  }

  private filtroAtual() {
    return {
      ano: this.ano(),
      mes: this.mes(),
      categoria: this.filtroCategoria() || undefined,
      tipo: this.filtroTipo() || undefined,
      status: this.filtroStatus() || undefined,
      q: this.filtroBusca().trim() || undefined,
      tag: this.filtroTag() || undefined,
      conta: this.filtroConta() || undefined,
    };
  }

  private carregarTudo(): void {
    this.carregando.set(true);
    this.erro.set(null);

    const doMes = this.transacaoService.listar({ ano: this.ano(), mes: this.mes() });
    forkJoin({
      doMes,
      transacoes: this.temFiltro() ? this.transacaoService.listar(this.filtroAtual()) : of(null),
      resumo: this.dashboardService.resumo(this.ano(), this.mes()),
      categorias: this.dashboardService.categorias(this.ano(), this.mes()),
      tendencias: this.dashboardService.tendencias(),
      // Extras: se falharem, o dashboard só não mostra o cartão deles.
      recorrentes: this.dashboardService.recorrentes().pipe(catchError(() => of([]))),
      compromissos: this.dashboardService.compromissos().pipe(catchError(() => of(null))),
      tags: this.dashboardService.tags(this.ano(), this.mes()).pipe(catchError(() => of([]))),
    }).subscribe({
      next: ({ doMes, transacoes, resumo, categorias, tendencias, recorrentes, compromissos, tags }) => {
        this.transacoesDoMes.set(doMes);
        this.transacoes.set(transacoes ?? doMes);
        this.recorrentes.set(recorrentes);
        this.compromissos.set(compromissos);
        this.gastosPorTag.set(tags);
        this.resumo.set(resumo);
        this.resumoCategorias.set(categorias);
        this.tendencias.set(tendencias);
        this.carregando.set(false);
        this.verificarAlertas();
      },
      error: (err) => {
        this.carregando.set(false);
        // Falhar em silêncio faria um erro de servidor parecer "você não tem
        // lançamentos", que é exatamente a leitura errada. E a mensagem precisa
        // dizer o que aconteceu: "verifique a conexão" manda procurar no lugar
        // errado quando quem falhou foi o servidor.
        this.erro.set(mensagemDeErro(err, 'Não foi possível carregar seus dados financeiros'));
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

const CHAVE_TUTORIAL = 'financas.tutorial.visto';

const PASSOS_TUTORIAL: PassoTutorial[] = [
  {
    aba: 'painel',
    titulo: 'Bem-vindo às Finanças',
    texto:
      'Um tour rápido pelo que dá para fazer aqui: registrar gastos, acompanhar o mês e planejar com métodos ' +
      'conhecidos (50/30/20, reserva de emergência, dívidas…). Use as setas do teclado ou os botões. Dá para rever ' +
      'quando quiser pelo botão "?" no topo.',
  },
  {
    aba: 'painel',
    alvo: '[data-tour="abas"]',
    titulo: 'As abas',
    texto:
      'Painel resume o mês; Lançamentos é o dia a dia (registrar, importar, corrigir); Planejamento reúne as metodologias; Orçamento define quanto vai para cada ' +
      'categoria; Metas acompanha o que você está juntando; Histórico mostra os meses anteriores. As setas ao lado ' +
      'trocam o mês de todas elas.',
  },
  {
    aba: 'lancamentos',
    alvo: '[data-tour="lancamento"]',
    titulo: 'Lançar um gasto',
    texto:
      'Escreva como falaria — "gastei 45 no mercado hoje no pix" — e o app entende valor, categoria, data e forma ' +
      'de pagamento. Também dá para importar foto de cupom, PDF de extrato ou planilha.',
  },
  {
    aba: 'lancamentos',
    alvo: '[data-tour="auvp"]',
    titulo: 'Seus bancos, automático',
    texto:
      'Com a chave da AUVP, as transações das suas contas e cartões chegam sozinhas a cada 6 horas. Corrigir algo ' +
      'aqui (categoria, tags, orçamento) também atualiza na AUVP.',
  },
  {
    aba: 'painel',
    alvo: '[data-tour="dashboard"]',
    titulo: 'O mês num olhar',
    texto:
      'Saldo, receitas, despesas, gasto por dia e projeção do mês, gráficos por categoria, contas e cartões ao vivo, ' +
      'recorrentes e parcelas já comprometidas. Clique numa tag ou conta para filtrar a lista.',
  },
  {
    aba: 'lancamentos',
    alvo: '[data-tour="filtros"]',
    titulo: 'Buscar e filtrar',
    texto: 'Busque por texto ("uber", "mercado") e filtre por tipo, categoria, tag ou conta.',
  },
  {
    aba: 'lancamentos',
    alvo: '[data-tour="lista"]',
    titulo: 'Corrigir lançamentos',
    texto:
      'O lápis edita; o olho tira o lançamento dos totais (transferência, reembolso). Marque vários para mudar de uma ' +
      'vez. Corrigiu a categoria de uma loja? O app aprende e acerta as próximas.',
  },
  {
    aba: 'planejamento',
    alvo: '[data-tour="planejamento-secoes"]',
    titulo: 'Planejamento',
    texto:
      'Cada botão é uma metodologia: saúde financeira, divisão da renda, fluxo de caixa, quitação de dívidas, gastos ' +
      'anuais, envelopes e o fechamento do mês. Toda seção tem um "Como funciona".',
  },
  {
    aba: 'planejamento',
    alvo: '[data-tour="taxa-poupanca"]',
    titulo: 'Comece pela taxa de poupança',
    texto:
      'Quanto da renda sobrou no mês. A referência é chegar a 20%. Ao lado ficam a reserva de emergência, o ' +
      '"pague-se primeiro", o orçamento base zero e a projeção de independência financeira.',
  },
  {
    aba: 'orcamento',
    alvo: '[data-tour="orcamento"]',
    titulo: 'Orçamento do mês',
    texto:
      'Defina a renda prevista e quanto vai para cada categoria — ou parta de um modelo pronto. O app avisa quando ' +
      'uma categoria passa de 80% e quando estoura.',
  },
  {
    aba: 'metas',
    alvo: '[data-tour="metas"]',
    titulo: 'Metas',
    texto:
      'Crie metas (reserva de emergência, viagem) e registre aportes. Escolha uma delas como reserva no ' +
      'Planejamento para acompanhar quantos meses ela cobre.',
  },
  {
    aba: 'painel',
    titulo: 'Pronto!',
    texto:
      'Uma rotina que funciona: lance ou sincronize durante o mês, confira o Planejamento toda semana e faça o ' +
      'Fechamento do mês no último dia. Bom planejamento!',
  },
];
