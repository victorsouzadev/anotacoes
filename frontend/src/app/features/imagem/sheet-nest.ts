/** Encaixe por silhueta: as peças entram na folha pelo formato de verdade, não
 * pela caixa — um coração cabe no vão de uma estrela. A folha vira uma grade
 * de células (1 mm), cada peça uma máscara nessa grade, e cada uma entra no
 * primeiro lugar livre de cima pra baixo, da esquerda pra direita, testando
 * os quatro giros. As somas acumuladas por linha deixam o teste de colisão de
 * cada trecho de linha em tempo constante. */

import { Rotation } from './sheet';

export interface NestShape {
  id: string;
  /** Largura e altura em células. */
  w: number;
  h: number;
  /** 1 onde a peça ocupa, linha a linha. */
  mask: Uint8Array;
}

export interface NestPlacement {
  id: string;
  /** Canto de cima à esquerda da caixa girada, em células. */
  x: number;
  y: number;
  rot: Rotation;
  /** Caixa girada, em células. */
  w: number;
  h: number;
}

export interface NestOptions {
  sheetW: number;
  sheetH: number;
  margin: number;
  spacing: number;
  rotate: boolean;
}

interface Oriented {
  rot: Rotation;
  w: number;
  h: number;
  mask: Uint8Array;
  /** Trechos ocupados da máscara engordada pelo espaçamento, por linha
   * (relativos ao canto da peça; podem ser negativos). */
  spans: { dy: number; x0: number; x1: number }[];
}

export function rotateMask(mask: Uint8Array, w: number, h: number): { mask: Uint8Array; w: number; h: number } {
  // 90° horário: (x, y) → (h - 1 - y, x)
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[x * h + (h - 1 - y)] = mask[y * w + x];
  }
  return { mask: out, w: h, h: w };
}

/** Engorda a máscara em `r` células (disco) e devolve os trechos por linha. */
function dilatedSpans(mask: Uint8Array, w: number, h: number, r: number): Oriented['spans'] {
  const W = w + 2 * r, H = h + 2 * r;
  const grown = new Uint8Array(W * H);
  const offsets: [number, number][] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) offsets.push([dx, dy]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (const [dx, dy] of offsets) grown[(y + r + dy) * W + (x + r + dx)] = 1;
    }
  }
  const spans: Oriented['spans'] = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!grown[y * W + x]) { x++; continue; }
      const x0 = x;
      while (x < W && grown[y * W + x]) x++;
      spans.push({ dy: y - r, x0: x0 - r, x1: x - 1 - r });
    }
  }
  return spans;
}

function orientations(s: NestShape, rotate: boolean, spacing: number): Oriented[] {
  const out: Oriented[] = [];
  let cur = { mask: s.mask, w: s.w, h: s.h };
  const rots: Rotation[] = rotate ? [0, 90, 180, 270] : [0];
  for (const rot of rots) {
    if (rot !== 0) cur = rotateMask(cur.mask, cur.w, cur.h);
    out.push({ rot, w: cur.w, h: cur.h, mask: cur.mask, spans: dilatedSpans(cur.mask, cur.w, cur.h, spacing) });
  }
  return out;
}

export function nestShapes(shapes: NestShape[], o: NestOptions): { placed: NestPlacement[]; overflow: string[] } {
  const { sheetW: W, sheetH: H, margin: m } = o;
  const occ = new Uint8Array(W * H);
  // soma acumulada por linha: pre[y*(W+1) + x] = ocupados em [0, x)
  const pre = new Int32Array(H * (W + 1));
  const rebuildRow = (y: number): void => {
    let acc = 0;
    const base = y * (W + 1);
    pre[base] = 0;
    for (let x = 0; x < W; x++) {
      acc += occ[y * W + x];
      pre[base + x + 1] = acc;
    }
  };
  const busy = (y: number, x0: number, x1: number): boolean => {
    if (y < 0 || y >= H) return false;
    const a = Math.max(0, x0), b = Math.min(W - 1, x1);
    if (a > b) return false;
    const base = y * (W + 1);
    return pre[base + b + 1] - pre[base + a] > 0;
  };

  // as maiores primeiro: as pequenas preenchem os vãos que sobram
  const order = [...shapes].sort((a, b) => countOnes(b.mask) - countOnes(a.mask));
  const placed: NestPlacement[] = [];
  const overflow: string[] = [];
  const cache = new Map<NestShape['mask'], Oriented[]>();

  for (const s of order) {
    let ors = cache.get(s.mask);
    if (!ors) {
      ors = orientations(s, o.rotate, o.spacing);
      cache.set(s.mask, ors);
    }
    let best: { or: Oriented; x: number; y: number } | null = null;
    for (const or of ors) {
      const maxX = W - m - or.w, maxY = H - m - or.h;
      if (maxX < m || maxY < m) continue;
      let found: { x: number; y: number } | null = null;
      for (let y = m; y <= maxY && !found; y++) {
        // já não bate a melhor achada: pula o resto deste giro
        if (best && y > best.y) break;
        for (let x = m; x <= maxX; x++) {
          let hit = false;
          for (const sp of or.spans) {
            if (busy(y + sp.dy, x + sp.x0, x + sp.x1)) { hit = true; break; }
          }
          if (!hit) { found = { x, y }; break; }
        }
      }
      if (found && (!best || found.y < best.y || (found.y === best.y && found.x < best.x))) best = { or, ...found };
    }
    if (!best) {
      overflow.push(s.id);
      continue;
    }
    const { or, x, y } = best;
    for (let yy = 0; yy < or.h; yy++) {
      let touched = false;
      for (let xx = 0; xx < or.w; xx++) {
        if (or.mask[yy * or.w + xx]) {
          occ[(y + yy) * W + x + xx] = 1;
          touched = true;
        }
      }
      if (touched) rebuildRow(y + yy);
    }
    placed.push({ id: s.id, x, y, rot: or.rot, w: or.w, h: or.h });
  }
  return { placed, overflow };
}

function countOnes(m: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < m.length; i++) n += m[i];
  return n;
}
