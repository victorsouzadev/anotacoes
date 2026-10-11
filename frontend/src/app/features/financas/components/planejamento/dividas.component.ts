import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Divida, SimulacaoDividas } from '../../models/planejamento.model';
import { PlanejamentoService } from '../../services/planejamento.service';

// Cadastro de dívidas e a comparação bola de neve × avalanche.
@Component({
  selector: 'app-plan-dividas',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, DecimalPipe],
  templateUrl: './dividas.component.html',
  styleUrls: ['./planejamento-comum.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DividasComponent {
  private readonly service = inject(PlanejamentoService);

  readonly dividas = signal<Divida[]>([]);
  readonly simulacao = signal<SimulacaoDividas | null>(null);
  readonly erro = signal<string | null>(null);
  readonly editandoId = signal<string | null>(null);
  readonly formAberto = signal(false);
  extra = 0;

  form = { nome: '', saldo: null as number | null, jurosMensal: null as number | null, parcelaMinima: null as number | null };

  constructor() {
    this.carregar();
  }

  carregar(): void {
    this.service.dividas().subscribe({
      next: (d) => {
        this.dividas.set(d);
        this.simular();
      },
      error: () => this.erro.set('Não foi possível carregar as dívidas.'),
    });
  }

  simular(): void {
    if (this.dividas().length === 0) {
      this.simulacao.set(null);
      return;
    }
    this.service.simularDividas(Math.max(0, Number(this.extra) || 0)).subscribe((s) => this.simulacao.set(s));
  }

  novo(): void {
    this.form = { nome: '', saldo: null, jurosMensal: null, parcelaMinima: null };
    this.editandoId.set(null);
    this.formAberto.set(true);
  }

  editar(d: Divida): void {
    this.form = { nome: d.nome, saldo: d.saldo, jurosMensal: d.jurosMensal, parcelaMinima: d.parcelaMinima };
    this.editandoId.set(d.id);
    this.formAberto.set(true);
  }

  salvar(): void {
    const f = this.form;
    const corpo = {
      nome: f.nome.trim(),
      saldo: Number(f.saldo),
      jurosMensal: Number(f.jurosMensal ?? 0),
      parcelaMinima: Number(f.parcelaMinima ?? 0),
    };
    const id = this.editandoId();
    (id ? this.service.atualizarDivida(id, corpo) : this.service.criarDivida(corpo)).subscribe({
      next: () => {
        this.formAberto.set(false);
        this.erro.set(null);
        this.carregar();
      },
      error: (err) => this.erro.set(err?.error?.erro ?? 'Não foi possível salvar.'),
    });
  }

  remover(d: Divida): void {
    if (!confirm(`Remover "${d.nome}"?`)) return;
    this.service.removerDivida(d.id).subscribe(() => this.carregar());
  }

  totalSaldo(): number {
    return this.dividas().reduce((s, d) => s + d.saldo, 0);
  }

  anos(meses: number): string {
    if (meses < 12) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
    const a = Math.floor(meses / 12);
    const m = meses % 12;
    return `${a} ${a === 1 ? 'ano' : 'anos'}${m ? ` e ${m} ${m === 1 ? 'mês' : 'meses'}` : ''}`;
  }
}
