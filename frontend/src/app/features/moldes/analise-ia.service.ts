import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { loadImageElement } from '../imagem/svg-template';
import { Campo, Params, TipoMolde, Valor } from './modelo';

/** Lado maior da foto mandada pra IA: dá pra ver a embalagem sem gastar token à toa. */
const MAX_LADO = 1280;
/** Campos que a foto não mostra (papel, aba, em quantas peças cortar). */
const NAO_SE_VE = new Set(['papel', 'aba', 'partes']);

export interface ResultadoAnalise {
  usouIa: boolean;
  motivo: string | null;
  tipo: string | null;
  confianca: 'alta' | 'media' | 'baixa' | null;
  valores: Record<string, Valor> | null;
  explicacao: string | null;
}

interface CampoCatalogo {
  chave: string;
  rotulo: string;
  unidade: string | null;
  min: number | null;
  max: number | null;
  opcoes: string[] | null;
}

function campoDoCatalogo(c: Campo): CampoCatalogo | null {
  if (NAO_SE_VE.has(c.chave)) return null;
  switch (c.tipo) {
    case 'numero': return { chave: c.chave, rotulo: c.rotulo, unidade: c.unidade, min: c.min, max: c.max, opcoes: null };
    case 'opcoes': return { chave: c.chave, rotulo: c.rotulo, unidade: null, min: null, max: null, opcoes: c.opcoes.map((o) => o.valor) };
    case 'sim-nao': return { chave: c.chave, rotulo: c.rotulo, unidade: 'sim-nao', min: null, max: null, opcoes: null };
    default: return null;
  }
}

/** Os moldes, do jeito que o servidor repassa pra IA (só o que dá pra ver numa foto). */
export function catalogoParaIa(tipos: TipoMolde[]) {
  return tipos.map((t) => ({
    id: t.id,
    nome: t.nome,
    descricao: t.descricao,
    campos: t.campos.map(campoDoCatalogo).filter((c): c is CampoCatalogo => !!c),
  }));
}

/** Valores da IA por cima dos atuais, conferidos de novo contra os campos. */
export function aplicarValores(tipo: TipoMolde, atuais: Params, valores: Record<string, Valor>): Params {
  const out: Params = { ...atuais };
  for (const c of tipo.campos) {
    const v = valores[c.chave];
    if (v === undefined || NAO_SE_VE.has(c.chave)) continue;
    if (c.tipo === 'numero' && typeof v === 'number' && Number.isFinite(v)) {
      // arredonda pro passo do campo (a IA devolve 7.34 cm; o campo anda de 0,5)
      const passo = c.passo || 1;
      out[c.chave] = Math.max(c.min, Math.min(c.max, Math.round(Math.round(v / passo) * passo * 100) / 100));
    } else if (c.tipo === 'opcoes' && typeof v === 'string' && c.opcoes.some((o) => o.valor === v)) {
      out[c.chave] = v;
    } else if (c.tipo === 'sim-nao' && typeof v === 'boolean') {
      out[c.chave] = v;
    }
  }
  return out;
}

@Injectable({ providedIn: 'root' })
export class AnaliseIaService {
  private readonly http = inject(HttpClient);

  async reduzir(file: File): Promise<string> {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImageElement(url);
      const s = Math.min(1, MAX_LADO / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * s));
      c.height = Math.max(1, Math.round(img.naturalHeight * s));
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.85);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async analisar(imagem: string, tipos: TipoMolde[], medida: { chave: string; valor: number } | null): Promise<ResultadoAnalise> {
    try {
      return await firstValueFrom(
        this.http.post<ResultadoAnalise>('/api/moldes/analisar', { imagem, tipos: catalogoParaIa(tipos), medidaConhecida: medida }),
      );
    } catch (err: unknown) {
      const erro = (err as { error?: { erro?: string } }).error?.erro;
      return { usouIa: false, motivo: erro ?? 'Não foi possível falar com o serviço de IA.', tipo: null, confianca: null, valores: null, explicacao: null };
    }
  }
}
