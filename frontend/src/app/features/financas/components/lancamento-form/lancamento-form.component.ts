import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TransacaoService } from '../../services/transacao.service';
import { Transacao } from '../../models/transacao.model';

@Component({
  selector: 'app-lancamento-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './lancamento-form.component.html',
  styleUrl: './lancamento-form.component.css',
})
export class LancamentoFormComponent {
  @Output() lancamentoCriado = new EventEmitter<Transacao>();

  texto = '';
  enviando = false;
  erro: string | null = null;
  ultimoLancamento: Transacao | null = null;

  exemplos = [
    'gastei 45 reais no mercado hoje',
    'recebi 3000 de salário dia 05/07',
    'paguei 120 de conta de luz ontem',
    'almoço 32,50',
  ];

  constructor(
    private readonly transacaoService: TransacaoService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  usarExemplo(exemplo: string): void {
    this.texto = exemplo;
  }

  registrar(): void {
    const texto = this.texto.trim();
    if (!texto || this.enviando) {
      return;
    }

    this.enviando = true;
    this.erro = null;
    this.ultimoLancamento = null;

    this.transacaoService.criar({ texto }).subscribe({
      next: (transacao) => {
        this.enviando = false;
        this.texto = '';
        this.ultimoLancamento = transacao;
        this.cdr.markForCheck();
        this.lancamentoCriado.emit(transacao);
      },
      error: (err) => {
        this.enviando = false;
        this.erro =
          err?.error?.erro ??
          'Não foi possível interpretar esse lançamento. Tente descrever de outra forma.';
        this.cdr.markForCheck();
      },
    });
  }
}
