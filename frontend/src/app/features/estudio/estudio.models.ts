/** Tipos da API do Estúdio (/api/estudio). */

export type TipoMidia = 'imagem' | 'video' | 'audio' | 'modelo3d' | 'mundo' | 'documento';

export interface Midia {
  id: string;
  tipo: TipoMidia;
  nome: string;
  contentType: string;
  /** Link assinado: abre sem login (img, video, audio, Three.js, iframe). */
  url: string;
  thumb: string | null;
  tamanho: number;
  largura: number | null;
  altura: number | null;
  duracaoSeg: number | null;
  origem: string;
  jobId: string | null;
  modeloId: string | null;
  prompt: string | null;
  pasta: string | null;
  favorito: boolean;
  criadoEm: string;
}

export type Valor = string | number | boolean;

export interface CustoSpec {
  fixo: number;
  porUnidade: number;
  porSegundo: number;
  porCaractere: number;
  mult: Record<string, Record<string, number>>;
}

export interface OperacaoCatalogo {
  /** Entradas de arquivo que a operação usa (imagens, imagem, imagemFinal, mascara, video…). */
  entradas: string[];
  /** Parâmetros (prompt, proporcao, duracao…). */
  parametros: string[];
  obrigatorios: string[];
  opcoes: Record<string, Valor[]>;
  padroes: Record<string, Valor>;
  limites: Record<string, [number, number]>;
  maxImagens: number | null;
  custo: CustoSpec;
}

export interface ModeloCatalogo {
  id: string;
  nome: string;
  familia: string;
  tipo: 'imagem' | 'video' | 'audio' | 'modelo3d' | 'mundo';
  provedor: 'fal' | 'worldlabs';
  descricao: string | null;
  ops: Record<string, OperacaoCatalogo>;
}

export type StatusJob = 'fila' | 'rodando' | 'concluido' | 'falhou' | 'cancelado';

export interface Job {
  id: string;
  app: string;
  modeloId: string;
  modeloNome: string | null;
  operacao: string;
  provedor: string;
  status: StatusJob;
  mensagem: string | null;
  erro: string | null;
  posicaoFila: number | null;
  custoEstimadoCentavos: number;
  linkExterno: string | null;
  parametros: Record<string, Valor>;
  entradas: Record<string, string[]>;
  resultado: Midia[];
  criadoEm: string;
  concluidoEm: string | null;
}

export interface PedidoGeracao {
  modelo: string;
  operacao: string;
  parametros: Record<string, Valor>;
  entradas: Record<string, string[]>;
  app?: string;
  pipeline?: string;
}

export interface Estimativa {
  custoCentavos: number;
  gastoMesCentavos: number;
  limiteMensalCentavos: number | null;
  passaDoLimite: boolean;
}

export interface EstudioConfig {
  falConfigurada: boolean;
  falMascarada: string | null;
  falDoServidor: boolean;
  worldLabsConfigurada: boolean;
  worldLabsMascarada: string | null;
  worldLabsDoServidor: boolean;
  limiteMensalCentavos: number | null;
  confirmarAcimaCentavos: number;
  gastoMesCentavos: number;
  geracoesNoMes: number;
  ffmpegDisponivel: boolean;
}

export type TipoQuadro = 'storyboard' | 'moodboard' | 'cena' | 'timeline';

export interface QuadroResumo {
  id: string;
  tipo: TipoQuadro;
  nome: string;
  thumb: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Quadro extends QuadroResumo {
  data: string;
}

/** Centavos de dólar → "US$ 1,23". */
export function dolares(centavos: number): string {
  const v = centavos / 100;
  return 'US$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: v < 0.1 && v > 0 ? 3 : 2 });
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2).replace('.', ',')} GB`;
}
