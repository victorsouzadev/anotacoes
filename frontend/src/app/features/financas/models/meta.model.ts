/** "sem_prazo" | "no_ritmo" | "atrasada" | "concluida" | "vencida" */
export type SituacaoMeta = 'sem_prazo' | 'no_ritmo' | 'atrasada' | 'concluida' | 'vencida';

export interface Aporte {
  id: string;
  valor: number;
  data: string;
  observacoes: string | null;
  transacaoId: string | null;
  criadoEm: string;
}

export interface Meta {
  id: string;
  nome: string;
  valorAlvo: number;
  dataAlvo: string | null;
  observacoes: string | null;
  valorAcumulado: number;
  valorRestante: number;
  percentualConcluido: number;
  concluida: boolean;
  arquivada: boolean;
  aporteMensalNecessario: number | null;
  mesesRestantes: number | null;
  ritmoMensalAtual: number;
  situacao: SituacaoMeta;
  previsaoDeConclusao: string | null;
  aportes: Aporte[];
  criadoEm: string;
}

export interface SalvarMetaRequest {
  nome: string;
  valorAlvo: number;
  dataAlvo: string | null;
  observacoes: string | null;
}

export interface CriarAporteRequest {
  valor: number | null;
  data: string | null;
  observacoes: string | null;
  transacaoId: string | null;
}

export interface InvestimentoDisponivel {
  id: string;
  descricao: string;
  valor: number;
  data: string;
}

export const ROTULO_SITUACAO_META: Record<SituacaoMeta, string> = {
  sem_prazo: 'Sem prazo',
  no_ritmo: 'No ritmo',
  atrasada: 'Atrasada',
  concluida: 'Concluída',
  vencida: 'Prazo vencido',
};
