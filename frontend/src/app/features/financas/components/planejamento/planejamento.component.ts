import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { DividasComponent } from './dividas.component';
import { EnvelopesComponent } from './envelopes.component';
import { FechamentoComponent } from './fechamento.component';
import { FluxoComponent } from './fluxo.component';
import { MetodoComponent } from './metodo.component';
import { ProvisoesComponent } from './provisoes.component';
import { SaudeComponent } from './saude.component';

export type SecaoPlanejamento = 'saude' | 'metodo' | 'fluxo' | 'dividas' | 'provisoes' | 'envelopes' | 'fechamento';

export const SECOES: { id: SecaoPlanejamento; nome: string; dica: string }[] = [
  { id: 'saude', nome: 'Saúde financeira', dica: 'Taxa de poupança, reserva, pague-se primeiro e independência' },
  { id: 'metodo', nome: 'Divisão da renda', dica: '50/30/20, método AUVP ou 6 Potes' },
  { id: 'fluxo', nome: 'Fluxo de caixa', dica: 'Saldo previsto para os próximos dias' },
  { id: 'dividas', nome: 'Dívidas', dica: 'Bola de neve × avalanche' },
  { id: 'provisoes', nome: 'Gastos anuais', dica: 'IPVA, IPTU, seguros: guarde 1/12 por mês' },
  { id: 'envelopes', nome: 'Envelopes', dica: 'O que sobra do orçamento passa para o mês seguinte' },
  { id: 'fechamento', nome: 'Fechamento do mês', dica: 'Revisão Kakeibo' },
];

const CHAVE_SECAO = 'financas.planejamento.secao';

// A aba de planejamento: uma seção por metodologia, escolhida pelas pílulas.
@Component({
  selector: 'app-planejamento',
  standalone: true,
  imports: [
    SaudeComponent,
    MetodoComponent,
    FluxoComponent,
    DividasComponent,
    ProvisoesComponent,
    EnvelopesComponent,
    FechamentoComponent,
  ],
  templateUrl: './planejamento.component.html',
  styleUrl: './planejamento.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanejamentoComponent {
  readonly ano = input.required<number>();
  readonly mes = input.required<number>();

  readonly secoes = SECOES;
  readonly secao = signal<SecaoPlanejamento>(lerSecao());

  escolher(id: SecaoPlanejamento): void {
    this.secao.set(id);
    try {
      localStorage.setItem(CHAVE_SECAO, id);
    } catch {
      // Sem armazenamento, só não lembra a última seção.
    }
  }
}

function lerSecao(): SecaoPlanejamento {
  try {
    const salva = localStorage.getItem(CHAVE_SECAO);
    if (salva && SECOES.some((s) => s.id === salva)) return salva as SecaoPlanejamento;
  } catch {
    // Ignorado: cai na primeira seção.
  }
  return 'saude';
}
