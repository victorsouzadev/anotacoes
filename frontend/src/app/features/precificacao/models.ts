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

/**
 * Registro imutável de um cálculo feito em um momento — mantém os números que
 * o produto tinha naquele instante mesmo que as configurações globais (hora,
 * equipamentos, custos fixos) mudem depois. É o histórico de precificações.
 */
export interface HistoricoEntrada {
  id: string;
  dataISO: string;
  produto: ProdutoFicha;
  custoTotal: number;
  precoMinimo: number | null;
  precoSugerido: number | null;
  precoUnitarioFinal: number | null;
  lucroUnitario: number | null;
  margemLiquidaReal: number | null;
}

export interface OrcamentoItem {
  id: string;
  descricao: string;
  quantidade: number;
  precoUnitario: number;
}

/** Orçamento com a identidade visual Viih Mimos, pronto para imprimir/enviar ao cliente. */
export interface Orcamento {
  id: string;
  numero: number;
  dataISO: string;
  validadeDias: number;
  clienteNome: string;
  clienteContato: string;
  condicoes: string;
  observacoes: string;
  itens: OrcamentoItem[];
}
