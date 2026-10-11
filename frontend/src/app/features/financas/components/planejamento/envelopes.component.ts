import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Envelope } from '../../models/planejamento.model';
import { PlanejamentoService } from '../../services/planejamento.service';

// Orçamento em envelopes: o que sobra em cada categoria acumula para o mês seguinte.
@Component({
  selector: 'app-plan-envelopes',
  standalone: true,
  imports: [CurrencyPipe],
  templateUrl: './envelopes.component.html',
  styleUrls: ['./planejamento-comum.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnvelopesComponent {
  private readonly service = inject(PlanejamentoService);

  readonly ano = input.required<number>();
  readonly mes = input.required<number>();

  readonly envelopes = signal<Envelope[] | null>(null);
  readonly erro = signal<string | null>(null);
  readonly total = computed(() => (this.envelopes() ?? []).reduce((s, e) => s + e.saldoAcumulado, 0));

  constructor() {
    effect(() => {
      const ano = this.ano();
      const mes = this.mes();
      this.service.envelopes(ano, mes).subscribe({
        next: (e) => this.envelopes.set(e),
        error: () => this.erro.set('Não foi possível calcular os envelopes.'),
      });
    });
  }
}
