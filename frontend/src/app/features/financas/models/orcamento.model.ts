import { Categoria } from './transacao.model';

export type GrupoCategoria = 'Essenciais' | 'EstiloDeVida' | 'Futuro';

/** Como o backend classifica um item do acompanhamento. */
export type SituacaoItem = 'ok' | 'atencao' | 'estourado' | 'sem_orcamento';

export interface OrcamentoItem {
  categoria: Categoria;
  categoriaRotulo: string;
  grupo: GrupoCategoria;
  percentual: number;
  valorPlanejado: number;
}

export interface Orcamento {
  id: string;
  ano: number;
  mes: number;
  valorTotal: number;
  observacoes: string | null;
  itens: OrcamentoItem[];
  criadoEm: string;
  atualizadoEm: string;
}

export interface SalvarOrcamentoRequest {
  ano: number;
  mes: number;
  valorTotal: number;
  itens: { categoria: Categoria; percentual: number }[];
  observacoes: string | null;
}

export interface AcompanhamentoItem {
  categoria: Categoria;
  categoriaRotulo: string;
  grupo: GrupoCategoria;
  percentual: number;
  valorPlanejado: number;
  valorRealizado: number;
  valorRestante: number;
  percentualUtilizado: number;
  situacao: SituacaoItem;
}

export interface AcompanhamentoGrupo {
  grupo: GrupoCategoria;
  grupoRotulo: string;
  percentual: number;
  valorPlanejado: number;
  valorRealizado: number;
}

export interface Acompanhamento {
  ano: number;
  mes: number;
  temOrcamento: boolean;
  valorTotal: number;
  totalPlanejado: number;
  totalRealizado: number;
  saldoDisponivel: number;
  percentualUtilizado: number;
  percentualDoMesDecorrido: number;
  projecaoFimDoMes: number;
  itens: AcompanhamentoItem[];
  grupos: AcompanhamentoGrupo[];
}

export interface HistoricoMes {
  ano: number;
  mes: number;
  rotulo: string;
  temOrcamento: boolean;
  valorTotal: number;
  totalRealizado: number;
  percentualUtilizado: number;
  situacao: SituacaoItem;
}

export interface ModeloOrcamento {
  id: string;
  nome: string;
  descricao: string;
  itens: OrcamentoItem[];
}

export interface CategoriaOrcavel {
  categoria: Categoria;
  rotulo: string;
  grupo: GrupoCategoria;
  grupoRotulo: string;
}

export const ROTULO_GRUPO: Record<GrupoCategoria, string> = {
  Essenciais: 'Essenciais',
  EstiloDeVida: 'Estilo de vida',
  Futuro: 'Futuro',
};
