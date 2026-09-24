/** Modelo do modo "Ilustração": o documento é uma prancheta em mm com camadas
 * vetoriais (caminhos, formas, textos) e imagens de referência. Tudo aqui é
 * puro — sem Angular nem DOM — porque o store, a exportação, o worker de
 * vetorização e os testes dependem destas funções.
 *
 * Cada camada guarda a geometria no próprio espaço local, mais ou menos
 * centrada na origem, e um transform (posição, giro, escala) que a leva pra
 * prancheta. Centrar na origem faz o giro e a escala acontecerem em volta do
 * meio da camada, que é o que a mão espera. */

import { CubicSegment, Point, Polygon } from './contour';

export type { Point, Polygon } from './contour';

/** Um subcaminho: começa em `start` e segue pelos trechos. Fechado quer dizer
 * que o último trecho termina de volta em `start` (o `Z` só marca isso). */
export interface VPath {
  start: Point;
  segments: CubicSegment[];
  closed: boolean;
}

export type LayerKind = 'caminho' | 'forma' | 'texto' | 'imagem';
export type ShapeType = 'retangulo' | 'elipse' | 'estrela' | 'poligono';
export type TextCurve = 'reta' | 'arco' | 'caminho';
export type TextAlign = 'left' | 'center' | 'right';

interface LayerBase {
  id: string;
  name: string;
  /** Posição do centro local na prancheta, em mm. */
  x: number;
  y: number;
  /** Graus, sentido horário (y pra baixo, como no SVG). */
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  fill: string | null;
  stroke: string | null;
  /** Espessura do traço em mm, já na prancheta (não escala com a camada). */
  strokeWidth: number;
  /** Camadas com o mesmo grupo são selecionadas e movidas juntas. */
  groupId: string | null;
  /** Entra no "SVG de corte" (só as linhas que a máquina recorta). */
  cut: boolean;
}

export interface PathLayer extends LayerBase {
  kind: 'caminho';
  paths: VPath[];
}

export interface ShapeLayer extends LayerBase {
  kind: 'forma';
  shape: ShapeType;
  w: number;
  h: number;
  /** Raio dos cantos do retângulo, em mm. */
  radius: number;
  /** Pontas da estrela ou lados do polígono. */
  points: number;
  /** Raio interno da estrela, em fração do externo. */
  innerRatio: number;
}

export interface TextLayer extends LayerBase {
  kind: 'texto';
  text: string;
  fontId: string;
  weight: number;
  /** Altura do corpo (em), em mm. */
  sizeMm: number;
  /** Espaçamento extra entre letras, em milésimos de em (como no Illustrator). */
  tracking: number;
  /** Entrelinha em múltiplos do corpo. */
  lineHeight: number;
  align: TextAlign;
  curve: TextCurve;
  /** Arco: -100 a 100 — a fração do círculo que a linha abraça (100 = volta
   * inteira). Positivo curva pra cima, negativo pra baixo. */
  bend: number;
  /** Caminho-guia do texto, no espaço local da camada. */
  guide: VPath | null;
  /** Onde o texto começa no caminho-guia, 0 a 1. */
  guideOffset: number;
}

export interface ImageLayer extends LayerBase {
  kind: 'imagem';
  src: string;
  w: number;
  h: number;
}

export type Layer = PathLayer | ShapeLayer | TextLayer | ImageLayer;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Matriz afim no formato do SVG: [a b c d e f]. */
export type Matrix = [number, number, number, number, number, number];

export const KAPPA = 0.5522847498;

// ---------- camadas ----------

export function layerBase(id: string, name: string): LayerBase {
  return {
    id, name, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
    visible: true, locked: false, fill: '#222222', stroke: null, strokeWidth: 0.5,
    groupId: null, cut: false,
  };
}

export function layerMatrix(l: Pick<Layer, 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY'>): Matrix {
  const r = (l.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos * l.scaleX, sin * l.scaleX, -sin * l.scaleY, cos * l.scaleY, l.x, l.y];
}

export function applyMatrix(m: Matrix, p: Point): Point {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

export function invertMatrix(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export function matrixAttr(m: Matrix): string {
  return `matrix(${m.map((v) => round(v, 5)).join(' ')})`;
}

/** Traço é dado em mm da prancheta: como o SVG escala o traço junto com a
 * camada, a espessura desenhada precisa descontar a escala. */
export function localStrokeWidth(l: Layer): number {
  const s = Math.sqrt(Math.abs(l.scaleX * l.scaleY)) || 1;
  return l.strokeWidth / s;
}

// ---------- caminhos ----------

export function mapVPath(p: VPath, f: (pt: Point) => Point): VPath {
  return {
    start: f(p.start),
    closed: p.closed,
    segments: p.segments.map((s) => ({ c1: s.c1 ? f(s.c1) : null, c2: s.c2 ? f(s.c2) : null, to: f(s.to) })),
  };
}

export function transformPaths(paths: VPath[], m: Matrix): VPath[] {
  return paths.map((p) => mapVPath(p, (pt) => applyMatrix(m, pt)));
}

export function translatePaths(paths: VPath[], dx: number, dy: number): VPath[] {
  return paths.map((p) => mapVPath(p, ([x, y]) => [x + dx, y + dy]));
}

/** Atributo `d`. Decimais em mm: 3 casas é um micrômetro, bem abaixo de
 * qualquer lâmina ou impressora. */
export function pathsToD(paths: VPath[], decimals = 3): string {
  const f = (v: number): string => String(round(v, decimals));
  const pt = (p: Point): string => `${f(p[0])} ${f(p[1])}`;
  const out: string[] = [];
  for (const p of paths) {
    if (!p.segments.length) continue;
    let d = `M${pt(p.start)}`;
    const n = p.segments.length;
    for (let i = 0; i < n; i++) {
      const s = p.segments[i];
      if (s.c1 && s.c2) d += `C${pt(s.c1)} ${pt(s.c2)} ${pt(s.to)}`;
      // num caminho fechado o último trecho reto é o próprio Z
      else if (!(p.closed && i === n - 1)) d += `L${pt(s.to)}`;
    }
    if (p.closed) d += 'Z';
    out.push(d);
  }
  return out.join('');
}

export function cubicPoint(a: Point, s: CubicSegment, t: number): Point {
  if (!s.c1 || !s.c2) return [a[0] + (s.to[0] - a[0]) * t, a[1] + (s.to[1] - a[1]) * t];
  const u = 1 - t;
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  return [
    w0 * a[0] + w1 * s.c1[0] + w2 * s.c2[0] + w3 * s.to[0],
    w0 * a[1] + w1 * s.c1[1] + w2 * s.c2[1] + w3 * s.to[1],
  ];
}

/** Transforma o caminho em polilinha, com pontos a no máximo `step` um do
 * outro ao longo das curvas. Fechado não repete o primeiro ponto no fim. */
export function flattenPath(p: VPath, step = 0.1): Polygon {
  const pts: Polygon = [p.start];
  let from = p.start;
  for (const s of p.segments) {
    if (s.c1 && s.c2) {
      const len = dist(from, s.c1) + dist(s.c1, s.c2) + dist(s.c2, s.to);
      const n = Math.max(2, Math.min(400, Math.ceil(len / step)));
      for (let i = 1; i <= n; i++) pts.push(cubicPoint(from, s, i / n));
    } else {
      pts.push(s.to);
    }
    from = s.to;
  }
  if (p.closed && pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 1e-9) pts.pop();
  return pts;
}

export function pathsBounds(paths: VPath[]): Bounds | null {
  let b: Bounds | null = null;
  for (const p of paths) {
    for (const pt of flattenPath(p, 0.5)) b = growBounds(b, pt);
  }
  return b;
}

export function growBounds(b: Bounds | null, [x, y]: Point): Bounds {
  if (!b) return { minX: x, minY: y, maxX: x, maxY: y };
  return { minX: Math.min(b.minX, x), minY: Math.min(b.minY, y), maxX: Math.max(b.maxX, x), maxY: Math.max(b.maxY, y) };
}

export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

export function boundsCorners(b: Bounds): Point[] {
  return [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]];
}

export function boundsCenter(b: Bounds): Point {
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

/** Recentra os caminhos na origem; devolve também o deslocamento aplicado,
 * pra quem precisa compensar a posição da camada. */
export function centerPaths(paths: VPath[]): { paths: VPath[]; cx: number; cy: number } {
  const b = pathsBounds(paths);
  if (!b) return { paths, cx: 0, cy: 0 };
  const [cx, cy] = boundsCenter(b);
  return { paths: translatePaths(paths, -cx, -cy), cx, cy };
}

/** Mesmo caminho percorrido ao contrário (as alças trocam de lado). */
export function reversePath(p: VPath): VPath {
  const anchors = [p.start, ...p.segments.map((s) => s.to)];
  const segments = [];
  for (let i = p.segments.length - 1; i >= 0; i--) {
    const s = p.segments[i];
    segments.push({ c1: s.c2, c2: s.c1, to: anchors[i] });
  }
  return { start: anchors[anchors.length - 1], closed: p.closed, segments };
}

/** Fração do comprimento do caminho em que fica o ponto mais alto. */
export function topFraction(p: VPath): number {
  const pts = flattenPath(p, 0.2);
  let total = 0, at = 0, bestY = Infinity;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) total += dist(pts[i - 1], pts[i]);
    if (pts[i][1] < bestY) { bestY = pts[i][1]; at = total; }
  }
  if (p.closed && pts.length > 1) total += dist(pts[pts.length - 1], pts[0]);
  return total > 0 ? at / total : 0;
}

export function countNodes(paths: VPath[]): number {
  return paths.reduce((n, p) => n + p.segments.length + (p.closed ? 0 : 1), 0);
}

/** Polígono fechado vira caminho de retas. */
export function polygonToVPath(poly: Polygon): VPath {
  return {
    start: poly[0],
    closed: true,
    segments: [...poly.slice(1), poly[0]].map((to) => ({ c1: null, c2: null, to })),
  };
}

// ---------- formas ----------

export function rectPaths(w: number, h: number, radius: number): VPath[] {
  const x0 = -w / 2, y0 = -h / 2, x1 = w / 2, y1 = h / 2;
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r < 1e-6) return [polygonToVPath([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])];
  const k = r * KAPPA;
  const line = (to: Point): CubicSegment => ({ c1: null, c2: null, to });
  return [{
    start: [x0 + r, y0],
    closed: true,
    segments: [
      line([x1 - r, y0]),
      { c1: [x1 - r + k, y0], c2: [x1, y0 + r - k], to: [x1, y0 + r] },
      line([x1, y1 - r]),
      { c1: [x1, y1 - r + k], c2: [x1 - r + k, y1], to: [x1 - r, y1] },
      line([x0 + r, y1]),
      { c1: [x0 + r - k, y1], c2: [x0, y1 - r + k], to: [x0, y1 - r] },
      line([x0, y0 + r]),
      { c1: [x0, y0 + r - k], c2: [x0 + r - k, y0], to: [x0 + r, y0] },
    ],
  }];
}

export function ellipsePaths(w: number, h: number): VPath[] {
  const rx = w / 2, ry = h / 2, kx = rx * KAPPA, ky = ry * KAPPA;
  return [{
    start: [rx, 0],
    closed: true,
    segments: [
      { c1: [rx, ky], c2: [kx, ry], to: [0, ry] },
      { c1: [-kx, ry], c2: [-rx, ky], to: [-rx, 0] },
      { c1: [-rx, -ky], c2: [-kx, -ry], to: [0, -ry] },
      { c1: [kx, -ry], c2: [rx, -ky], to: [rx, 0] },
    ],
  }];
}

/** Estrela ou polígono regular, esticado pra caber em w × h. */
export function starPaths(w: number, h: number, points: number, innerRatio: number, star: boolean): VPath[] {
  const n = Math.max(3, Math.min(60, Math.round(points)));
  const verts: Point[] = [];
  const total = star ? n * 2 : n;
  for (let i = 0; i < total; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / total;
    const r = star && i % 2 === 1 ? Math.max(0.05, Math.min(0.95, innerRatio)) : 1;
    verts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  // Encaixa a forma na caixa pedida, não no círculo unitário: um triângulo
  // de 40 mm tem 40 mm de altura, não 34.
  let b: Bounds | null = null;
  for (const v of verts) b = growBounds(b, v);
  const bw = b!.maxX - b!.minX || 1;
  const bh = b!.maxY - b!.minY || 1;
  const [cx, cy] = boundsCenter(b!);
  return [polygonToVPath(verts.map(([x, y]) => [((x - cx) / bw) * w, ((y - cy) / bh) * h]))];
}

export function shapePaths(l: Pick<ShapeLayer, 'shape' | 'w' | 'h' | 'radius' | 'points' | 'innerRatio'>): VPath[] {
  switch (l.shape) {
    case 'retangulo': return rectPaths(l.w, l.h, l.radius);
    case 'elipse': return ellipsePaths(l.w, l.h);
    case 'estrela': return starPaths(l.w, l.h, l.points, l.innerRatio, true);
    case 'poligono': return starPaths(l.w, l.h, l.points, 1, false);
  }
}

// ---------- cores ----------

export function normalizeHex(color: string | null | undefined): string | null {
  if (!color) return null;
  const c = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  if (/^#[0-9a-f]{3}$/.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  return null;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// ---------- utilidades ----------

export function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
