import { Injectable, signal } from '@angular/core';
import { uuid } from '../../core/uuid';
import { ConfiguracaoPrecificacao, ProdutoFicha } from './models';

const CONFIG_KEY = 'precificacao.config.v1';
const PRODUTOS_KEY = 'precificacao.produtos.v1';

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

@Injectable({ providedIn: 'root' })
export class PrecificacaoStorageService {
  readonly config = signal<ConfiguracaoPrecificacao>(lerJson(CONFIG_KEY, configuracaoPadrao()));
  readonly produtos = signal<ProdutoFicha[]>(this.lerProdutos());

  private lerProdutos(): ProdutoFicha[] {
    try {
      const bruto = localStorage.getItem(PRODUTOS_KEY);
      return bruto ? (JSON.parse(bruto) as ProdutoFicha[]) : [];
    } catch {
      return [];
    }
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
    this.produtos.set(nova);
    localStorage.setItem(PRODUTOS_KEY, JSON.stringify(nova));
  }

  removerProduto(id: string): void {
    const nova = this.produtos().filter((p) => p.id !== id);
    this.produtos.set(nova);
    localStorage.setItem(PRODUTOS_KEY, JSON.stringify(nova));
  }
}
