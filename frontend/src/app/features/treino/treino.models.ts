/** Formas da API /api/treino (Dtos/TreinoDtos.cs), alimentada pelo app Treino Corrida. */
export interface Atividade {
  id: string;
  inicio: string;
  tipo: 'sessao' | 'livre';
  titulo: string;
  duracaoSeg: number;
  distanciaM: number;
  maiorCorridaSeg: number | null;
  esforco: number | null;
  dor: boolean;
  meta: string | null;
  fcMedia: number | null;
  fcMax: number | null;
  nota: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Plano {
  programa: string;
  semana: number;
  semanasTotal: number;
  sessoesFeitas: number;
  sessoesTotal: number;
  proximaSessao: string | null;
  updatedAt: string;
}
