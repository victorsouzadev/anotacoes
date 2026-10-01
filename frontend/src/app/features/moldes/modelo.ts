/** Tipos dos moldes: cada tipo descreve os próprios campos (que a tela monta
 * sozinha) e uma função pura que transforma os valores em peças com linhas de
 * corte e de dobra, em mm. */

import { FontLike } from '../imagem/svg-text';
import { Polygon } from '../imagem/contour';
import { VPath } from './geometria';

export type Valor = number | string | boolean;
export type Params = Record<string, Valor>;

interface CampoBase {
  chave: string;
  rotulo: string;
  ajuda?: string;
  /** Só aparece quando a função diz que sim (ex.: margem da janela só com janela). */
  visivel?: (p: Params) => boolean;
}

export interface CampoNumero extends CampoBase {
  tipo: 'numero';
  unidade: 'cm' | 'mm' | 'un' | '%';
  min: number;
  max: number;
  passo: number;
}

export interface CampoOpcoes extends CampoBase {
  tipo: 'opcoes';
  opcoes: { valor: string; rotulo: string }[];
}

export interface CampoTexto extends CampoBase {
  tipo: 'texto';
  multilinha?: boolean;
  max?: number;
}

export interface CampoSimNao extends CampoBase {
  tipo: 'sim-nao';
}

export interface CampoFonte extends CampoBase {
  tipo: 'fonte';
}

export interface CampoCor extends CampoBase {
  tipo: 'cor';
}

export interface CampoImagem extends CampoBase {
  tipo: 'imagem';
}

export type Campo = CampoNumero | CampoOpcoes | CampoTexto | CampoSimNao | CampoFonte | CampoCor | CampoImagem;

/** O que vai impresso numa peça (topper com foto). Coordenadas da peça. */
export interface Arte {
  /** Fundo pintado embaixo da foto (a borda colorida do topper). */
  fundo?: { paths: VPath[]; cor: string };
  foto?: {
    src: string;
    x: number;
    y: number;
    w: number;
    h: number;
    /** Recorta a foto nesta forma (null = foto inteira, já sem fundo). */
    clip: VPath[] | null;
  };
}

export interface Peca {
  nome: string;
  corte: VPath[];
  dobra: VPath[];
  arte?: Arte;
}

export interface Molde {
  pecas: Peca[];
  avisos: string[];
}

/** Imagem enviada pelo usuário, já lida. */
export interface ImagemCarregada {
  src: string;
  w: number;
  h: number;
  /** Silhueta do canal alfa, em px da imagem (null se a imagem não tem fundo transparente). */
  contorno: Polygon | null;
}

export interface Contexto {
  /** Fonte do campo `fonte`, ou null enquanto carrega. */
  fonte: FontLike | null;
  imagem: ImagemCarregada | null;
}

export type Categoria = 'Caixas e embalagens' | 'Toppers';

export interface TipoMolde {
  id: string;
  nome: string;
  categoria: Categoria;
  descricao: string;
  campos: Campo[];
  padrao: Params;
  /** Passo a passo curto de montagem, mostrado embaixo da prévia. */
  montagem: string[];
  /** Pedaço do nome do arquivo exportado (ex.: "caixa-milk-8x8x12cm"). */
  nomeArquivo(p: Params): string;
  gerar(p: Params, ctx: Contexto): Molde;
}

export function num(p: Params, chave: string, padrao = 0): number {
  const v = p[chave];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : padrao;
}

export function str(p: Params, chave: string, padrao = ''): string {
  const v = p[chave];
  return typeof v === 'string' ? v : v === undefined ? padrao : String(v);
}

export function sim(p: Params, chave: string): boolean {
  return p[chave] === true || p[chave] === 'sim';
}

/** Campo de espessura do papel, igual em todos os moldes de caixa. */
export const CAMPO_PAPEL: CampoOpcoes = {
  chave: 'papel',
  rotulo: 'Papel',
  tipo: 'opcoes',
  ajuda: 'A espessura entra como folga nas dobras: os painéis crescem um pouco pra caixa fechar sem forçar.',
  opcoes: [
    { valor: '0.12', rotulo: 'Sulfite 90–120 g (0,12 mm)' },
    { valor: '0.2', rotulo: 'Color plus / opaline 180 g (0,20 mm)' },
    { valor: '0.25', rotulo: 'Opaline / perolado 240 g (0,25 mm)' },
    { valor: '0.3', rotulo: 'Cartão 250–300 g (0,30 mm)' },
    { valor: '0.4', rotulo: 'Cartão duplex 350 g (0,40 mm)' },
    { valor: '0.6', rotulo: 'Papelão fino / Paraná 0,6 mm' },
  ],
};

export const CAMPO_ABA: CampoNumero = {
  chave: 'aba',
  rotulo: 'Aba de cola',
  tipo: 'numero',
  unidade: 'mm',
  min: 5,
  max: 25,
  passo: 1,
};

export const fmt = (v: number): string => (Math.round(v * 10) / 10).toString().replace('.', ',');
