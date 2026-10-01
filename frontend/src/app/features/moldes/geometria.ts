/** Peças de construção dos moldes: tudo em mm, com o y crescendo pra baixo
 * (como no SVG). Os moldes são montados com retas e arcos de verdade em vez de
 * polilinha, pra a lâmina da Silhouette correr liso e as dobras caírem
 * exatamente nas quinas. */

import { CubicSegment, Point } from '../imagem/contour';
import { KAPPA, VPath, flattenPath } from '../imagem/illustration-model';

export type { Point } from '../imagem/contour';
export type { VPath } from '../imagem/illustration-model';

export function linha(a: Point, b: Point): VPath {
  return { start: a, closed: false, segments: [{ c1: null, c2: null, to: b }] };
}

/** Polilinha; fechada, o último trecho volta ao primeiro ponto. */
export function poligono(pts: Point[], fechado = true): VPath {
  const segments: CubicSegment[] = pts.slice(1).map((p) => ({ c1: null, c2: null, to: p }));
  if (fechado) segments.push({ c1: null, c2: null, to: pts[0] });
  return { start: pts[0], closed: fechado, segments };
}

export function retangulo(x: number, y: number, w: number, h: number): VPath {
  return poligono([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
}

/** Trechos de arco de `a0` a `a1` (radianos; positivo gira no sentido horário
 * da tela, já que o y desce). Cada pedaço tem no máximo 90°, onde a cúbica
 * erra menos de 0,03% do raio. */
export function arco(c: Point, r: number, a0: number, a1: number): CubicSegment[] {
  const total = a1 - a0;
  const n = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2) - 1e-9));
  const passo = total / n;
  const k = (4 / 3) * Math.tan(passo / 4) * r;
  const segs: CubicSegment[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = a0 + passo * i;
    const t1 = t0 + passo;
    const p0: Point = [c[0] + r * Math.cos(t0), c[1] + r * Math.sin(t0)];
    const p1: Point = [c[0] + r * Math.cos(t1), c[1] + r * Math.sin(t1)];
    segs.push({
      c1: [p0[0] - k * Math.sin(t0), p0[1] + k * Math.cos(t0)],
      c2: [p1[0] + k * Math.sin(t1), p1[1] - k * Math.cos(t1)],
      to: p1,
    });
  }
  return segs;
}

export function pontoNoCirculo(c: Point, r: number, a: number): Point {
  return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
}

export function circulo(c: Point, r: number): VPath {
  return { start: pontoNoCirculo(c, r, 0), closed: true, segments: arco(c, r, 0, Math.PI * 2) };
}

export function elipse(c: Point, rx: number, ry: number): VPath {
  const [x, y] = c;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    start: [x + rx, y],
    closed: true,
    segments: [
      { c1: [x + rx, y + ky], c2: [x + kx, y + ry], to: [x, y + ry] },
      { c1: [x - kx, y + ry], c2: [x - rx, y + ky], to: [x - rx, y] },
      { c1: [x - rx, y - ky], c2: [x - kx, y - ry], to: [x, y - ry] },
      { c1: [x + kx, y - ry], c2: [x + rx, y - ky], to: [x + rx, y] },
    ],
  };
}

/** Curva suave de `a` a `b` puxada por `ctrl` (quadrática escrita como cúbica). */
export function curva(a: Point, ctrl: Point, b: Point): VPath {
  const c1: Point = [a[0] + (2 / 3) * (ctrl[0] - a[0]), a[1] + (2 / 3) * (ctrl[1] - a[1])];
  const c2: Point = [b[0] + (2 / 3) * (ctrl[0] - b[0]), b[1] + (2 / 3) * (ctrl[1] - b[1])];
  return { start: a, closed: false, segments: [{ c1, c2, to: b }] };
}

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const len = (v: Point): number => Math.hypot(v[0], v[1]);

/** Polígono fechado com cantos arredondados: `raios[i]` arredonda o vértice
 * `i` (0 deixa a quina viva). O raio encolhe sozinho se não couber na aresta. */
export function poligonoArredondado(pts: Point[], raios: number[]): VPath {
  const n = pts.length;
  const cantos = pts.map((p, i) => {
    const r = raios[i] ?? 0;
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const u = sub(prev, p);
    const v = sub(next, p);
    const lu = len(u), lv = len(v);
    if (r <= 0 || lu < 1e-9 || lv < 1e-9) return { a: p, b: p, seg: null as CubicSegment | null };
    const ang = Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv))));
    if (ang < 1e-3 || Math.PI - ang < 1e-3) return { a: p, b: p, seg: null };
    // distância do vértice ao ponto de tangência, limitada a metade das arestas
    let d = r / Math.tan(ang / 2);
    d = Math.min(d, lu / 2, lv / 2);
    const rr = d * Math.tan(ang / 2);
    const a: Point = [p[0] + (u[0] / lu) * d, p[1] + (u[1] / lu) * d];
    const b: Point = [p[0] + (v[0] / lv) * d, p[1] + (v[1] / lv) * d];
    const sweep = Math.PI - ang;
    const k = (4 / 3) * Math.tan(sweep / 4) * rr;
    const seg: CubicSegment = {
      c1: [a[0] - (u[0] / lu) * k, a[1] - (u[1] / lu) * k],
      c2: [b[0] - (v[0] / lv) * k, b[1] - (v[1] / lv) * k],
      to: b,
    };
    return { a, b, seg };
  });
  // começa na saída do canto 0 e dá a volta até ela: o último trecho (reta ou
  // arco do canto 0) termina no começo, como todo caminho fechado
  const start = cantos[0].b;
  const segments: CubicSegment[] = [];
  for (let i = 1; i <= n; i++) {
    const c = cantos[i % n];
    segments.push({ c1: null, c2: null, to: c.a });
    if (c.seg) segments.push(c.seg);
  }
  return { start, closed: true, segments };
}

export function retanguloArredondado(x: number, y: number, w: number, h: number, r: number): VPath {
  return poligonoArredondado([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], [r, r, r, r]);
}

/** Aba de cola ao longo da aresta `a`→`b`, saindo pro lado esquerdo de quem
 * anda de `a` pra `b` (no y pra baixo, é o lado de fora de um contorno
 * percorrido no sentido horário). As pontas saem em 45° (ou menos, se a aba
 * for comprida demais pra aresta). Devolve só os dois pontos de fora. */
export function pontosDaAba(a: Point, b: Point, largura: number, chanfro = largura): [Point, Point] {
  const d = sub(b, a);
  const l = len(d);
  const t: Point = [d[0] / l, d[1] / l];
  const n: Point = [t[1], -t[0]];
  const c = Math.min(chanfro, l * 0.35);
  return [
    [a[0] + t[0] * c + n[0] * largura, a[1] + t[1] * c + n[1] * largura],
    [b[0] - t[0] * c + n[0] * largura, b[1] - t[1] * c + n[1] * largura],
  ];
}

/** Picota um caminho em traços de corte (vinco por meio-corte): `traco` mm
 * cortados, `espaco` mm de papel inteiro, começando e terminando com meio
 * espaço pra não abrir a quina. */
export function tracejar(p: VPath, traco: number, espaco: number): VPath[] {
  const pts = flattenPath(p, 0.25);
  if (p.closed) pts.push(pts[0]);
  const acum: number[] = [0];
  for (let i = 1; i < pts.length; i++) acum.push(acum[i - 1] + len(sub(pts[i], pts[i - 1])));
  const total = acum[acum.length - 1];
  if (total <= 0 || traco <= 0) return [];
  const periodo = traco + Math.max(0, espaco);
  const n = Math.max(1, Math.floor((total + espaco) / periodo));
  const sobra = total - (n * traco + (n - 1) * espaco);
  const em = (s: number): Point => {
    let i = 1;
    while (i < acum.length - 1 && acum[i] < s) i++;
    const t = (s - acum[i - 1]) / (acum[i] - acum[i - 1] || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  };
  const out: VPath[] = [];
  for (let k = 0; k < n; k++) {
    const s0 = sobra / 2 + k * periodo;
    const s1 = Math.min(total, s0 + traco);
    const trecho: Point[] = [em(s0)];
    for (let i = 0; i < acum.length; i++) if (acum[i] > s0 && acum[i] < s1) trecho.push(pts[i]);
    trecho.push(em(s1));
    out.push(poligono(trecho, false));
  }
  return out;
}

export function comprimento(p: VPath): number {
  const pts = flattenPath(p, 0.25);
  if (p.closed) pts.push(pts[0]);
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += len(sub(pts[i], pts[i - 1]));
  return s;
}

/** Junta trechos retos seguidos que estão na mesma reta (sobra das operações
 * de área): a lâmina desacelera em cada vértice, então menos é melhor. */
export function juntarRetas(paths: VPath[], tolerancia = 0.005): VPath[] {
  return paths.map((p) => {
    const segs: CubicSegment[] = [];
    let ini = p.start;
    for (const s of p.segments) {
      const ult = segs[segs.length - 1];
      if (ult && !ult.c1 && !s.c1) {
        // ponto `ult.to` cai na reta de `ini` até `s.to`?
        const a = ini, b = s.to, m = ult.to;
        const d = len(sub(b, a));
        const desvio = d < 1e-9 ? len(sub(m, a)) : Math.abs((b[0] - a[0]) * (a[1] - m[1]) - (a[0] - m[0]) * (b[1] - a[1])) / d;
        const proj = (m[0] - a[0]) * (b[0] - a[0]) + (m[1] - a[1]) * (b[1] - a[1]);
        const entre = proj >= 0 && proj <= d * d;
        if (desvio < tolerancia && entre) {
          segs[segs.length - 1] = { c1: null, c2: null, to: b };
          continue;
        }
      }
      if (ult) ini = ult.to;
      segs.push(s);
    }
    return { ...p, segments: segs };
  });
}
