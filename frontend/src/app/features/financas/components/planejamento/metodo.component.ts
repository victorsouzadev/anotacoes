import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { METODOS, MetodoDivisao, MetodoResposta } from '../../models/planejamento.model';
import { PlanejamentoService } from '../../services/planejamento.service';

// Divisão da renda em fatias: quanto cada fatia deveria receber e quanto recebeu.
@Component({
  selector: 'app-plan-metodo',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, DecimalPipe],
  templateUrl: './metodo.component.html',
  styleUrls: ['./planejamento-comum.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetodoComponent {
  private readonly service = inject(PlanejamentoService);

  readonly ano = input.required<number>();
  readonly mes = input.required<number>();

  readonly metodos = METODOS;
  readonly dados = signal<MetodoResposta | null>(null);
  readonly erro = signal<string | null>(null);

  constructor() {
    effect(() => this.carregar(this.ano(), this.mes()));
  }

  private carregar(ano: number, mes: number, metodo?: MetodoDivisao): void {
    this.service.metodo(ano, mes, metodo).subscribe({
      next: (d) => this.dados.set(d),
      error: () => this.erro.set('Não foi possível calcular a divisão.'),
    });
  }

  /** Trocar o método também vira a preferência — é o que o dashboard passa a usar. */
  trocar(metodo: MetodoDivisao): void {
    this.service.salvarPreferencias({ metodo }).subscribe();
    this.carregar(this.ano(), this.mes(), metodo);
  }

  /** Poupança abaixo do planejado é ruim; gasto acima do planejado é ruim. */
  classe(chave: string, utilizado: number): string {
    const ehPoupanca = ['poupanca', 'liberdade', 'metas', 'longo-prazo'].includes(chave);
    if (ehPoupanca) return utilizado >= 100 ? '' : utilizado >= 50 ? 'atencao' : 'negativo';
    return utilizado > 100 ? 'negativo' : utilizado >= 85 ? 'atencao' : '';
  }
}
