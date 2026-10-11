import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Provisao, Provisoes } from '../../models/planejamento.model';
import { PlanejamentoService } from '../../services/planejamento.service';

export const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro',
  'outubro', 'novembro', 'dezembro'];

// Gastos anuais previsíveis guardados aos poucos (sinking funds).
@Component({
  selector: 'app-plan-provisoes',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, DatePipe],
  templateUrl: './provisoes.component.html',
  styleUrls: ['./planejamento-comum.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProvisoesComponent {
  private readonly service = inject(PlanejamentoService);

  readonly dados = signal<Provisoes | null>(null);
  readonly erro = signal<string | null>(null);
  readonly formAberto = signal(false);
  readonly editandoId = signal<string | null>(null);
  readonly meses = NOMES_MES;

  form = { nome: '', valor: null as number | null, mesVencimento: 1, valorReservado: 0 as number | null };

  readonly sugestoes = ['IPVA', 'IPTU', 'Seguro do carro', 'Material escolar', 'Presentes de fim de ano', 'Viagem de férias'];

  constructor() {
    this.carregar();
  }

  carregar(): void {
    this.service.provisoes().subscribe({
      next: (d) => this.dados.set(d),
      error: () => this.erro.set('Não foi possível carregar.'),
    });
  }

  novo(nome = ''): void {
    this.form = { nome, valor: null, mesVencimento: 1, valorReservado: 0 };
    this.editandoId.set(null);
    this.formAberto.set(true);
  }

  editar(p: Provisao): void {
    this.form = { nome: p.nome, valor: p.valor, mesVencimento: p.mesVencimento, valorReservado: p.valorReservado };
    this.editandoId.set(p.id);
    this.formAberto.set(true);
  }

  salvar(): void {
    const corpo = {
      nome: this.form.nome.trim(),
      valor: Number(this.form.valor),
      mesVencimento: Number(this.form.mesVencimento),
      valorReservado: Number(this.form.valorReservado ?? 0),
    };
    const id = this.editandoId();
    (id ? this.service.atualizarProvisao(id, corpo) : this.service.criarProvisao(corpo)).subscribe({
      next: () => {
        this.formAberto.set(false);
        this.erro.set(null);
        this.carregar();
      },
      error: (err) => this.erro.set(err?.error?.erro ?? 'Não foi possível salvar.'),
    });
  }

  /** Registra o depósito do mês (1/12) ou zera depois de pagar. */
  ajustarReserva(p: Provisao, novoValor: number): void {
    this.service
      .atualizarProvisao(p.id, { nome: p.nome, valor: p.valor, mesVencimento: p.mesVencimento, valorReservado: Math.max(0, novoValor) })
      .subscribe(() => this.carregar());
  }

  remover(p: Provisao): void {
    if (!confirm(`Remover "${p.nome}"?`)) return;
    this.service.removerProvisao(p.id).subscribe(() => this.carregar());
  }

  rotuloSituacao(s: Provisao['situacao']): string {
    return s === 'completa' ? 'completa' : s === 'em-dia' ? 'em dia' : 'atrasada';
  }

  classeSituacao(s: Provisao['situacao']): string {
    return s === 'atrasada' ? 'ruim' : 'ok';
  }
}
