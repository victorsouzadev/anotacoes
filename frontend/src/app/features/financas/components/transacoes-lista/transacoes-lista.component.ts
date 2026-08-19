import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Input, OnChanges } from '@angular/core';
import { IconComponent } from '../../../../shared/icon';
import { Transacao } from '../../models/transacao.model';
import { TransacaoService } from '../../services/transacao.service';

@Component({
  selector: 'app-transacoes-lista',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './transacoes-lista.component.html',
  styleUrl: './transacoes-lista.component.css',
})
export class TransacoesListaComponent implements OnChanges {
  @Input() transacoes: Transacao[] = [];

  removendoId: string | null = null;

  constructor(
    private readonly transacaoService: TransacaoService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnChanges(): void {
    // Mantém a lista ordenada por data mais recente primeiro, caso o pai
    // não garanta a ordenação (ex.: após inserir um novo item no topo).
    this.transacoes = [...this.transacoes].sort((a, b) => (a.data < b.data ? 1 : -1));
  }

  confirmar(transacao: Transacao): void {
    this.transacaoService
      .atualizar(transacao.id, { status: 'Confirmado' })
      .subscribe((atualizada) => {
        transacao.status = atualizada.status;
        this.cdr.markForCheck();
      });
  }

  remover(transacao: Transacao): void {
    this.removendoId = transacao.id;
    this.transacaoService.remover(transacao.id).subscribe({
      next: () => {
        this.transacoes = this.transacoes.filter((t) => t.id !== transacao.id);
        this.removendoId = null;
        this.cdr.markForCheck();
      },
      error: () => {
        this.removendoId = null;
        this.cdr.markForCheck();
      },
    });
  }
}
