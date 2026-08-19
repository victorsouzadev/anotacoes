export interface ResumoResponse {
  totalReceitas: number;
  totalDespesas: number;
  saldo: number;
  maiorCategoriaGasto: string | null;
  saldoMesAnterior: number;
  variacaoPercentualSaldo: number;
}

export interface CategoriaResumo {
  categoria: string;
  total: number;
  percentual: number;
}

export interface TendenciaPeriodo {
  periodo: string;
  receitas: number;
  despesas: number;
  saldo: number;
}
