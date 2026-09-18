/** Modelos da calculadora de precificação para papelaria personalizada. */

export interface ItemCusto {
  id: string;
  nome: string;
  unidade: string;
  precoCompra: number;
  qtdComprada: number;
  qtdUtilizada: number;
}

export interface AtividadeHH {
  id: string;
  nome: string;
  minutos: number;
}

export interface Equipamento {
  id: string;
  nome: string;
  precoAquisicao: number;
  valorResidual: number;
  vidaUtilHoras: number;
  manutencaoHora: number;
  consumoWatts: number;
}

export interface UsoMaquina {
  id: string;
  equipamentoId: string;
  minutos: number;
}

export interface CustoFixo {
  id: string;
  nome: string;
  valorMensal: number;
}

export interface TaxaItem {
  id: string;
  nome: string;
  percentual: number;
}

export interface ValorNomeado {
  id: string;
  nome: string;
  valor: number;
}

export interface PersonalizacaoItem {
  id: string;
  nome: string;
  valor: number;
  ativo: boolean;
}

export interface FaixaQuantidade {
  id: string;
  quantidade: number;
  descontoPercentual: number;
}

export interface ConfiguracaoEnergia {
  valorConta: number;
  percentualProducao: number;
  horasProdutivasMes: number;
  usarCustoDireto: boolean;
  custoDiretoPorProduto: number;
}

export interface ConfiguracaoHH {
  valorHoraDesejado: number;
  horasPorDia: number;
  diasPorMes: number;
}

/** Configurações globais reutilizáveis em qualquer produto novo. */
export interface ConfiguracaoPrecificacao {
  hh: ConfiguracaoHH;
  margemPadrao: number;
  perdaPadrao: number;
  descontoMaximoPadrao: number;
  taxaUrgenciaPercentual: number;
  taxas: TaxaItem[];
  impostosPercentual: number;
  custosFixos: CustoFixo[];
  producaoMensalEstimada: number;
  equipamentos: Equipamento[];
  energia: ConfiguracaoEnergia;
  faixasQuantidade: FaixaQuantidade[];
}

export const CATEGORIAS_PADRAO = [
  'Topo de bolo',
  'Caixa Milk',
  'Caixa Pirâmide',
  'Caixa Sushi',
  'Caixa Bala',
  'Caixa Explosão',
  'Convite',
  'Tag',
  'Lembrancinha',
  'Kit festa',
  'Aplique',
  'Outro',
] as const;

/** Ficha de precificação de um produto — o que fica salvo no cadastro. */
export interface ProdutoFicha {
  id: string;
  nome: string;
  categoria: string;
  categoriaPersonalizada: string;
  quantidadeProduzida: number;
  quantidadeVendida: number;
  percentualPerda: number;

  materiais: ItemCusto[];
  insumos: ItemCusto[];
  embalagens: ItemCusto[];
  outrosCustos: ValorNomeado[];

  atividadesHH: AtividadeHH[];
  usosMaquina: UsoMaquina[];

  personalizacoes: PersonalizacaoItem[];
  urgente: boolean;

  usarEnergiaDireta: boolean;
  energiaDireta: number;

  margemDesejada: number;
  descontoMaximo: number;
  taxas: TaxaItem[];
  impostosPercentual: number;

  margensSimulacao: number[];
  faixasQuantidade: FaixaQuantidade[];

  atualizadoEm: string;
}
