import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../shared/icon';
import {
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

  readonly categorias = CATEGORIAS;
  readonly formasPagamento = FORMAS_PAGAMENTO;

  private readonly service = inject(TransacaoService);

  readonly editandoId = signal<string | null>(null);
  readonly confirmandoExclusaoId = signal<string | null>(null);
  readonly salvandoId = signal<string | null>(null);
  readonly erro = signal<string | null>(null);

  rascunho: Rascunho | null = null;

  readonly total = computed(() => this.transacoes().length);

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
      })
      .subscribe({
        next: () => {
          this.salvandoId.set(null);
          this.cancelarEdicao();
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
