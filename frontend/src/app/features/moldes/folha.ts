/** Folha de corte: distribui as peças (e as cópias) em folhas do tamanho do
 * papel e escreve os arquivos pra Silhouette — SVG em mm (Designer Edition)
 * e DXF R12 (edição Basic). Corte em vermelho, dobra em azul: no Studio, cada
 * cor vira uma ação ("Cortar" / "Vinco" ou "Perfurar"). */

import { cubicToPolyline, buildDxf, DxfPolyline, pageFrame } from '../imagem/dxf';
import { Bounds, Matrix, VPath, matrixAttr, pathsBounds, pathsToD, transformPaths, unionBounds } from '../imagem/illustration-model';
import { tracejar } from './geometria';
import { Peca } from './modelo';

export interface Formato {
  id: string;
  nome: string;
  w: number;
  h: number;
}

export const FORMATOS: Formato[] = [
  { id: 'a4', nome: 'A4 (21 × 29,7 cm)', w: 210, h: 297 },
  { id: 'carta', nome: 'Carta (21,6 × 27,9 cm)', w: 215.9, h: 279.4 },
  { id: 'a3', nome: 'A3 (29,7 × 42 cm)', w: 297, h: 420 },
  { id: 'base30', nome: 'Base 30 × 30 cm (Cameo)', w: 304.8, h: 304.8 },
  { id: 'base30x60', nome: 'Base 30 × 60 cm (Cameo)', w: 304.8, h: 609.6 },
];

export type ModoDobra = 'linha' | 'tracejado' | 'nenhuma';
export type Orientacao = 'auto' | 'retrato' | 'paisagem';

export interface OpcoesFolha {
  formato: Formato;
  orientacao: Orientacao;
  /** Margem livre nas bordas, em mm (a Silhouette não corta encostado na borda). */
  margem: number;
  /** Espaço entre peças, em mm. */
  espaco: number;
  copias: number;
}

export interface ItemNaFolha {
  peca: Peca;
  /** Leva as coordenadas da peça pra folha. */
  m: Matrix;
  /** Caixa ocupada na folha. */
  x: number;
  y: number;
  w: number;
  h: number;
  girada: boolean;
}

export interface Folha {
  w: number;
  h: number;
  itens: ItemNaFolha[];
}

export interface Distribuicao {
  folhas: Folha[];
  /** Peças maiores que a área útil da folha (mesmo giradas). */
  naoCabem: string[];
}

export function limitesDaPeca(p: Peca): Bounds | null {
  return unionBounds(pathsBounds(p.corte), pathsBounds(p.dobra));
}

/** Prateleiras: enche a linha da esquerda pra direita e abre outra embaixo;
 * gira a peça 90° quando só assim ela cabe (na folha ou no resto da linha). */
function distribuirEm(pecas: Peca[], W: number, H: number, o: OpcoesFolha): Distribuicao {
  const areaW = W - 2 * o.margem;
  const areaH = H - 2 * o.margem;
  const folhas: Folha[] = [];
  const naoCabem: string[] = [];
  let folha: Folha | null = null;
  let cx = 0, cy = 0, alturaLinha = 0;
  const novaFolha = (): Folha => {
    const f: Folha = { w: W, h: H, itens: [] };
    folhas.push(f);
    cx = 0; cy = 0; alturaLinha = 0;
    return f;
  };
  const copias = Math.max(1, Math.round(o.copias));
  for (let c = 0; c < copias; c++) {
    for (const peca of pecas) {
      const b = limitesDaPeca(peca);
      if (!b) continue;
      const pw = b.maxX - b.minX;
      const ph = b.maxY - b.minY;
      const cabeReta = pw <= areaW + 1e-6 && ph <= areaH + 1e-6;
      const cabeGirada = ph <= areaW + 1e-6 && pw <= areaH + 1e-6;
      if (!cabeReta && !cabeGirada && c === 0) naoCabem.push(peca.nome);
      if (!folha) folha = novaFolha();
      const naLinha = (w: number, h: number): boolean => cx + w <= areaW + 1e-6 && cy + h <= areaH + 1e-6;
      let girada = !cabeReta && cabeGirada;
      let w = girada ? ph : pw, h = girada ? pw : ph;
      if (!naLinha(w, h) && cabeReta && cabeGirada && naLinha(ph, pw)) {
        girada = !girada;
        [w, h] = [h, w];
      }
      if (!naLinha(w, h)) {
        // próxima linha; se nem assim couber, próxima folha
        if (cx > 0) { cx = 0; cy += alturaLinha + o.espaco; alturaLinha = 0; }
        if (!naLinha(w, h) && (folha.itens.length > 0)) folha = novaFolha();
      }
      const x = o.margem + cx;
      const y = o.margem + cy;
      const m: Matrix = girada ? [0, 1, -1, 0, x + b.maxY, y - b.minX] : [1, 0, 0, 1, x - b.minX, y - b.minY];
      folha.itens.push({ peca, m, x, y, w, h, girada });
      cx += w + o.espaco;
      alturaLinha = Math.max(alturaLinha, h);
    }
  }
  return { folhas, naoCabem };
}

export function distribuir(pecas: Peca[], o: OpcoesFolha): Distribuicao {
  const { w, h } = o.formato;
  const curto = Math.min(w, h), longo = Math.max(w, h);
  if (o.orientacao === 'retrato') return distribuirEm(pecas, curto, longo, o);
  if (o.orientacao === 'paisagem') return distribuirEm(pecas, longo, curto, o);
  const r = distribuirEm(pecas, curto, longo, o);
  const p = distribuirEm(pecas, longo, curto, o);
  return p.folhas.length < r.folhas.length || (p.naoCabem.length < r.naoCabem.length) ? p : r;
}

// ---------------------------------------------------------------- SVG

export interface OpcoesSaida {
  dobra: ModoDobra;
  /** Tracejado cortado: mm de corte e mm de papel inteiro. */
  traco: number;
  vao: number;
  /** Fotos e fundos impressos (o PNG de impressão sai disso). */
  arte: boolean;
  /** Linhas de corte/dobra (o SVG de corte). */
  linhas: boolean;
  /** Fundo branco e traço mais grosso, pra prévia na tela. */
  previa?: boolean;
}

export const COR_CORTE = '#e5212d';
export const COR_DOBRA = '#1f6fe5';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const r3 = (v: number): string => String(Math.round(v * 1000) / 1000);

export function linhasDoItem(item: ItemNaFolha, o: Pick<OpcoesSaida, 'dobra' | 'traco' | 'vao'>): { corte: VPath[]; dobra: VPath[]; picote: VPath[] } {
  const corte = transformPaths(item.peca.corte, item.m);
  const dobraBase = transformPaths(item.peca.dobra, item.m);
  if (o.dobra === 'nenhuma') return { corte, dobra: [], picote: [] };
  if (o.dobra === 'tracejado') return { corte, dobra: [], picote: dobraBase.flatMap((d) => tracejar(d, o.traco, o.vao)) };
  return { corte, dobra: dobraBase, picote: [] };
}

export function svgDaFolha(folha: Folha, o: OpcoesSaida): string {
  const partes: string[] = [];
  const defs: string[] = [];
  const w = r3(folha.w), h = r3(folha.h);
  if (o.previa) partes.push(`<rect width="${w}" height="${h}" fill="#ffffff"/>`);

  if (o.arte) {
    folha.itens.forEach((item, i) => {
      const arte = item.peca.arte;
      if (!arte) return;
      const g: string[] = [];
      if (arte.fundo) g.push(`<path d="${pathsToD(arte.fundo.paths)}" fill="${esc(arte.fundo.cor)}"/>`);
      if (arte.foto) {
        const f = arte.foto;
        let clip = '';
        if (f.clip) {
          const id = `clip${i}`;
          defs.push(`<clipPath id="${id}"><path d="${pathsToD(f.clip)}"/></clipPath>`);
          clip = ` clip-path="url(#${id})"`;
        }
        g.push(`<g${clip}><image x="${r3(f.x)}" y="${r3(f.y)}" width="${r3(f.w)}" height="${r3(f.h)}" preserveAspectRatio="none" href="${esc(f.src)}" xlink:href="${esc(f.src)}"/></g>`);
      }
      partes.push(`<g transform="${matrixAttr(item.m)}">${g.join('')}</g>`);
    });
  }

  if (o.linhas) {
    const sw = o.previa ? 0.35 : 0.1;
    const corte: string[] = [];
    const dobra: string[] = [];
    for (const item of folha.itens) {
      const l = linhasDoItem(item, o);
      corte.push(pathsToD(l.corte));
      if (l.picote.length) corte.push(pathsToD(l.picote));
      if (l.dobra.length) dobra.push(pathsToD(l.dobra));
    }
    if (dobra.length) {
      const dash = o.previa ? ' stroke-dasharray="2 1.2"' : '';
      partes.push(`<g id="dobra" fill="none" stroke="${COR_DOBRA}" stroke-width="${sw}"${dash}><path d="${dobra.join('')}"/></g>`);
    }
    partes.push(`<g id="corte" fill="none" stroke="${COR_CORTE}" stroke-width="${sw}" stroke-linejoin="round"><path d="${corte.join('')}"/></g>`);
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`,
    defs.length ? `<defs>${defs.join('')}</defs>` : '',
    ...partes,
    '</svg>',
  ].join('');
}

// ---------------------------------------------------------------- DXF

export function dxfDaFolha(folha: Folha, o: Pick<OpcoesSaida, 'dobra' | 'traco' | 'vao'>): string {
  const linhas: DxfPolyline[] = [pageFrame(folha.w, folha.h)];
  const add = (paths: VPath[], layer: string): void => {
    for (const p of paths) linhas.push({ layer, closed: p.closed, points: cubicToPolyline(p) });
  };
  for (const item of folha.itens) {
    const l = linhasDoItem(item, o);
    add(l.corte, 'CORTE');
    add(l.picote, 'CORTE');
    add(l.dobra, 'DOBRA');
  }
  return buildDxf(linhas, [{ name: 'CORTE', color: 1 }, { name: 'DOBRA', color: 5 }, { name: 'PAGINA', color: 8 }], folha.h);
}

export function temArte(folhas: Folha[]): boolean {
  return folhas.some((f) => f.itens.some((i) => i.peca.arte?.foto || i.peca.arte?.fundo));
}
