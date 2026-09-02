import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { IconComponent } from '../../../../shared/icon';
import {
  Acompanhamento,
  CategoriaOrcavel,
  GrupoCategoria,
  ModeloOrcamento,
  Orcamento,
  ROTULO_GRUPO,
} from '../../models/orcamento.model';
import { Categoria } from '../../models/transacao.model';
import { OrcamentoService } from '../../services/orcamento.service';
import { Tom, exportarOrcamentoPng } from '../../orcamento-imagem';
import {
  LinhaDistribuicao,
  ajustarParaCem,
  distribuicaoFechada,
  limitarPercentual,
  percentualDoValor,
  restanteParaCem,
  somaPercentuais,
  valorDaLinha,
} from './distribuicao';

const ORDEM_GRUPOS: GrupoCategoria[] = ['Essenciais', 'EstiloDeVida', 'Futuro'];

/** O diagnóstico da tela em termos das cores do cartão exportado. */
const TOM_DO_DIAGNOSTICO: Record<'ok' | 'atencao' | 'estourado', Tom> = {
  ok: 'positivo',
  atencao: 'atencao',
  estourado: 'negativo',
};

@Component({
  selector: 'app-orcamento',
  standalone: true,
  imports: [FormsModule, IconComponent, CurrencyPipe, DecimalPipe],
  templateUrl: './orcamento.component.html',
  styleUrl: './orcamento.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrcamentoComponent {
  readonly ano = input.required<number>();
  readonly mes = input.required<number>();
  /** Avisa o pai para recarregar o dashboard quando o orçamento muda. */
  readonly alterado = output<void>();

  private readonly service = inject(OrcamentoService);

  readonly carregando = signal(true);
  readonly salvando = signal(false);
  readonly erro = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  readonly orcamento = signal<Orcamento | null>(null);
  readonly acompanhamento = signal<Acompanhamento | null>(null);
  readonly modelos = signal<ModeloOrcamento[]>([]);
  readonly categoriasDisponiveis = signal<CategoriaOrcavel[]>([]);

  readonly exportandoImagem = signal(false);

  readonly editando = signal(false);
  readonly confirmandoRemocao = signal(false);

  /** Rascunho da distribuição; só existe enquanto o formulário está aberto. */
  readonly linhas = signal<LinhaDistribuicao[]>([]);
  valorTotal = 0;
  observacoes = '';
  categoriaParaAdicionar: Categoria | '' = '';

  readonly rotuloGrupo = ROTULO_GRUPO;

  readonly somaPercentual = computed(() => somaPercentuais(this.linhas()));
  readonly restanteParaCem = computed(() => restanteParaCem(this.linhas()));
  readonly distribuicaoFechada = computed(() => distribuicaoFechada(this.linhas()));

  readonly categoriasNaoUsadas = computed(() => {
    const usadas = new Set(this.linhas().map((l) => l.categoria));
    return this.categoriasDisponiveis().filter((c) => !usadas.has(c.categoria));
  });

  /** Agrupa o rascunho por grupo, para o formulário mostrar subtotais. */
  readonly linhasPorGrupo = computed(() =>
    ORDEM_GRUPOS.map((grupo) => {
      const itens = this.linhas().filter((l) => l.grupo === grupo);
      return {
        grupo,
        rotulo: ROTULO_GRUPO[grupo],
        itens,
        percentual: somaPercentuais(itens),
      };
    }).filter((g) => g.itens.length > 0),
  );

  readonly nomeDoMes = computed(() =>
    new Date(this.ano(), this.mes() - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  );

  constructor() {
    effect(() => {
      // Reage à troca de mês feita no cabeçalho da página.
      this.ano();
      this.mes();
      this.carregar();
    });
  }

  // ------------------------------------------------------------- carregamento

  private carregar(): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.editando.set(false);
    this.confirmandoRemocao.set(false);

    forkJoin({
      orcamento: this.service.atual(this.ano(), this.mes()),
      acompanhamento: this.service.acompanhamento(this.ano(), this.mes()),
      categorias: this.service.categorias(),
    }).subscribe({
      next: ({ orcamento, acompanhamento, categorias }) => {
        this.orcamento.set(orcamento);
        this.acompanhamento.set(acompanhamento);
        this.categoriasDisponiveis.set(categorias);
        this.carregando.set(false);
      },
      error: () => {
        this.carregando.set(false);
        this.erro.set('Não foi possível carregar o orçamento. Tente novamente.');
      },
    });
  }

  // ------------------------------------------------------------------ edição

  abrirEdicao(): void {
    const atual = this.orcamento();
    this.erro.set(null);
    this.aviso.set(null);
    this.valorTotal = atual?.valorTotal ?? 0;
    this.observacoes = atual?.observacoes ?? '';
    this.linhas.set(
      (atual?.itens ?? []).map((i) => ({
        categoria: i.categoria,
        rotulo: i.categoriaRotulo,
        grupo: i.grupo,
        percentual: i.percentual,
      })),
    );
    this.editando.set(true);
    this.carregarModelos();
  }

  fecharEdicao(): void {
    this.editando.set(false);
    this.linhas.set([]);
    this.erro.set(null);
  }

  private carregarModelos(): void {
    this.service.modelos(this.valorTotal > 0 ? this.valorTotal : 1000).subscribe({
      next: (modelos) => this.modelos.set(modelos),
      error: () => this.modelos.set([]),
    });
  }

  aplicarModelo(modelo: ModeloOrcamento): void {
    this.linhas.set(
      modelo.itens.map((i) => ({
        categoria: i.categoria,
        rotulo: i.categoriaRotulo,
        grupo: i.grupo,
        percentual: i.percentual,
      })),
    );
    this.aviso.set(`Modelo "${modelo.nome}" aplicado. Ajuste como quiser antes de salvar.`);
  }

  adicionarCategoria(): void {
    const escolhida = this.categoriaParaAdicionar;
    if (!escolhida) return;

    const info = this.categoriasDisponiveis().find((c) => c.categoria === escolhida);
    if (!info) return;

    // A categoria nova entra com o que sobrou para fechar 100%, que é quase
    // sempre o que se quer ao adicionar a última fatia.
    const sobra = Math.max(this.restanteParaCem(), 0);
    this.linhas.update((atual) => [
      ...atual,
      { categoria: info.categoria, rotulo: info.rotulo, grupo: info.grupo, percentual: sobra },
    ]);
    this.categoriaParaAdicionar = '';
  }

  removerLinha(categoria: Categoria): void {
    this.linhas.update((atual) => atual.filter((l) => l.categoria !== categoria));
  }

  aoMudarPercentual(categoria: Categoria, valor: number): void {
    const limitado = limitarPercentual(valor);
    this.linhas.update((atual) =>
      atual.map((l) => (l.categoria === categoria ? { ...l, percentual: limitado } : l)),
    );
  }

  /** Permite digitar diretamente em reais; o percentual é recalculado. */
  aoMudarValor(categoria: Categoria, valorEmReais: number): void {
    this.aoMudarPercentual(categoria, percentualDoValor(this.valorTotal, valorEmReais));
  }

  valorDaLinha(linha: LinhaDistribuicao): number {
    return valorDaLinha(this.valorTotal, linha.percentual);
  }

  /** Divide o que falta (ou sobra) igualmente entre as categorias do rascunho. */
  ajustarParaCem(): void {
    this.linhas.set(ajustarParaCem(this.linhas()));
  }

  salvar(): void {
    if (this.salvando()) return;

    if (!(this.valorTotal > 0)) {
      this.erro.set('Informe o valor total do mês.');
      return;
    }
    if (this.linhas().length === 0) {
      this.erro.set('Adicione ao menos uma categoria à distribuição.');
      return;
    }
    if (!this.distribuicaoFechada()) {
      const r = this.restanteParaCem();
      this.erro.set(r > 0 ? `Ainda faltam ${r}% para fechar 100%.` : `A distribuição passou de 100% em ${-r}%.`);
      return;
    }

    this.salvando.set(true);
    this.erro.set(null);

    this.service
      .salvar({
        ano: this.ano(),
        mes: this.mes(),
        valorTotal: this.valorTotal,
        itens: this.linhas().map((l) => ({ categoria: l.categoria, percentual: l.percentual })),
        observacoes: this.observacoes.trim() || null,
      })
      .subscribe({
        next: () => {
          this.salvando.set(false);
          this.fecharEdicao();
          this.carregar();
          this.alterado.emit();
        },
        error: (err) => {
          this.salvando.set(false);
          this.erro.set(err?.error?.erro ?? 'Não foi possível salvar o orçamento.');
        },
      });
  }

  copiarDoMesAnterior(): void {
    const { ano, mes } = this.mesAnterior();
    this.salvando.set(true);
    this.erro.set(null);

    this.service.copiar(ano, mes, this.ano(), this.mes(), null).subscribe({
      next: () => {
        this.salvando.set(false);
        this.carregar();
        this.alterado.emit();
      },
      error: (err) => {
        this.salvando.set(false);
        this.erro.set(err?.error?.erro ?? 'Não foi possível copiar o orçamento.');
      },
    });
  }

  remover(): void {
    this.salvando.set(true);
    this.service.remover(this.ano(), this.mes()).subscribe({
      next: () => {
        this.salvando.set(false);
        this.confirmandoRemocao.set(false);
        this.carregar();
        this.alterado.emit();
      },
      error: () => {
        this.salvando.set(false);
        this.confirmandoRemocao.set(false);
        this.erro.set('Não foi possível excluir o orçamento.');
      },
    });
  }

  // ---------------------------------------------------------------- imagem

  /**
   * Exporta o acompanhamento como PNG. O trabalho é do módulo orcamento-imagem;
   * aqui só entram os dados da tela e o estado do botão.
   */
  async exportarImagem(): Promise<void> {
    const orcamento = this.orcamento();
    const acompanhamento = this.acompanhamento();
    if (!orcamento || !acompanhamento || this.exportandoImagem()) return;

    this.exportandoImagem.set(true);
    this.erro.set(null);

    try {
      const d = this.diagnostico();
      await exportarOrcamentoPng({
        nomeDoMes: this.nomeDoMes(),
        orcamento,
        acompanhamento,
        diagnostico: d ? { tom: TOM_DO_DIAGNOSTICO[d.tom], texto: d.texto } : null,
        geradoEm: new Date(),
      });
    } catch {
      this.erro.set('Não foi possível gerar a imagem do orçamento neste navegador.');
    } finally {
      this.exportandoImagem.set(false);
    }
  }

  private mesAnterior(): { ano: number; mes: number } {
    return this.mes() === 1 ? { ano: this.ano() - 1, mes: 12 } : { ano: this.ano(), mes: this.mes() - 1 };
  }

  // ------------------------------------------------------------ apresentação

  /** Barra de progresso: passa de 100% vira 100% cheio, com cor de estouro. */
  larguraBarra(percentual: number): number {
    return Math.min(Math.max(percentual, 0), 100);
  }

  /** O ritmo de gasto comparado ao ritmo do calendário. */
  readonly diagnostico = computed(() => {
    const a = this.acompanhamento();
    if (!a || !a.temOrcamento || a.valorTotal <= 0) return null;

    if (a.totalRealizado > a.valorTotal) {
      return { tom: 'estourado' as const, texto: 'O mês já passou do orçamento planejado.' };
    }
    if (a.percentualDoMesDecorrido <= 0) {
      return { tom: 'ok' as const, texto: 'O mês ainda não começou.' };
    }
    if (a.percentualDoMesDecorrido >= 100) {
      return { tom: 'ok' as const, texto: 'Mês encerrado dentro do orçamento.' };
    }
    if (a.percentualUtilizado > a.percentualDoMesDecorrido + 10) {
      return {
        tom: 'atencao' as const,
        texto: `Ritmo acima do esperado: ${a.percentualUtilizado.toFixed(0)}% gasto com ${a.percentualDoMesDecorrido.toFixed(0)}% do mês.`,
      };
    }
    return { tom: 'ok' as const, texto: 'Gasto dentro do ritmo do mês.' };
  });
}
