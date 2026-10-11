import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Fechamento } from '../../models/planejamento.model';
import { PlanejamentoService } from '../../services/planejamento.service';

// Fechamento do mês no método Kakeibo: os números do mês e as quatro perguntas.
@Component({
  selector: 'app-plan-fechamento',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, DatePipe, DecimalPipe],
  templateUrl: './fechamento.component.html',
  styleUrls: ['./planejamento-comum.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FechamentoComponent {
  private readonly service = inject(PlanejamentoService);

  readonly ano = input.required<number>();
  readonly mes = input.required<number>();

  readonly dados = signal<Fechamento | null>(null);
  readonly erro = signal<string | null>(null);
  readonly salvo = signal(false);
  readonly salvando = signal(false);

  metaPoupanca: number | null = null;
  reflexao = '';
  compromisso = '';

  constructor() {
    effect(() => {
      const ano = this.ano();
      const mes = this.mes();
      this.salvo.set(false);
      this.service.fechamento(ano, mes).subscribe({
        next: (f) => this.preencher(f),
        error: () => this.erro.set('Não foi possível carregar o fechamento.'),
      });
    });
  }

  private preencher(f: Fechamento): void {
    this.dados.set(f);
    this.metaPoupanca = f.metaPoupanca;
    this.reflexao = f.reflexao ?? '';
    this.compromisso = f.compromisso ?? '';
  }

  salvar(): void {
    this.salvando.set(true);
    this.service
      .salvarFechamento(this.ano(), this.mes(), {
        metaPoupanca: this.metaPoupanca === null || (this.metaPoupanca as unknown) === '' ? null : Number(this.metaPoupanca),
        reflexao: this.reflexao,
        compromisso: this.compromisso,
      })
      .subscribe({
        next: (f) => {
          this.preencher(f);
          this.salvando.set(false);
          this.salvo.set(true);
        },
        error: (err) => {
          this.salvando.set(false);
          this.erro.set(err?.error?.erro ?? 'Não foi possível salvar.');
        },
      });
  }

  variacao(valor: number, anterior: number): number | null {
    return anterior > 0 ? ((valor - anterior) / anterior) * 100 : null;
  }
}
