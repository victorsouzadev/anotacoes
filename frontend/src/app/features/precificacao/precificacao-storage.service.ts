import { Injectable, signal, WritableSignal } from '@angular/core';
import { uuid } from '../../core/uuid';
import { ConfiguracaoPrecificacao, HistoricoEntrada, Orcamento, ProdutoFicha } from './models';

const CONFIG_KEY = 'precificacao.config.v1';
const PRODUTOS_KEY = 'precificacao.produtos.v1';
const HISTORICO_KEY = 'precificacao.historico.v1';
const ORCAMENTOS_KEY = 'precificacao.orcamentos.v1';
const HISTORICO_MAXIMO = 300;

function configuracaoPadrao(): ConfiguracaoPrecificacao {
  return {
    hh: { valorHoraDesejado: 1500, horasPorDia: 6, diasPorMes: 22 },
    margemPadrao: 30,
    perdaPadrao: 5,
    descontoMaximoPadrao: 10,
    taxaUrgenciaPercentual: 20,
    taxas: [
      { id: uuid(), nome: 'Taxa da maquininha', percentual: 2 },
      { id: uuid(), nome: 'Taxa do marketplace', percentual: 5 },
    ],
    impostosPercentual: 4,
    custosFixos: [],
    producaoMensalEstimada: 100,
    equipamentos: [],
    energia: { valorConta: 150, percentualProducao: 30, horasProdutivasMes: 132, usarCustoDireto: false, custoDiretoPorProduto: 0 },
    faixasQuantidade: [
      { id: uuid(), quantidade: 1, descontoPercentual: 0 },
      { id: uuid(), quantidade: 10, descontoPercentual: 5 },
      { id: uuid(), quantidade: 20, descontoPercentual: 8 },
      { id: uuid(), quantidade: 50, descontoPercentual: 12 },
      { id: uuid(), quantidade: 100, descontoPercentual: 15 },
    ],
  };
}

function lerJson<T>(chave: string, padrao: T): T {
  try {
    const bruto = localStorage.getItem(chave);
    if (!bruto) return padrao;
    return { ...padrao, ...JSON.parse(bruto) } as T;
  } catch {
    return padrao;
  }
}

function lerLista<T>(chave: string): T[] {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? (JSON.parse(bruto) as T[]) : [];
  } catch {
    return [];
  }
}

@Injectable({ providedIn: 'root' })
export class PrecificacaoStorageService {
  readonly config = signal<ConfiguracaoPrecificacao>(lerJson(CONFIG_KEY, configuracaoPadrao()));
  readonly produtos = signal<ProdutoFicha[]>(lerLista<ProdutoFicha>(PRODUTOS_KEY));
  readonly historico = signal<HistoricoEntrada[]>(lerLista<HistoricoEntrada>(HISTORICO_KEY));
  readonly orcamentos = signal<Orcamento[]>(lerLista<Orcamento>(ORCAMENTOS_KEY));

  private persistir<T>(chave: string, sinal: WritableSignal<T[]>, lista: T[]): void {
    sinal.set(lista);
    localStorage.setItem(chave, JSON.stringify(lista));
  }

  salvarConfig(config: ConfiguracaoPrecificacao): void {
    this.config.set(config);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  salvarProduto(produto: ProdutoFicha): void {
    const lista = this.produtos();
    const idx = lista.findIndex((p) => p.id === produto.id);
    const atualizado = { ...produto, atualizadoEm: new Date().toISOString() };
    const nova = idx >= 0 ? lista.map((p, i) => (i === idx ? atualizado : p)) : [...lista, atualizado];
    this.persistir(PRODUTOS_KEY, this.produtos, nova);
  }

  removerProduto(id: string): void {
    this.persistir(PRODUTOS_KEY, this.produtos, this.produtos().filter((p) => p.id !== id));
  }

  /** Registra um retrato congelado do cálculo atual — não é afetado por mudanças futuras nas configurações. */
  registrarHistorico(entrada: Omit<HistoricoEntrada, 'id' | 'dataISO'>): HistoricoEntrada {
    const nova: HistoricoEntrada = { ...entrada, id: uuid(), dataISO: new Date().toISOString() };
    const lista = [nova, ...this.historico()].slice(0, HISTORICO_MAXIMO);
    this.persistir(HISTORICO_KEY, this.historico, lista);
    return nova;
  }

  removerHistorico(id: string): void {
    this.persistir(HISTORICO_KEY, this.historico, this.historico().filter((h) => h.id !== id));
  }

  limparHistorico(): void {
    this.persistir(HISTORICO_KEY, this.historico, []);
  }

  proximoNumeroOrcamento(): number {
    return this.orcamentos().reduce((maior, o) => Math.max(maior, o.numero), 0) + 1;
  }

  salvarOrcamento(orcamento: Orcamento): void {
    const lista = this.orcamentos();
    const idx = lista.findIndex((o) => o.id === orcamento.id);
    const nova = idx >= 0 ? lista.map((o, i) => (i === idx ? orcamento : o)) : [...lista, orcamento];
    this.persistir(ORCAMENTOS_KEY, this.orcamentos, nova);
  }

  removerOrcamento(id: string): void {
    this.persistir(ORCAMENTOS_KEY, this.orcamentos, this.orcamentos().filter((o) => o.id !== id));
  }
}
