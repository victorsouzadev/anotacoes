export interface ResumoResponse {
  ano: number;
  mes: number;
  totalReceitas: number;
  totalDespesas: number;
  saldo: number;
  maiorCategoriaGasto: string | null;
  maiorCategoriaGastoRotulo: string | null;
  maiorCategoriaGastoValor: number;
  saldoMesAnterior: number;
  /** Nulo quando não há mês anterior com que comparar. */
  variacaoPercentualSaldo: number | null;
  quantidadeLancamentos: number;
  quantidadePendentes: number;
}

export interface CategoriaResumo {
  categoria: string;
  categoriaRotulo: string;
  total: number;
  percentual: number;
  quantidade: number;
}

export interface TendenciaPeriodo {
  periodo: string;
  periodoRotulo: string;
  receitas: number;
  despesas: number;
  saldo: number;
}

export interface Recorrente {
  descricao: string;
  categoria: string;
  categoriaRotulo: string;
  valorMedio: number;
  ultimoValor: number;
  ultimaData: string;
  meses: number;
  conta: string | null;
}

export interface CompromissoMes {
  ano: number;
  mes: number;
  total: number;
  quantidade: number;
}

export interface Parcelado {
  descricao: string;
  valorParcela: number;
  parcelaAtual: number;
  totalParcelas: number;
  restante: number;
  ultimaCompetencia: string;
  conta: string | null;
}

export interface Compromissos {
  meses: CompromissoMes[];
  parcelados: Parcelado[];
}

export interface TagResumo {
  tag: string;
  total: number;
  percentual: number;
  quantidade: number;
}
