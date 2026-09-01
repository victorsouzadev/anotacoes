import { Transacao } from './transacao.model';

export interface ImportacaoResponse {
  quantidadeCriada: number;
  transacoes: Transacao[];
  /** Motivo de cada linha que o modelo devolveu mas não pôde ser aproveitada. */
  descartes: string[];
  atingiuLimite: boolean;
}

/** O que esta instalação do servidor consegue fazer — sem chave de LLM não há leitura de arquivo. */
export interface Capacidades {
  provedor: string;
  suportaAnexos: boolean;
  maxArquivos: number;
  maxTamanhoArquivoMb: number;
  extensoesAceitas: string[];
}
