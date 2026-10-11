import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, forkJoin, of } from 'rxjs';
import { Meta } from '../../models/meta.model';
import { Preferencias, SalvarPreferencias, SaudeFinanceira } from '../../models/planejamento.model';
import { MetaService } from '../../services/meta.service';
import { PlanejamentoService } from '../../services/planejamento.service';

// Indicadores de saúde financeira: taxa de poupança, reserva de emergência,
// pague-se primeiro, orçamento base zero e independência financeira.
@Component({
  selector: 'app-plan-saude',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, DecimalPipe],
  templateUrl: './saude.component.html',
  styleUrls: ['./planejamento-comum.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaudeComponent {
  private readonly service = inject(PlanejamentoService);
  private readonly metaService = inject(MetaService);

  readonly ano = input.required<number>();
  readonly mes = input.required<number>();

  readonly saude = signal<SaudeFinanceira | null>(null);
  readonly prefs = signal<Preferencias | null>(null);
  readonly metas = signal<Meta[]>([]);
  readonly erro = signal<string | null>(null);

  readonly percentualReserva = computed(() => {
    const s = this.saude();
    return s && s.reservaAlvo > 0 ? Math.min(100, (s.reservaAtual / s.reservaAlvo) * 100) : 0;
  });

  readonly percentualPagueSe = computed(() => {
    const s = this.saude();
    return s && s.valorPagueSePrimeiro > 0 ? Math.min(100, (s.guardadoNoMes / s.valorPagueSePrimeiro) * 100) : 0;
  });

  readonly percentualIndependencia = computed(() => {
    const s = this.saude();
    return s && s.patrimonioAlvo > 0 ? Math.min(100, (s.patrimonioInvestido / s.patrimonioAlvo) * 100) : 0;
  });

  /** Leitura da taxa de poupança em palavras, pelas faixas usuais. */
  readonly leituraTaxa = computed(() => {
    const t = this.saude()?.taxaPoupanca;
    if (t === null || t === undefined) return null;
    if (t < 0) return { classe: 'negativo', texto: 'Gastou mais do que ganhou neste mês.' };
    if (t < 10) return { classe: 'atencao', texto: 'Abaixo de 10%: pouca folga para imprevistos.' };
    if (t < 20) return { classe: 'atencao', texto: 'Razoável. A referência mais citada é chegar a 20%.' };
    return { classe: 'positivo', texto: 'Ótimo: 20% ou mais da renda ficou com você.' };
  });

  constructor() {
    effect(() => this.carregar(this.ano(), this.mes()));
  }

  private carregar(ano: number, mes: number): void {
    this.erro.set(null);
    forkJoin({
      saude: this.service.saude(ano, mes),
      prefs: this.service.preferencias(),
      metas: this.metaService.listar().pipe(catchError(() => of([] as Meta[]))),
    }).subscribe({
      next: ({ saude, prefs, metas }) => {
        this.saude.set(saude);
        this.prefs.set(prefs);
        this.metas.set(metas);
      },
      error: () => this.erro.set('Não foi possível calcular os indicadores.'),
    });
  }

  salvar(mudanca: SalvarPreferencias): void {
    this.service.salvarPreferencias(mudanca).subscribe({
      next: (p) => {
        this.prefs.set(p);
        this.carregar(this.ano(), this.mes());
      },
      error: (err) => this.erro.set(err?.error?.erro ?? 'Não foi possível salvar.'),
    });
  }

  escolherMetaReserva(id: string): void {
    this.salvar(id ? { metaReservaId: id } : { limparMetaReserva: true });
  }

  numero(valor: unknown): number | null {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
}
