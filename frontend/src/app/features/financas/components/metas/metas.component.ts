import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { IconComponent } from '../../../../shared/icon';
import {
  InvestimentoDisponivel,
  Meta,
  ROTULO_SITUACAO_META,
  SituacaoMeta,
} from '../../models/meta.model';
import { MetaService } from '../../services/meta.service';

@Component({
  selector: 'app-metas',
  standalone: true,
  imports: [FormsModule, IconComponent, CurrencyPipe, DecimalPipe, DatePipe],
  templateUrl: './metas.component.html',
  styleUrl: './metas.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetasComponent {
  private readonly service = inject(MetaService);

  readonly metas = signal<Meta[]>([]);
  readonly investimentos = signal<InvestimentoDisponivel[]>([]);
  readonly carregando = signal(true);
  readonly salvando = signal(false);
  readonly erro = signal<string | null>(null);

  readonly mostrarArquivadas = signal(false);
  readonly editandoId = signal<string | null>(null);
  readonly criandoNova = signal(false);
  readonly aportandoId = signal<string | null>(null);
  readonly confirmandoRemocaoId = signal<string | null>(null);

  readonly rotuloSituacao = ROTULO_SITUACAO_META;

  // Formulário da meta.
  nome = '';
  valorAlvo: number | null = null;
  dataAlvo = '';
  observacoes = '';

  // Formulário do aporte.
  aporteValor: number | null = null;
  aporteData = '';
  aporteTransacaoId = '';

  readonly ativas = computed(() => this.metas().filter((m) => !m.concluida && !m.arquivada));
  readonly concluidas = computed(() => this.metas().filter((m) => m.concluida && !m.arquivada));
  readonly arquivadas = computed(() => this.metas().filter((m) => m.arquivada));

  readonly totalGuardado = computed(() =>
    this.ativas().reduce((soma, m) => soma + m.valorAcumulado, 0),
  );
  readonly totalAlvo = computed(() => this.ativas().reduce((soma, m) => soma + m.valorAlvo, 0));

  constructor() {
    this.carregar();
  }

  private carregar(): void {
    this.carregando.set(true);
    forkJoin({
      metas: this.service.listar(this.mostrarArquivadas()),
      investimentos: this.service.investimentosDisponiveis(),
    }).subscribe({
      next: ({ metas, investimentos }) => {
        this.metas.set(metas);
        this.investimentos.set(investimentos);
        this.carregando.set(false);
      },
      error: () => {
        this.carregando.set(false);
        this.erro.set('Não foi possível carregar as metas.');
      },
    });
  }

  alternarArquivadas(): void {
    this.mostrarArquivadas.update((v) => !v);
    this.carregar();
  }

  // ------------------------------------------------------------ formulário

  novaMeta(): void {
    this.limparFormulario();
    this.criandoNova.set(true);
    this.editandoId.set(null);
    this.erro.set(null);
  }

  editar(meta: Meta): void {
    this.nome = meta.nome;
    this.valorAlvo = meta.valorAlvo;
    this.dataAlvo = meta.dataAlvo ?? '';
    this.observacoes = meta.observacoes ?? '';
    this.editandoId.set(meta.id);
    this.criandoNova.set(false);
    this.erro.set(null);
  }

  cancelarFormulario(): void {
    this.criandoNova.set(false);
    this.editandoId.set(null);
    this.limparFormulario();
  }

  private limparFormulario(): void {
    this.nome = '';
    this.valorAlvo = null;
    this.dataAlvo = '';
    this.observacoes = '';
  }

  salvar(): void {
    if (this.salvando()) return;

    if (!this.nome.trim()) {
      this.erro.set('Dê um nome à meta.');
      return;
    }
    if (!this.valorAlvo || this.valorAlvo <= 0) {
      this.erro.set('Informe quanto você quer juntar.');
      return;
    }

    const request = {
      nome: this.nome.trim(),
      valorAlvo: this.valorAlvo,
      dataAlvo: this.dataAlvo || null,
      observacoes: this.observacoes.trim() || null,
    };

    this.salvando.set(true);
    this.erro.set(null);

    const id = this.editandoId();
    const chamada = id ? this.service.atualizar(id, request) : this.service.criar(request);

    chamada.subscribe({
      next: () => {
        this.salvando.set(false);
        this.cancelarFormulario();
        this.carregar();
      },
      error: (err) => {
        this.salvando.set(false);
        this.erro.set(err?.error?.erro ?? 'Não foi possível salvar a meta.');
      },
    });
  }

  // ---------------------------------------------------------------- aportes

  abrirAporte(meta: Meta): void {
    this.aportandoId.set(meta.id);
    this.aporteValor = null;
    this.aporteData = '';
    this.aporteTransacaoId = '';
    this.erro.set(null);
  }

  fecharAporte(): void {
    this.aportandoId.set(null);
  }

  aportar(meta: Meta): void {
    if (this.salvando()) return;

    // Ou o aporte vem de um lançamento já registrado (e herda valor e data dele),
    // ou é avulso e precisa de valor.
    const vinculado = !!this.aporteTransacaoId;
    if (!vinculado && (!this.aporteValor || this.aporteValor <= 0)) {
      this.erro.set('Informe o valor do aporte ou escolha um investimento já lançado.');
      return;
    }

    this.salvando.set(true);
    this.erro.set(null);

    this.service
      .adicionarAporte(meta.id, {
        valor: vinculado ? null : this.aporteValor,
        data: vinculado ? null : this.aporteData || null,
        observacoes: null,
        transacaoId: this.aporteTransacaoId || null,
      })
      .subscribe({
        next: () => {
          this.salvando.set(false);
          this.fecharAporte();
          this.carregar();
        },
        error: (err) => {
          this.salvando.set(false);
          this.erro.set(err?.error?.erro ?? 'Não foi possível registrar o aporte.');
        },
      });
  }

  removerAporte(meta: Meta, aporteId: string): void {
    this.salvando.set(true);
    this.service.removerAporte(meta.id, aporteId).subscribe({
      next: () => {
        this.salvando.set(false);
        this.carregar();
      },
      error: () => {
        this.salvando.set(false);
        this.erro.set('Não foi possível remover o aporte.');
      },
    });
  }

  // ------------------------------------------------------------ ciclo de vida

  arquivar(meta: Meta): void {
    this.service.arquivar(meta.id, meta.arquivada).subscribe({
      next: () => this.carregar(),
      error: () => this.erro.set('Não foi possível arquivar a meta.'),
    });
  }

  pedirRemocao(meta: Meta): void {
    this.confirmandoRemocaoId.set(meta.id);
  }

  cancelarRemocao(): void {
    this.confirmandoRemocaoId.set(null);
  }

  remover(meta: Meta): void {
    this.service.remover(meta.id).subscribe({
      next: () => {
        this.confirmandoRemocaoId.set(null);
        this.carregar();
      },
      error: () => {
        this.confirmandoRemocaoId.set(null);
        this.erro.set('Não foi possível excluir a meta.');
      },
    });
  }

  // ------------------------------------------------------------ apresentação

  larguraBarra(percentual: number): number {
    return Math.min(Math.max(percentual, 0), 100);
  }

  /** Classe de cor da situação, para barra e etiqueta usarem o mesmo critério. */
  tomDaSituacao(situacao: SituacaoMeta): string {
    switch (situacao) {
      case 'concluida': return 'ok';
      case 'atrasada':
      case 'vencida': return 'alerta';
      default: return 'neutro';
    }
  }
}
