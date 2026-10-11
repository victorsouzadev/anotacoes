import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../shared/icon';
import { AuvpOrcamento } from '../../services/auvp.service';
import {
  AtualizarLoteRequest,
  CATEGORIAS,
  Categoria,
  FORMAS_PAGAMENTO,
  FormaPagamento,
  TipoTransacao,
  Transacao,
} from '../../models/transacao.model';
import { TransacaoService } from '../../services/transacao.service';

/** Cópia editável de um lançamento, enquanto o formulário inline está aberto. */
interface Rascunho {
  descricao: string;
  valor: number;
  tipo: TipoTransacao;
  categoria: Categoria;
  data: string;
  formaPagamento: FormaPagamento | '';
  observacoes: string;
  tags: string[];
  orcamentoAuvp: string;
}

/** Depois de trocar a categoria: oferece levar a mesma aos parecidos. */
interface Sugestao {
  id: string;
  quantidade: number;
  categoriaRotulo: string;
}

@Component({
  selector: 'app-transacoes-lista',
  standalone: true,
  imports: [FormsModule, IconComponent, CurrencyPipe, DatePipe],
  templateUrl: './transacoes-lista.component.html',
  styleUrl: './transacoes-lista.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransacoesListaComponent {
  readonly transacoes = input<Transacao[]>([]);
  /** Emitido quando algo muda no servidor, para o pai recarregar os agregados. */
  readonly alterado = output<void>();
  /** Tags que o usuário tem na AUVP (vazio sem integração). */
  readonly tagsDisponiveis = input<string[]>([]);
  readonly orcamentos = input<AuvpOrcamento[]>([]);

  readonly categorias = CATEGORIAS;
  readonly formasPagamento = FORMAS_PAGAMENTO;

  private readonly service = inject(TransacaoService);

  readonly editandoId = signal<string | null>(null);
  readonly confirmandoExclusaoId = signal<string | null>(null);
  readonly salvandoId = signal<string | null>(null);
  readonly erro = signal<string | null>(null);

  rascunho: Rascunho | null = null;

  readonly total = computed(() => this.transacoes().length);

  /** Aviso de que a AUVP não recebeu a última mudança (a local foi salva). */
  readonly avisoAuvp = signal<string | null>(null);
  readonly sugestao = signal<Sugestao | null>(null);

  // ------------------------------------------------------------ seleção em lote
  readonly selecionados = signal<ReadonlySet<string>>(new Set());
  readonly quantidadeSelecionada = computed(() => this.selecionados().size);
  readonly todosSelecionados = computed(
    () => this.total() > 0 && this.transacoes().every((t) => this.selecionados().has(t.id)),
  );
  readonly aplicandoLote = signal(false);
  loteCategoria: Categoria | '' = '';
  loteOrcamento = '';
  loteTag = '';

  nomeOrcamento(chave: string | null): string | null {
    if (!chave) return null;
    return this.orcamentos().find((o) => o.chave === chave)?.nome ?? chave;
  }

  alternarSelecao(id: string): void {
    this.selecionados.update((s) => {
      const novo = new Set(s);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  alternarTodos(): void {
    this.selecionados.set(this.todosSelecionados() ? new Set() : new Set(this.transacoes().map((t) => t.id)));
  }

  limparSelecao(): void {
    this.selecionados.set(new Set());
    this.loteCategoria = '';
    this.loteOrcamento = '';
    this.loteTag = '';
  }

  aplicarLote(mudanca: Omit<AtualizarLoteRequest, 'ids'>): void {
    const ids = [...this.selecionados()];
    if (ids.length === 0 || this.aplicandoLote()) return;
    this.aplicandoLote.set(true);
    this.erro.set(null);
    this.avisoAuvp.set(null);
    this.service.atualizarLote({ ids, ...mudanca }).subscribe({
      next: (r) => {
        this.aplicandoLote.set(false);
        if (r.falhasAuvp > 0)
          this.avisoAuvp.set(`${r.falhasAuvp} de ${r.atualizados} não atualizaram na AUVP: ${r.primeiraFalhaAuvp}`);
        this.limparSelecao();
        this.alterado.emit();
      },
      error: (err) => {
        this.aplicandoLote.set(false);
        this.erro.set(err?.error?.erro ?? 'Não foi possível alterar os lançamentos.');
      },
    });
  }

  aplicarCategoriaEmLote(): void {
    if (this.loteCategoria) this.aplicarLote({ categoria: this.loteCategoria });
  }

  aplicarOrcamentoEmLote(): void {
    if (this.loteOrcamento === '-') this.aplicarLote({ limparOrcamento: true });
    else if (this.loteOrcamento) this.aplicarLote({ orcamentoAuvp: this.loteOrcamento });
  }

  adicionarTagEmLote(): void {
    if (this.loteTag) this.aplicarLote({ adicionarTags: [this.loteTag] });
  }

  aplicarAosParecidos(): void {
    const s = this.sugestao();
    if (!s) return;
    this.sugestao.set(null);
    this.service.aplicarCategoriaAosParecidos(s.id).subscribe({
      next: (r) => {
        if (r.falhasAuvp > 0)
          this.avisoAuvp.set(`${r.falhasAuvp} de ${r.atualizados} não atualizaram na AUVP: ${r.primeiraFalhaAuvp}`);
        this.alterado.emit();
      },
      error: () => this.erro.set('Não foi possível aplicar aos parecidos.'),
    });
  }

  alternarTagRascunho(tag: string): void {
    if (!this.rascunho) return;
    const tags = this.rascunho.tags;
    this.rascunho.tags = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
  }

  editar(t: Transacao): void {
    this.erro.set(null);
    this.confirmandoExclusaoId.set(null);
    this.editandoId.set(t.id);
    this.rascunho = {
      descricao: t.descricao,
      valor: t.valor,
      tipo: t.tipo,
      categoria: t.categoria,
      data: t.data,
      formaPagamento: t.formaPagamento ?? '',
      observacoes: t.observacoes ?? '',
      tags: [...t.tags],
      orcamentoAuvp: t.orcamentoAuvp ?? '',
    };
  }

  cancelarEdicao(): void {
    this.editandoId.set(null);
    this.rascunho = null;
  }

  salvarEdicao(t: Transacao): void {
    const r = this.rascunho;
    if (!r || this.salvandoId()) return;

    if (!r.descricao.trim()) {
      this.erro.set('A descrição não pode ficar vazia.');
      return;
    }
    if (!(r.valor > 0)) {
      this.erro.set('O valor deve ser maior que zero.');
      return;
    }

    this.salvandoId.set(t.id);
    this.erro.set(null);

    this.service
      .atualizar(t.id, {
        descricao: r.descricao.trim(),
        valor: r.valor,
        tipo: r.tipo,
        categoria: r.categoria,
        data: r.data,
        // String vazia significa "limpar"; a flag é o único jeito de expressar
        // isso, porque `null` no PATCH quer dizer "não alterar".
        formaPagamento: r.formaPagamento === '' ? undefined : r.formaPagamento,
        limparFormaPagamento: r.formaPagamento === '',
        observacoes: r.observacoes.trim(),
        // Só manda o que mudou: cada um vira uma escrita na AUVP.
        tags: mesmaLista(r.tags, t.tags) ? undefined : r.tags,
        orcamentoAuvp: r.orcamentoAuvp && r.orcamentoAuvp !== t.orcamentoAuvp ? r.orcamentoAuvp : undefined,
        limparOrcamento: !r.orcamentoAuvp && !!t.orcamentoAuvp ? true : undefined,
      })
      .subscribe({
        next: (resp) => {
          this.salvandoId.set(null);
          this.cancelarEdicao();
          this.avisoAuvp.set(resp.avisoAuvp ?? null);
          this.sugestao.set(
            resp.semelhantes ? { id: resp.id, quantidade: resp.semelhantes, categoriaRotulo: resp.categoriaRotulo } : null,
          );
          this.alterado.emit();
        },
        error: (err) => {
          this.salvandoId.set(null);
          this.erro.set(err?.error?.erro ?? 'Não foi possível salvar a alteração.');
        },
      });
  }

  confirmar(t: Transacao): void {
    this.salvandoId.set(t.id);
    this.service.atualizar(t.id, { status: 'Confirmado' }).subscribe({
      next: () => {
        this.salvandoId.set(null);
        this.alterado.emit();
      },
      error: () => {
        this.salvandoId.set(null);
        this.erro.set('Não foi possível confirmar o lançamento.');
      },
    });
  }

  alternarTotais(t: Transacao): void {
    this.salvandoId.set(t.id);
    this.erro.set(null);
    this.service.atualizar(t.id, { foraDosTotais: !t.foraDosTotais }).subscribe({
      next: (resp) => {
        this.salvandoId.set(null);
        this.avisoAuvp.set(resp.avisoAuvp ?? null);
        this.alterado.emit();
      },
      error: () => {
        this.salvandoId.set(null);
        this.erro.set('Não foi possível alterar o lançamento.');
      },
    });
  }

  pedirConfirmacaoExclusao(t: Transacao): void {
    this.erro.set(null);
    this.confirmandoExclusaoId.set(t.id);
  }

  cancelarExclusao(): void {
    this.confirmandoExclusaoId.set(null);
  }

  remover(t: Transacao): void {
    this.salvandoId.set(t.id);
    this.service.remover(t.id).subscribe({
      next: () => {
        this.salvandoId.set(null);
        this.confirmandoExclusaoId.set(null);
        this.alterado.emit();
      },
      error: () => {
        this.salvandoId.set(null);
        this.confirmandoExclusaoId.set(null);
        this.erro.set('Não foi possível excluir o lançamento.');
      },
    });
  }

  /** A confiança da IA vira um rótulo curto, mais útil que o número cru. */
  rotuloConfianca(valor: number): string {
    if (valor >= 0.8) return 'alta';
    if (valor >= 0.6) return 'média';
    return 'baixa';
  }

  idDe = (_: number, t: Transacao) => t.id;
}

function mesmaLista(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}
