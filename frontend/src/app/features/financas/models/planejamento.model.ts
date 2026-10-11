export type MetodoDivisao = '50-30-20' | 'auvp' | '6-potes';

export interface Preferencias {
  metodo: MetodoDivisao;
  mesesReserva: number;
  metaReservaId: string | null;
  percentualPagueSePrimeiro: number;
  patrimonioInvestido: number;
  saldoInicialFluxo: number | null;
}

export interface SalvarPreferencias {
  metodo?: MetodoDivisao;
  mesesReserva?: number;
  metaReservaId?: string;
  limparMetaReserva?: boolean;
  percentualPagueSePrimeiro?: number;
  patrimonioInvestido?: number;
  saldoInicialFluxo?: number;
}

export interface SaudeFinanceira {
  ano: number;
  mes: number;
  receitas: number;
  despesas: number;
  taxaPoupanca: number | null;
  taxaPoupancaMedia: number | null;
  gastoEssencialMedio: number;
  mesesReservaAlvo: number;
  reservaAlvo: number;
  reservaAtual: number;
  mesesCobertos: number | null;
  metaReservaId: string | null;
  percentualPagueSePrimeiro: number;
  valorPagueSePrimeiro: number;
  guardadoNoMes: number;
  rendaDoMes: number;
  comDestino: number;
  aDistribuir: number;
  gastoAnual: number;
  patrimonioAlvo: number;
  patrimonioInvestido: number;
  poupancaMensalMedia: number;
  anosParaIndependencia: number | null;
}

export interface Fatia {
  chave: string;
  nome: string;
  percentual: number;
  planejado: number;
  realizado: number;
  utilizado: number;
  descricao: string;
  categorias: string[];
}

export interface MetodoResposta {
  metodo: MetodoDivisao;
  nome: string;
  ano: number;
  mes: number;
  renda: number;
  fatias: Fatia[];
  semFatia: number;
}

export interface Envelope {
  categoria: string;
  categoriaRotulo: string;
  planejadoMes: number;
  gastoMes: number;
  saldoAcumulado: number;
  mesesConsiderados: number;
}

export interface Provisao {
  id: string;
  nome: string;
  valor: number;
  mesVencimento: number;
  valorReservado: number;
  valorMensal: number;
  proximoVencimento: string;
  mesesRestantes: number;
  necessarioPorMes: number;
  reservadoEsperado: number;
  situacao: 'completa' | 'em-dia' | 'atrasada';
}

export interface Provisoes {
  itens: Provisao[];
  totalMensal: number;
  totalAnual: number;
}

export interface SalvarProvisao {
  nome: string;
  valor: number;
  mesVencimento: number;
  valorReservado?: number;
}

export interface Divida {
  id: string;
  nome: string;
  saldo: number;
  jurosMensal: number;
  parcelaMinima: number;
}

export type SalvarDivida = Omit<Divida, 'id'>;

export interface Estrategia {
  estrategia: 'bola-de-neve' | 'avalanche';
  viavel: boolean;
  meses: number;
  jurosTotais: number;
  totalPago: number;
  ordem: { nome: string; mesQuitacao: number }[];
}

export interface SimulacaoDividas {
  pagamentoMensal: number;
  bolaDeNeve: Estrategia;
  avalanche: Estrategia;
  recomendacao: string;
}

export interface EventoFluxo {
  data: string;
  descricao: string;
  valor: number;
  origem: 'lançamento' | 'fatura' | 'recorrente';
}

export interface FluxoCaixa {
  saldoInicial: number;
  origemSaldo: 'auvp' | 'informado' | 'nenhum';
  pontos: { data: string; saldo: number }[];
  eventos: EventoFluxo[];
  menorSaldo: number;
  dataMenorSaldo: string;
  primeiroDiaNegativo: string | null;
  saldoFinal: number;
}

export interface Fechamento {
  ano: number;
  mes: number;
  receitas: number;
  despesas: number;
  saldo: number;
  taxaPoupanca: number | null;
  orcamentoUtilizado: number | null;
  categorias: { categoria: string; rotulo: string; valor: number; valorMesAnterior: number }[];
  metaPoupanca: number | null;
  reflexao: string | null;
  compromisso: string | null;
  atualizadoEm: string | null;
}

export const METODOS: { valor: MetodoDivisao; nome: string; resumo: string }[] = [
  { valor: '50-30-20', nome: 'Regra 50/30/20', resumo: '50% necessidades, 30% desejos, 20% poupança.' },
  { valor: 'auvp', nome: 'Método AUVP', resumo: 'Custos Fixos, Conforto, Metas, Prazeres, Conhecimento e Liberdade.' },
  { valor: '6-potes', nome: '6 Potes', resumo: 'Necessidades, liberdade, longo prazo, educação, diversão e doações.' },
];
