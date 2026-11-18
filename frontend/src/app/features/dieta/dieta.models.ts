/** Formas da API /api/dieta (Dtos/DietaDtos.cs e Services/Dieta/DietaProgresso.cs). */

export type Refeicao = 'cafe' | 'almoco' | 'lanche' | 'jantar' | 'ceia';

export interface Metas {
  kcal: number;
  proteinaG: number;
  carboG: number;
  gorduraG: number;
  aguaMl: number;
}

export interface Perfil {
  alturaCm: number;
  nascimento: string | null;
  sexo: 'M' | 'F';
  atividade: number;
  objetivo: 'perder' | 'manter' | 'ganhar';
  metaKcal: number;
  metaProteinaG: number;
  metaCarboG: number;
  metaGorduraG: number;
  metaAguaMl: number;
  updatedAt: string;
  preferencias?: string | null;
}

export interface PerfilResposta {
  perfil: Perfil | null;
  pesoAtual: number | null;
  metas: Metas;
  sugestao: Metas;
}

export interface Alimento {
  id: string;
  nome: string;
  kcal: number;
  proteina: number;
  carbo: number;
  gordura: number;
  fibra: number;
  sodio: number;
  porcaoG: number;
  porcaoNome: string | null;
  codigoBarras: string | null;
  fonte: string;
  itens: string | null;
  favorito: boolean;
  proprio: boolean;
}

export interface Registro {
  id: string;
  data: string;
  refeicao: Refeicao;
  alimentoId: string | null;
  nome: string;
  quantidadeG: number;
  kcal: number;
  proteina: number;
  carbo: number;
  gordura: number;
  fibra: number;
  fotoId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Agua {
  id: string;
  data: string;
  ml: number;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Peso {
  id: string;
  data: string;
  kg: number;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TotaisDia {
  data: string;
  kcal: number;
  proteina: number;
  carbo: number;
  gordura: number;
  fibra: number;
  aguaMl: number;
  registros: number;
  fotosRefeicao: number;
  peso: boolean;
  kcalNaMeta: boolean;
  proteinaNaMeta: boolean;
  aguaNaMeta: boolean;
  xp: number;
  nivel?: number;
}

export interface DiaResposta {
  totais: TotaisDia;
  metas: Metas;
  adesaoPlano: number | null;
  registros: Registro[];
  agua: Agua[];
  peso: number | null;
}

export interface PlanoItem {
  id: string;
  diaSemana: number;
  refeicao: Refeicao;
  alimentoId: string | null;
  nome: string;
  quantidadeG: number;
  updatedAt: string;
  deletedAt: string | null;
  opcao: number;
  observacao: string | null;
}

export interface Conquista {
  codigo: string;
  nome: string;
  descricao: string;
  em: string | null;
}

export interface Desafio {
  codigo: string;
  descricao: string;
  alvo: number;
  feito: number;
  inicio: string;
  fim: string;
}

export interface PontoPeso {
  data: string;
  kg: number;
  media7: number;
}

export interface Progresso {
  xpTotal: number;
  nivel: number;
  xpNoNivel: number;
  xpParaProximo: number;
  sequenciaRegistro: number;
  sequenciaMeta: number;
  melhorSequencia: number;
  diasRegistrados: number;
  conquistas: Conquista[];
  desafio: Desafio;
  dias: TotaisDia[];
  peso: PontoPeso[];
}

export interface Compartilhamento {
  id: string;
  titulo: string;
  escopos: string[];
  url: string;
  expiraEm: string | null;
  revogadoEm: string | null;
  createdAt: string;
}

export interface MensagemChat {
  papel: 'usuario' | 'assistente';
  texto: string;
}

export interface RespostaChat {
  resposta: string;
  consultas: string[];
  alterou: boolean;
  pergunta?: { texto: string; opcoes: string[]; multipla: boolean } | null;
}

export const REFEICOES: { valor: Refeicao; nome: string }[] = [
  { valor: 'cafe', nome: 'Café da manhã' },
  { valor: 'almoco', nome: 'Almoço' },
  { valor: 'lanche', nome: 'Lanche' },
  { valor: 'jantar', nome: 'Jantar' },
  { valor: 'ceia', nome: 'Ceia' },
];

export const ESCOPOS: { valor: string; nome: string }[] = [
  { valor: 'hoje', nome: 'Só o dia de hoje' },
  { valor: 'peso', nome: 'Peso' },
  { valor: 'macros', nome: 'Macros' },
  { valor: 'diario', nome: 'Diário' },
  { valor: 'fotos_refeicao', nome: 'Fotos de refeição' },
  { valor: 'fotos_corpo', nome: 'Fotos corporais' },
  { valor: 'conquistas', nome: 'Conquistas' },
  { valor: 'exportar', nome: 'Baixar CSV' },
];

/** "Modo nutricionista": o que um profissional precisa ver. */
export const ESCOPOS_NUTRICIONISTA = ['diario', 'macros', 'peso', 'exportar'];
