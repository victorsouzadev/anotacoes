/** Operações vetoriais do modo Ilustração: soldar/combinar formas, contorno
 * com margem, separar formas e edição de nós. As operações de área rodam no
 * Clipper (inteiros em micrômetros, então não há erro de ponto flutuante nas
 * interseções) e o resultado volta a virar curva com o mesmo ajuste de Bézier
 * da linha de corte do Print & Cut — polilinha faz a lâmina engasgar. */

import * as ClipperLib from 'clipper-lib';
import { CORNER_ANGLE, CubicSegment, Point, Polygon, pointInPolygon, polygonArea, polygonToCubics, polylineToCubics } from './contour';
import { VPath, dist, flattenPath } from './illustration-model';

/** Micrômetros por mm: a grade inteira do Clipper. */
const SCALE = 1000;
/** Espaçamento, em mm, da polilinha que representa uma curva nas operações. */
const FLATTEN_STEP = 0.05;
/** Unidades de ajuste por mm: o ajuste de curvas e o detector de cantos foram
 * afinados pra amostras de ~1 unidade, então a conta roda nessa escala. */
const FIT_SCALE = 20;
/** Erro máximo entre a curva ajustada e o resultado exato, em mm. */
const FIT_TOLERANCE_MM = 0.02;
const ARC_TOLERANCE_MM = 0.01;
/** Vértices a menos disto da reta dos vizinhos são ruído da grade inteira. */
const CLEAN_DISTANCE_MM = 0.004;

export type BoolOp = 'unir' | 'subtrair' | 'intersecao' | 'excluir';

/** Uma camada vista pelas operações de área: caminhos já na prancheta, mais o
 * quanto o traço engorda a forma. */
export interface AreaSource {
  paths: VPath[];
  /** Metade da espessura do traço, em mm (0 sem traço). */
  pad: number;
  /** Só traço, sem preenchimento: a área é a do traço. */
  strokeOnly: boolean;
}

// ---------- Clipper ----------

function toInt(poly: Polygon): ClipperLib.Path {
  return poly.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
}

function fromInt(path: ClipperLib.Path): Polygon {
  return path.map((p) => [p.X / SCALE, p.Y / SCALE] as Point);
}

function execute(ct: ClipperLib.ClipType, subject: ClipperLib.Paths, clip: ClipperLib.Paths, fill: ClipperLib.PolyFillType): ClipperLib.Paths {
  const c = new ClipperLib.Clipper();
  c.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const out: ClipperLib.Paths = [];
  c.Execute(ct, out, fill, fill);
  return out;
}

/** A área que a camada pinta. O preenchimento segue a regra par-ímpar (é o
 * que o SVG exportado usa), então a camada é normalizada sozinha antes de se
 * misturar com as outras — senão duas camadas sobrepostas se anulariam. */
export function regionOf(src: AreaSource): ClipperLib.Paths {
  const closed = src.paths.filter((p) => p.closed).map((p) => toInt(flattenPath(p, FLATTEN_STEP))).filter((p) => p.length >= 3);
  const open = src.paths.filter((p) => !p.closed).map((p) => toInt(flattenPath(p, FLATTEN_STEP))).filter((p) => p.length >= 2);
  const parts: ClipperLib.Paths = [];
  if (!src.strokeOnly && closed.length) {
    let fill = execute(ClipperLib.ClipType.ctUnion, closed, [], ClipperLib.PolyFillType.pftEvenOdd);
    if (src.pad > 0) fill = offsetInt(fill, src.pad, ClipperLib.EndType.etClosedPolygon);
    parts.push(...fill);
  }
  if (src.pad > 0) {
    // Traço sem preenchimento (ou caminho aberto) ocupa só a faixa do traço.
    if (src.strokeOnly && closed.length) parts.push(...offsetInt(closed, src.pad, ClipperLib.EndType.etClosedLine));
    if (open.length) parts.push(...offsetInt(open, src.pad, ClipperLib.EndType.etOpenRound));
  }
  return parts.length ? execute(ClipperLib.ClipType.ctUnion, parts, [], ClipperLib.PolyFillType.pftNonZero) : [];
}

function offsetInt(paths: ClipperLib.Paths, deltaMm: number, end: ClipperLib.EndType): ClipperLib.Paths {
  // Tolerância de arco de 10 µm: mais fina que isso só enche o contorno de
  // microarcos em cada vértice da curva achatada, que viram trechos minúsculos.
  const co = new ClipperLib.ClipperOffset(2, ARC_TOLERANCE_MM * SCALE);
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, end);
  const out: ClipperLib.Paths = [];
  co.Execute(out, deltaMm * SCALE);
  return out;
}

function unionAll(regions: ClipperLib.Paths[]): ClipperLib.Paths {
  return execute(ClipperLib.ClipType.ctUnion, regions.flat(), [], ClipperLib.PolyFillType.pftNonZero);
}

/** Combina as áreas. `sources` vem na ordem de empilhamento (de trás pra
 * frente): "subtrair" tira da camada de baixo tudo o que está por cima. */
export function booleanPaths(op: BoolOp, sources: AreaSource[]): VPath[] {
  const regions = sources.map(regionOf).filter((r) => r.length);
  if (!regions.length) return [];
  let result: ClipperLib.Paths;
  const nz = ClipperLib.PolyFillType.pftNonZero;
  switch (op) {
    case 'unir':
      result = unionAll(regions);
      break;
    case 'subtrair':
      result = execute(ClipperLib.ClipType.ctDifference, regions[0], unionAll(regions.slice(1)), nz);
      break;
    case 'intersecao':
      result = regions.slice(1).reduce((acc, r) => execute(ClipperLib.ClipType.ctIntersection, acc, r, nz), regions[0]);
      break;
    case 'excluir':
      result = regions.slice(1).reduce((acc, r) => execute(ClipperLib.ClipType.ctXor, acc, r, nz), regions[0]);
      break;
  }
  return intPathsToCurves(result);
}

export interface OffsetOptions {
  /** Só o contorno de fora: vãos internos (o miolo do "O") somem. */
  outerOnly: boolean;
}

/** Contorno com margem em volta de tudo: é o recorte de adesivo, feito direto
 * no vetor em vez de no raster. */
export function offsetOutline(sources: AreaSource[], marginMm: number, options: OffsetOptions): VPath[] {
  const regions = sources.map(regionOf).filter((r) => r.length);
  if (!regions.length) return [];
  let result = unionAll(regions);
  if (marginMm !== 0) result = offsetInt(result, marginMm, ClipperLib.EndType.etClosedPolygon);
  // A margem pode ter juntado ilhas: a união depois do offset limpa as sobras.
  result = execute(ClipperLib.ClipType.ctUnion, result, [], ClipperLib.PolyFillType.pftNonZero);
  if (options.outerOnly) result = result.filter((p) => ClipperLib.Clipper.Orientation(p));
  return intPathsToCurves(result);
}

function intPathsToCurves(paths: ClipperLib.Paths): VPath[] {
  return ClipperLib.Clipper.CleanPolygons(paths, CLEAN_DISTANCE_MM * SCALE)
    .map(fromInt)
    .filter((poly) => poly.length >= 3 && Math.abs(polygonArea(poly)) > 1e-4)
    .map((poly) => fitPolygon(poly));
}

/** Ajusta Bézier num polígono em mm. As arestas são subdivididas em vez de a
 * volta toda ser reamostrada, pra quina de verdade continuar existindo como
 * vértice — senão a reamostragem cortaria o canto. */
export function fitPolygon(poly: Polygon, toleranceMm = FIT_TOLERANCE_MM): VPath {
  const dense: Polygon = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ax = a[0] * FIT_SCALE, ay = a[1] * FIT_SCALE;
    const bx = b[0] * FIT_SCALE, by = b[1] * FIT_SCALE;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let k = 0; k < n; k++) dense.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  const cubic = polygonToCubics(dense, { tolerance: toleranceMm * FIT_SCALE, cornerAngle: CORNER_ANGLE });
  const f = (p: Point): Point => [p[0] / FIT_SCALE, p[1] / FIT_SCALE];
  return {
    start: f(cubic.start),
    closed: true,
    segments: cubic.segments.map((s) => ({ c1: s.c1 ? f(s.c1) : null, c2: s.c2 ? f(s.c2) : null, to: f(s.to) })),
  };
}

// ---------- mão livre e borracha ----------

/** Reamostra uma polilinha com passo fixo (em mm). */
function resample(poly: Polygon, step: number): Polygon {
  const out: Polygon = [poly[0]];
  let carry = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1], b = poly[i];
    const len = dist(a, b);
    let t = step - carry;
    while (t <= len) {
      out.push([a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len]);
      t += step;
    }
    carry = len - (t - step);
  }
  const end = poly[poly.length - 1];
  if (dist(out[out.length - 1], end) > step * 0.2) out.push(end);
  return out;
}

/** Média móvel: tira o tremido da mão sem mexer nas pontas. */
function smoothPolyline(poly: Polygon, radius: number, closed: boolean): Polygon {
  const n = poly.length;
  if (n < 3 || radius < 1) return poly;
  return poly.map((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) return p;
    let sx = 0, sy = 0, c = 0;
    for (let k = -radius; k <= radius; k++) {
      let j = i + k;
      if (closed) j = (j + n) % n;
      else if (j < 0 || j >= n) continue;
      sx += poly[j][0];
      sy += poly[j][1];
      c++;
    }
    return [sx / c, sy / c] as Point;
  });
}

/** Traço do lápis (pontos em mm, como a mão passou) vira curva. `closed`
 * fecha a forma (terminou perto de onde começou). */
export function fitFreehand(points: Polygon, toleranceMm: number, closed: boolean): VPath | null {
  if (points.length < 2) return null;
  const total = points.slice(1).reduce((s, p, i) => s + dist(points[i], p), 0);
  if (total < 0.2) return null;
  // passo de ~1/40 do comprimento, entre 0,1 e 1 mm: denso o bastante pro
  // ajuste, esparso o bastante pra média móvel alisar o tremido
  const step = Math.min(1, Math.max(0.1, total / 400));
  const smooth = smoothPolyline(resample(points, step), 3, closed);
  if (closed && smooth.length >= 4) return fitPolygon(smooth, toleranceMm);
  const dense = resample(smooth, 1 / FIT_SCALE).map(([x, y]) => [x * FIT_SCALE, y * FIT_SCALE] as Point);
  const cubic = polylineToCubics(dense, { tolerance: toleranceMm * FIT_SCALE });
  const f = (p: Point): Point => [p[0] / FIT_SCALE, p[1] / FIT_SCALE];
  return {
    start: f(cubic.start),
    closed: false,
    segments: cubic.segments.map((s) => ({ c1: s.c1 ? f(s.c1) : null, c2: s.c2 ? f(s.c2) : null, to: f(s.to) })),
  };
}

/** Borracha vetorial: tira da área da camada a faixa que a borracha varreu.
 * `null` quando a borracha nem encostou (a camada fica como está). */
export function eraseArea(src: AreaSource, stroke: Polygon, radiusMm: number): VPath[] | null {
  const region = regionOf(src);
  if (!region.length || !stroke.length) return null;
  const line = toInt(stroke.length === 1 ? [stroke[0], [stroke[0][0] + 0.001, stroke[0][1]]] : stroke);
  const band = offsetInt([line], radiusMm, ClipperLib.EndType.etOpenRound);
  const nz = ClipperLib.PolyFillType.pftNonZero;
  if (!execute(ClipperLib.ClipType.ctIntersection, region, band, nz).length) return null;
  return intPathsToCurves(execute(ClipperLib.ClipType.ctDifference, region, band, nz));
}

// ---------- separar formas ----------

/** Separa um conjunto de subcaminhos em ilhas: cada contorno externo leva
 * junto os furos que estão direto dentro dele. Não passa pelo Clipper, então
 * as curvas originais ficam intactas. Caminhos abertos saem sozinhos. */
export function splitIslands(paths: VPath[]): VPath[][] {
  const closed = paths.filter((p) => p.closed && p.segments.length);
  const flat = closed.map((p) => flattenPath(p, 0.25));
  const area = flat.map((f) => Math.abs(polygonArea(f)));
  // Pai de cada contorno = o menor contorno que o contém.
  const parent = closed.map((_, i) => {
    let best = -1;
    for (let j = 0; j < closed.length; j++) {
      if (i === j || area[j] <= area[i]) continue;
      const [x, y] = flat[i][0];
      if (pointInPolygon(flat[j], x, y) && (best < 0 || area[j] < area[best])) best = j;
    }
    return best;
  });
  const depth = parent.map((_, i) => {
    let d = 0;
    for (let p = parent[i]; p >= 0; p = parent[p]) d++;
    return d;
  });
  const islands: VPath[][] = [];
  closed.forEach((p, i) => {
    if (depth[i] % 2 !== 0) return;
    const holes = closed.filter((_, j) => parent[j] === i && depth[j] % 2 === 1);
    islands.push([p, ...holes]);
  });
  for (const p of paths) if (!p.closed && p.segments.length) islands.push([p]);
  return islands;
}

// ---------- nós ----------

export interface NodeRef {
  path: number;
  node: number;
}

export interface NodeInfo {
  point: Point;
  /** Alça que chega no nó (c2 do trecho anterior), se for curva. */
  handleIn: Point | null;
  handleOut: Point | null;
}

/** Quantos nós o caminho tem. Fechado: o fim coincide com o começo, então o
 * último `to` não conta como nó à parte. */
export function nodeCount(p: VPath): number {
  return p.closed ? p.segments.length : p.segments.length + 1;
}

function anchor(p: VPath, i: number): Point {
  return i === 0 ? p.start : p.segments[i - 1].to;
}

/** Índices do trecho que chega e do que sai do nó. */
function adjacent(p: VPath, i: number): { inSeg: number; outSeg: number } {
  const n = p.segments.length;
  if (p.closed) return { inSeg: (i - 1 + n) % n, outSeg: i % n };
  return { inSeg: i - 1, outSeg: i < n ? i : -1 };
}

export function nodeInfo(p: VPath, i: number): NodeInfo {
  const { inSeg, outSeg } = adjacent(p, i);
  const si = inSeg >= 0 ? p.segments[inSeg] : null;
  const so = outSeg >= 0 ? p.segments[outSeg] : null;
  return {
    point: anchor(p, i),
    handleIn: si && si.c2 ? si.c2 : null,
    handleOut: so && so.c1 ? so.c1 : null,
  };
}

function clonePath(p: VPath): VPath {
  return {
    start: [...p.start] as Point,
    closed: p.closed,
    segments: p.segments.map((s) => ({ c1: s.c1 ? ([...s.c1] as Point) : null, c2: s.c2 ? ([...s.c2] as Point) : null, to: [...s.to] as Point })),
  };
}

/** Move o nó e leva junto as duas alças dele, como em qualquer editor. */
export function moveNode(p: VPath, i: number, to: Point): VPath {
  const q = clonePath(p);
  const from = anchor(q, i);
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const shift = (pt: Point | null): Point | null => (pt ? [pt[0] + dx, pt[1] + dy] : null);
  const { inSeg, outSeg } = adjacent(q, i);
  if (inSeg >= 0) {
    q.segments[inSeg].to = [...to] as Point;
    q.segments[inSeg].c2 = shift(q.segments[inSeg].c2);
  }
  if (outSeg >= 0) q.segments[outSeg].c1 = shift(q.segments[outSeg].c1);
  if (i === 0 || (q.closed && i === q.segments.length)) q.start = [...to] as Point;
  return q;
}

export function moveHandle(p: VPath, i: number, which: 'in' | 'out', to: Point, mirror: boolean): VPath {
  const q = clonePath(p);
  const { inSeg, outSeg } = adjacent(q, i);
  const a = anchor(q, i);
  const seg = which === 'in' ? q.segments[inSeg] : q.segments[outSeg];
  if (!seg) return p;
  if (which === 'in') seg.c2 = [...to] as Point;
  else seg.c1 = [...to] as Point;
  // Nó suave: a alça do outro lado gira junto, mantendo o próprio tamanho.
  const other = which === 'in' ? (outSeg >= 0 ? q.segments[outSeg] : null) : inSeg >= 0 ? q.segments[inSeg] : null;
  const otherHandle = other ? (which === 'in' ? other.c1 : other.c2) : null;
  if (mirror && other && otherHandle) {
    const len = dist(a, otherHandle);
    const vx = a[0] - to[0], vy = a[1] - to[1];
    const vl = Math.hypot(vx, vy) || 1;
    const mirrored: Point = [a[0] + (vx / vl) * len, a[1] + (vy / vl) * len];
    if (which === 'in') other.c1 = mirrored;
    else other.c2 = mirrored;
  }
  return q;
}

/** Apaga o nó juntando os dois trechos vizinhos num só. Devolve null quando
 * não sobra caminho. */
export function deleteNode(p: VPath, i: number): VPath | null {
  const n = p.segments.length;
  if (p.closed) {
    if (n <= 2) return null;
    // Gira o caminho pra o nó virar o fim do trecho 0; aí é só fundir 0 e 1.
    const rotated = rotateClosed(p, (i - 1 + n) % n);
    const [a, b, ...rest] = rotated.segments;
    const merged = mergeSegments(rotated.start, a, b);
    return { start: rotated.start, closed: true, segments: [merged, ...rest] };
  }
  if (n <= 1) return null;
  const q = clonePath(p);
  if (i === 0) {
    q.start = q.segments[0].to;
    q.segments.shift();
    return q;
  }
  if (i >= n) {
    q.segments.pop();
    return q;
  }
  const merged = mergeSegments(anchor(q, i - 1), q.segments[i - 1], q.segments[i]);
  q.segments.splice(i - 1, 2, merged);
  return q;
}

function mergeSegments(from: Point, a: CubicSegment, b: CubicSegment): CubicSegment {
  if (!a.c1 && !b.c2) return { c1: null, c2: null, to: b.to };
  return { c1: a.c1 ?? from, c2: b.c2 ?? b.to, to: b.to };
}

/** Faz o nó `k` (0 ≤ k < n) virar o começo do caminho fechado. */
export function rotateClosed(p: VPath, k: number): VPath {
  const n = p.segments.length;
  const q = clonePath(p);
  if (!p.closed || k % n === 0) return q;
  return { start: anchor(q, k), closed: true, segments: [...q.segments.slice(k), ...q.segments.slice(0, k)] };
}

/** Suaviza o nó: as duas alças ficam alinhadas na direção dos vizinhos. */
export function smoothNode(p: VPath, i: number): VPath {
  const q = clonePath(p);
  const { inSeg, outSeg } = adjacent(q, i);
  const a = anchor(q, i);
  const prev = inSeg >= 0 ? (q.closed ? anchor(q, (i - 1 + nodeCount(q)) % nodeCount(q)) : anchor(q, i - 1)) : null;
  const next = outSeg >= 0 ? q.segments[outSeg].to : null;
  const dir: Point = prev && next ? [next[0] - prev[0], next[1] - prev[1]] : next ? [next[0] - a[0], next[1] - a[1]] : prev ? [a[0] - prev[0], a[1] - prev[1]] : [1, 0];
  const dl = Math.hypot(dir[0], dir[1]) || 1;
  const ux = dir[0] / dl, uy = dir[1] / dl;
  if (inSeg >= 0 && prev) {
    const s = q.segments[inSeg];
    const len = dist(prev, a) / 3;
    s.c1 ??= [prev[0] + (a[0] - prev[0]) / 3, prev[1] + (a[1] - prev[1]) / 3];
    s.c2 = [a[0] - ux * len, a[1] - uy * len];
  }
  if (outSeg >= 0 && next) {
    const s = q.segments[outSeg];
    const len = dist(a, next) / 3;
    s.c1 = [a[0] + ux * len, a[1] + uy * len];
    s.c2 ??= [next[0] - (next[0] - a[0]) / 3, next[1] - (next[1] - a[1]) / 3];
  }
  return q;
}

/** Vira canto: as alças do nó recolhem, então a curva chega e sai em bico. */
export function cornerNode(p: VPath, i: number): VPath {
  const q = clonePath(p);
  const { inSeg, outSeg } = adjacent(q, i);
  const a = anchor(q, i);
  const prevOf = (seg: number): Point => (seg === 0 ? q.start : q.segments[seg - 1].to);
  if (inSeg >= 0) {
    const s = q.segments[inSeg];
    if (s.c1 && dist(s.c1, prevOf(inSeg)) > 1e-9) s.c2 = [...a] as Point;
    else { s.c1 = null; s.c2 = null; }
  }
  if (outSeg >= 0) {
    const s = q.segments[outSeg];
    if (s.c2 && dist(s.c2, s.to) > 1e-9) s.c1 = [...a] as Point;
    else { s.c1 = null; s.c2 = null; }
  }
  return q;
}

/** Acrescenta um nó no meio do trecho que sai do nó `i` (de Casteljau em t=½,
 * então a forma não muda). */
export function addNodeAfter(p: VPath, i: number): VPath {
  const q = clonePath(p);
  const { outSeg } = adjacent(q, i);
  if (outSeg < 0) return q;
  const from = anchor(q, i);
  const s = q.segments[outSeg];
  let first: CubicSegment, second: CubicSegment;
  if (!s.c1 || !s.c2) {
    const mid: Point = [(from[0] + s.to[0]) / 2, (from[1] + s.to[1]) / 2];
    first = { c1: null, c2: null, to: mid };
    second = { c1: null, c2: null, to: s.to };
  } else {
    const lerp = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const p01 = lerp(from, s.c1), p12 = lerp(s.c1, s.c2), p23 = lerp(s.c2, s.to);
    const p012 = lerp(p01, p12), p123 = lerp(p12, p23);
    const mid = lerp(p012, p123);
    first = { c1: p01, c2: p012, to: mid };
    second = { c1: p123, c2: p23, to: s.to };
  }
  q.segments.splice(outSeg, 1, first, second);
  return q;
}
