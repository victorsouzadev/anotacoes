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
