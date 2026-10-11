import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import {
  AtualizarLoteRequest,
  CATEGORIAS,
  Categoria,
  FilaCategorizacao,
  GrupoPendente,
} from '../../models/transacao.model';
import { TransacaoService } from '../../services/transacao.service';

type Escopo = 'mes' | 'tudo';

// Fila de categorização: um cartão por loja ainda sem categoria, com sugestão e
// um clique por categoria. Cada escolha vale para todos os lançamentos do grupo,
// vira regra para os próximos e vai para a AUVP quando o lançamento veio de lá.
@Component({
  selector: 'app-categorizar',
  standalone: true,
  imports: [CurrencyPipe, DatePipe, DecimalPipe],
  templateUrl: './categorizar.component.html',
  styleUrl: './categorizar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategorizarComponent {
  private readonly service = inject(TransacaoService);

  readonly ano = input.required<number>();
  readonly mes = input.required<number>();
  /** Algo foi categorizado: a página recarrega o painel e o contador da aba. */
  readonly alterado = output<void>();

  readonly categorias = CATEGORIAS;
  readonly escopo = signal<Escopo>('mes');
  readonly fila = signal<FilaCategorizacao | null>(null);
  readonly ocupado = signal<string | null>(null);
  readonly erro = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  constructor() {
    effect(() => this.carregar(this.escopo(), this.ano(), this.mes()));
  }

  private carregar(escopo: Escopo, ano: number, mes: number): void {
    this.erro.set(null);
    const req = escopo === 'mes' ? this.service.categorizar(ano, mes) : this.service.categorizar();
    req.subscribe({
      next: (f) => this.fila.set(f),
      error: () => this.erro.set('Não foi possível carregar o que falta categorizar.'),
    });
  }

  /** Categorias oferecidas para o grupo: receita mostra Salário/Investimentos primeiro. */
  /** Receita só pode ser salário ou rendimento; despesa, qualquer categoria de gasto. */
  opcoes(g: GrupoPendente): { valor: Categoria; rotulo: string }[] {
    const lista = this.categorias.filter((c) => c.valor !== 'Outros' && c.valor !== g.sugestao);
    return g.tipo === 'receita'
      ? lista.filter((c) => c.valor === 'Salario' || c.valor === 'Investimentos')
      : lista.filter((c) => c.valor !== 'Salario');
  }

  categorizar(g: GrupoPendente, categoria: Categoria): void {
    const rotulo = this.categorias.find((c) => c.valor === categoria)?.rotulo ?? categoria;
    this.aplicar(g, { categoria },
      categoria === 'Outros'
        ? `${g.quantidade === 1 ? 'Mantido' : 'Mantidos'} em Outros.`
        : `${g.quantidade} ${g.quantidade === 1 ? 'lançamento' : 'lançamentos'} → ${rotulo}. Os próximos dessa loja já entram assim.`);
  }

  naoEGasto(g: GrupoPendente): void {
    this.aplicar(g, { foraDosTotais: true }, `${g.descricao} saiu dos totais (transferência, reembolso…).`);
  }

  private aplicar(g: GrupoPendente, mudanca: Omit<AtualizarLoteRequest, 'ids'>, mensagem: string): void {
    if (this.ocupado()) return;
    this.ocupado.set(g.chave + g.tipo);
    this.erro.set(null);
    this.service.atualizarLote({ ids: g.ids, ...mudanca }).subscribe({
      next: (r) => {
        this.ocupado.set(null);
        // Tira o grupo na hora, sem esperar a fila recarregar.
        this.fila.update((f) =>
          f
            ? {
                ...f,
                grupos: f.grupos.filter((x) => x !== g),
                pendentes: Math.max(0, f.pendentes - g.quantidade),
                pendentesHistorico: Math.max(0, f.pendentesHistorico - g.quantidade),
                percentual: f.total ? Math.min(100, ((f.total - Math.max(0, f.pendentes - g.quantidade)) / f.total) * 100) : 100,
              }
            : f,
        );
        this.aviso.set(r.falhasAuvp > 0 ? `${mensagem} (A AUVP não recebeu: ${r.primeiraFalhaAuvp})` : mensagem);
        this.alterado.emit();
      },
      error: (err) => {
        this.ocupado.set(null);
        this.erro.set(err?.error?.erro ?? 'Não foi possível categorizar.');
      },
    });
  }

  chave(g: GrupoPendente): string {
    return g.chave + g.tipo;
  }
}
