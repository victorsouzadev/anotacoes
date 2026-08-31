import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CurrencyPipe } from '@angular/common';
import { Transacao } from '../../models/transacao.model';
import { TransacaoService } from '../../services/transacao.service';

@Component({
  selector: 'app-lancamento-form',
  standalone: true,
  imports: [FormsModule, CurrencyPipe],
  templateUrl: './lancamento-form.component.html',
  styleUrl: './lancamento-form.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LancamentoFormComponent {
  readonly lancamentoCriado = output<Transacao>();

  private readonly service = inject(TransacaoService);

  texto = '';
  readonly enviando = signal(false);
  readonly erro = signal<string | null>(null);
  readonly ultimoLancamento = signal<Transacao | null>(null);

  readonly exemplos = [
    'gastei 45 reais no mercado hoje',
    'recebi 3000 de salário dia 05/07',
    'paguei 120 de conta de luz ontem',
    'almoço 32,50',
  ];

  usarExemplo(exemplo: string): void {
    this.texto = exemplo;
  }

  registrar(): void {
    const texto = this.texto.trim();
    if (!texto || this.enviando()) return;

    this.enviando.set(true);
    this.erro.set(null);
    this.ultimoLancamento.set(null);

    this.service.criar({ texto }).subscribe({
      next: (transacao) => {
        this.enviando.set(false);
        this.texto = '';
        this.ultimoLancamento.set(transacao);
        this.lancamentoCriado.emit(transacao);
      },
      error: (err) => {
        this.enviando.set(false);
        this.erro.set(this.mensagemDeErro(err));
      },
    });
  }

  // 502 é falha do serviço de interpretação, não do texto: dizer "não entendi"
  // aqui mandaria o usuário reescrever um texto que estava correto.
  private mensagemDeErro(err: { status?: number; error?: { erro?: string; detail?: string } }): string {
    if (err?.status === 502 || err?.status === 503) {
      return 'O serviço de interpretação está indisponível no momento. Tente de novo em instantes.';
    }
    if (err?.status === 429) {
      return 'Muitos lançamentos seguidos. Aguarde um minuto antes de tentar de novo.';
    }
    return (
      err?.error?.erro ??
      'Não foi possível interpretar esse lançamento. Tente descrever de outra forma.'
    );
  }
}
