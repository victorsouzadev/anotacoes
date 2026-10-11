import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { AuvpOrcamentoMes, AuvpService } from '../../services/auvp.service';

// O orçamento como está na AUVP (método Custos Fixos, Conforto, Metas…), lido ao
// vivo. Fica ao lado do orçamento por categoria daqui, não no lugar dele.
@Component({
  selector: 'app-orcamento-auvp',
  standalone: true,
  imports: [CurrencyPipe, DecimalPipe],
  templateUrl: './orcamento-auvp.component.html',
  styleUrl: './orcamento-auvp.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrcamentoAuvpComponent {
  private readonly auvp = inject(AuvpService);

  readonly ano = input.required<number>();
  readonly mes = input.required<number>();

  readonly dados = signal<AuvpOrcamentoMes | null>(null);
  readonly erro = signal<string | null>(null);

  constructor() {
    effect(() => {
      const ano = this.ano();
      const mes = this.mes();
      this.erro.set(null);
      this.auvp.orcamentoMensal(ano, mes).subscribe({
        next: (d) => this.dados.set(d),
        error: (err) => {
          this.dados.set(null);
          this.erro.set(err?.error?.detail ?? err?.error?.erro ?? 'Não foi possível ler o orçamento da AUVP.');
        },
      });
    });
  }

  situacao(utilizado: number): 'ok' | 'atencao' | 'estourado' {
    return utilizado > 100 ? 'estourado' : utilizado >= 80 ? 'atencao' : 'ok';
  }
}
