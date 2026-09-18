import { uuid } from '../../core/uuid';
import { ConfiguracaoPrecificacao, ItemCusto, ProdutoFicha, ValorNomeado } from './models';

export function itemCustoVazio(nome = ''): ItemCusto {
  return { id: uuid(), nome, unidade: 'un', precoCompra: 0, qtdComprada: 1, qtdUtilizada: 1 };
}

export function valorNomeadoVazio(nome = ''): ValorNomeado {
  return { id: uuid(), nome, valor: 0 };
}

const PERSONALIZACOES_SUGERIDAS = ['Nome', 'Idade', 'Foto', 'Alteração de arte', 'Arte exclusiva', 'Montagem especial', 'Acabamento premium'];

export function produtoVazio(config: ConfiguracaoPrecificacao): ProdutoFicha {
  return {
    id: uuid(),
    nome: '',
    categoria: 'Topo de bolo',
    categoriaPersonalizada: '',
    quantidadeProduzida: 1,
    quantidadeVendida: 1,
    percentualPerda: config.perdaPadrao,

    materiais: [],
    insumos: [],
    embalagens: [],
    outrosCustos: [],

    atividadesHH: [],
    usosMaquina: [],

    personalizacoes: PERSONALIZACOES_SUGERIDAS.map((nome) => ({ id: uuid(), nome, valor: 0, ativo: false })),
    urgente: false,

    usarEnergiaDireta: false,
    energiaDireta: 0,

    margemDesejada: config.margemPadrao,
    descontoMaximo: config.descontoMaximoPadrao,
    taxas: config.taxas.map((t) => ({ ...t, id: uuid() })),
    impostosPercentual: config.impostosPercentual,

    margensSimulacao: [10, 20, 30, 40, 50, 60],
    faixasQuantidade: config.faixasQuantidade.map((f) => ({ ...f, id: uuid() })),

    atualizadoEm: new Date().toISOString(),
  };
}

export function produtoExemplo(config: ConfiguracaoPrecificacao): ProdutoFicha {
  const base = produtoVazio(config);
  return {
    ...base,
    nome: 'Topo de bolo personalizado',
    categoria: 'Topo de bolo',
    quantidadeProduzida: 1,
    quantidadeVendida: 1,
    percentualPerda: 5,
    margemDesejada: 30,
    materiais: [
      { id: uuid(), nome: 'Papel', unidade: 'folha', precoCompra: 2.5, qtdComprada: 1, qtdUtilizada: 1 },
      { id: uuid(), nome: 'Papel fotográfico', unidade: 'folha', precoCompra: 1.5, qtdComprada: 1, qtdUtilizada: 1 },
    ],
    insumos: [
      { id: uuid(), nome: 'Cola', unidade: 'un', precoCompra: 0.8, qtdComprada: 1, qtdUtilizada: 1 },
      { id: uuid(), nome: 'Tinta', unidade: 'un', precoCompra: 1.2, qtdComprada: 1, qtdUtilizada: 1 },
    ],
    embalagens: [{ id: uuid(), nome: 'Saquinho', unidade: 'un', precoCompra: 1.5, qtdComprada: 1, qtdUtilizada: 1 }],
    atividadesHH: [{ id: uuid(), nome: 'Produção completa', minutos: 30 }],
    usosMaquina: [],
  };
}
