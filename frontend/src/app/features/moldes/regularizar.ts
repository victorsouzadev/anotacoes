/** Regularização do decalque: o traçado copiado da imagem é fiel aos pixels,
 * com as ondulações deles. Molde feito no computador é reta, círculo e arco —
 * então o que está perto disso vira isso:
 *
 * - furo quase redondo vira círculo exato; cápsula (fenda, alça) vira cápsula;
 * - trecho comprido quase reto vira reta (quase horizontal/vertical, exata);
 *   quinas viram o cruzamento das duas retas, e retas quase alinhadas com um
 *   degrauzinho entre elas viram uma só;
 * - o que sobra (aba arredondada, curva de verdade) segue curva, suavizada.
 *
 * Tudo em mm, sem DOM. */

import { CubicSegment, Point } from '../imagem/contour';
import { VPath, flattenPath } from '../imagem/illustration-model';
import { fitFreehand } from '../imagem/vector-ops';
import { circulo, linha, poligonoArredondado } from './geometria';

export interface OpcoesRegularizar {
  /** Desvio máximo, em mm, pra um trecho contar como reto. */
  tolerancia: number;
  /** Trecho reto a partir deste comprimento (mm) vira reta de referência; o
   * que fica entre duas delas vira arco de canto, quebrada ou curva. */
  retaMinima: number;
  /** Até quantos graus de diferença a reta é "puxada" pra horizontal/vertical. */
  encaixeAngulo: number;
}

export const REGULARIZAR_PADRAO: OpcoesRegularizar = { tolerancia: 0.3, retaMinima: 5, encaixeAngulo: 2.5 };

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const dist = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

interface Reta {
  c: Point;
  u: Point;
}

/** Reta de mínimos quadrados pelos pontos (centro + direção principal). */
function ajustarReta(pts: Point[]): Reta {
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= pts.length; my /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    const dx = p[0] - mx, dy = p[1] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { c: [mx, my], u: [Math.cos(ang), Math.sin(ang)] };
}

/** Puxa a direção pra horizontal/vertical exata quando está quase lá. */
function encaixar(r: Reta, graus: number): Reta {
  const ang = (Math.atan2(r.u[1], r.u[0]) * 180) / Math.PI;
  for (const alvo of [-180, -90, 0, 90, 180]) {
    if (Math.abs(ang - alvo) <= graus) {
      const a = (alvo * Math.PI) / 180;
      return { c: r.c, u: [Math.round(Math.cos(a)), Math.round(Math.sin(a))] };
    }
  }
  return r;
}

function projetar(r: Reta, p: Point): Point {
  const t = (p[0] - r.c[0]) * r.u[0] + (p[1] - r.c[1]) * r.u[1];
  return [r.c[0] + r.u[0] * t, r.c[1] + r.u[1] * t];
}

function distanciaAReta(r: Reta, p: Point): number {
  return Math.abs((p[0] - r.c[0]) * r.u[1] - (p[1] - r.c[1]) * r.u[0]);
}

function cruzamento(a: Reta, b: Reta): Point | null {
  const det = a.u[0] * b.u[1] - a.u[1] * b.u[0];
  if (Math.abs(det) < 1e-6) return null;
  const d = sub(b.c, a.c);
  const t = (d[0] * b.u[1] - d[1] * b.u[0]) / det;
  return [a.c[0] + a.u[0] * t, a.c[1] + a.u[1] * t];
}

function anguloEntre(a: Reta, b: Reta): number {
  const cos = Math.abs(a.u[0] * b.u[0] + a.u[1] * b.u[1]);
  return (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
}

/** RDP numa sequência aberta; devolve os índices que ficam. */
function rdpIndices(pts: Point[], i0: number, i1: number, tol: number, out: number[]): void {
  const a = pts[i0], b = pts[i1];
  const L = dist(a, b);
  let maior = 0, idx = -1;
  for (let i = i0 + 1; i < i1; i++) {
    const p = pts[i];
    const d = L < 1e-9 ? dist(p, a) : Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L;
    if (d > maior) { maior = d; idx = i; }
  }
  if (idx >= 0 && maior > tol) {
    rdpIndices(pts, i0, idx, tol, out);
    out.push(idx);
    rdpIndices(pts, idx, i1, tol, out);
  }
}

// ---------------------------------------------------------------- formas

/** Círculo, se o contorno fechado for um. */
export function comoCirculo(pts: Point[]): VPath | null {
  if (pts.length < 8) return null;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;
  const ds = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
  const r = ds.reduce((s, d) => s + d, 0) / ds.length;
  const desvio = Math.max(...ds.map((d) => Math.abs(d - r)));
  return r > 0.2 && desvio <= Math.max(0.25, 0.1 * r) ? circulo([cx, cy], r) : null;
}

/** Cápsula (retângulo de pontas redondas), se for uma: fenda de encaixe, alça. */
export function comoCapsula(pts: Point[], o: OpcoesRegularizar): VPath | null {
  if (pts.length < 8) return null;
  const eixo = encaixar(ajustarReta(pts), o.encaixeAngulo);
  const [ux, uy] = eixo.u;
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (const p of pts) {
    const dx = p[0] - eixo.c[0], dy = p[1] - eixo.c[1];
    const t = dx * ux + dy * uy, n = -dx * uy + dy * ux;
    a = Math.min(a, t); b = Math.max(b, t); c = Math.min(c, n); d = Math.max(d, n);
  }
  const meia = (d - c) / 2;
  const comprimento = b - a;
  if (comprimento < 2.2 * meia || meia <= 0.1) return null;
  // centro do retângulo e o "osso" (segmento) que a cápsula envolve
  const tm = (a + b) / 2, nm = (c + d) / 2;
  const cen: Point = [eixo.c[0] + ux * tm - uy * nm, eixo.c[1] + uy * tm + ux * nm];
  const meioOsso = comprimento / 2 - meia;
  const p0: Point = [cen[0] - ux * meioOsso, cen[1] - uy * meioOsso];
  const p1: Point = [cen[0] + ux * meioOsso, cen[1] + uy * meioOsso];
  const tol = Math.max(0.25, 0.12 * meia);
  const ateOsso = pts.map((p) => {
    const v = sub(p1, p0);
    const L2 = v[0] * v[0] + v[1] * v[1];
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - p0[0]) * v[0] + (p[1] - p0[1]) * v[1]) / L2)) : 0;
    return dist(p, [p0[0] + v[0] * t, p0[1] + v[1] * t]);
  });
  if (ateOsso.some((d) => Math.abs(d - meia) > tol)) return null;
  // a largura pelos extremos pega o serrilhado; a média da distância ao osso não
  const raio = ateOsso.reduce((s, d) => s + d, 0) / ateOsso.length;
  // retângulo com raio = meia largura, nos quatro cantos girados pelo eixo
  const h = meioOsso + raio;
  const meiaFinal = raio;
  const cantos: Point[] = [[-h, -meiaFinal], [h, -meiaFinal], [h, meiaFinal], [-h, meiaFinal]].map(([t, n]): Point => [
    cen[0] + ux * t - uy * n,
    cen[1] + uy * t + ux * n,
  ]);
  return poligonoArredondado(cantos, [meiaFinal, meiaFinal, meiaFinal, meiaFinal]);
}

// ---------------------------------------------------------------- contorno

interface Peca {
  reta: Reta | null;
  i0: number;
  i1: number;
}

/** Quebrada de quinas vivas, se o trecho for uma: cada pedaço do RDP com pelo
 * menos 1 mm e todas as viradas fortes (curva de verdade vira aos pouquinhos). */
function comoQuebrada(pts: Point[], o: OpcoesRegularizar): Point[] | null {
  if (pts.length < 3) return null;
  const idx: number[] = [0];
  rdpIndices(pts, 0, pts.length - 1, o.tolerancia * 0.8, idx);
  idx.push(pts.length - 1);
  const v = idx.map((i) => pts[i]);
  if (v.length < 3) return v;
  for (let i = 1; i < v.length; i++) if (dist(v[i - 1], v[i]) < 1) return null;
  for (let i = 1; i < v.length - 1; i++) {
    const a = sub(v[i], v[i - 1]), b = sub(v[i + 1], v[i]);
    const virada = Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
    if (virada < (25 * Math.PI) / 180) return null;
  }
  return v;
}

/** Contorno fechado vira retas + curvas. */
export function regularizarContorno(path: VPath, o: OpcoesRegularizar = REGULARIZAR_PADRAO): VPath {
  let pts = flattenPath(path, 0.15);
  const n = pts.length;
  if (n < 12) return path;

  // começa na quina mais fechada, pra nenhuma reta ficar partida no começo
  const viz = Math.max(2, Math.round(1 / 0.15));
  let melhor = 0, maiorVirada = -1;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - viz + n) % n], p = pts[i], b = pts[(i + viz) % n];
    const v1 = sub(p, a), v2 = sub(b, p);
    const virada = Math.abs(Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]));
    if (virada > maiorVirada) { maiorVirada = virada; melhor = i; }
  }
  pts = [...pts.slice(melhor), ...pts.slice(0, melhor)];
  // Recomeça no fim da reta mais longa: ali é sempre uma junção (quina ou
  // começo de arco). Começar no meio de um arco o partiria em dois.
  {
    const f0 = [...pts, pts[0]];
    const id0: number[] = [0];
    rdpIndices(f0, 0, n, o.tolerancia, id0);
    id0.push(n);
    let longa = 0, maiorL = -1;
    for (let k = 0; k < id0.length - 1; k++) {
      const L = dist(f0[id0[k]], f0[id0[k + 1]]);
      if (L > maiorL) { maiorL = L; longa = id0[k + 1] % n; }
    }
    pts = [...pts.slice(longa), ...pts.slice(0, longa)];
  }
  const fechado = [...pts, pts[0]];

  const idx: number[] = [0];
  rdpIndices(fechado, 0, n, o.tolerancia, idx);
  idx.push(n);

  // cada trecho do RDP: reta (comprido) ou pedaço de curva
  const brutas: Peca[] = [];
  for (let k = 0; k < idx.length - 1; k++) {
    const i0 = idx[k], i1 = idx[k + 1];
    const comprido = dist(fechado[i0], fechado[i1]) >= o.retaMinima;
    if (comprido) {
      // ajusta sem as pontas (a quina arredondada do pixel puxaria a reta)
      const corte = Math.floor((i1 - i0) * 0.12);
      const meio = fechado.slice(i0 + corte, i1 - corte + 1);
      brutas.push({ reta: encaixar(ajustarReta(meio.length >= 2 ? meio : fechado.slice(i0, i1 + 1)), o.encaixeAngulo), i0, i1 });
    } else {
      const ult = brutas[brutas.length - 1];
      if (ult && !ult.reta) ult.i1 = i1;
      else brutas.push({ reta: null, i0, i1 });
    }
  }
  if (!brutas.some((p) => p.reta)) {
    return comoCirculo(pts) ?? fitFreehand(pts, 0.08, true) ?? path;
  }

  // retas vizinhas quase alinhadas (degrau de pixel entre elas) viram uma só
  const pecas: Peca[] = [];
  const alinhadas = (a: Reta, b: Reta, angMax: number, desvioMax: number): boolean =>
    anguloEntre(a, b) < angMax && distanciaAReta(a, b.c) < desvioMax;
  for (const p of brutas) {
    // degrau de pixel: pedacinho "curvo" entre duas retas alinhadas some
    const penult = pecas[pecas.length - 2], meio = pecas[pecas.length - 1];
    if (p.reta && meio && !meio.reta && penult?.reta && dist(fechado[meio.i0], fechado[meio.i1]) < 3 && alinhadas(penult.reta, p.reta, 3, 0.6)) {
      pecas.pop();
      penult.i1 = p.i1;
      penult.reta = encaixar(ajustarReta(fechado.slice(penult.i0, penult.i1 + 1)), o.encaixeAngulo);
      continue;
    }
    const ult = pecas[pecas.length - 1];
    // trecho curto quase alinhado com o vizinho é o vizinho mal medido, não uma quina
    const curta = ult && Math.min(dist(fechado[ult.i0], fechado[ult.i1]), dist(fechado[p.i0], fechado[p.i1])) < 5;
    const [angMax, desvioMax] = curta ? [6, 0.8] : [3, 0.6];
    if (ult?.reta && p.reta && anguloEntre(ult.reta, p.reta) < angMax && distanciaAReta(ult.reta, p.reta.c) < desvioMax) {
      ult.i1 = p.i1;
      ult.reta = encaixar(ajustarReta(fechado.slice(ult.i0, ult.i1 + 1)), o.encaixeAngulo);
    } else {
      pecas.push({ ...p });
    }
  }

  // Canto arredondado entre duas retas: arco de raio medido, tangente às duas
  // (o mesmo canto que um programa de desenho faz), em vez de curva livre.
  const m = pecas.length;
  const filetes = pecas.map((p, k) => {
    if (p.reta || m < 3) return null;
    const ant = pecas[(k - 1 + m) % m], prox = pecas[(k + 1) % m];
    if (!ant.reta || !prox.reta) return null;
    const X = cruzamento(ant.reta, prox.reta);
    if (!X) return null;
    const unit = (v: Point): Point => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
    const v1 = unit(sub(projetar(ant.reta, fechado[ant.i0]), X));
    const v2 = unit(sub(projetar(prox.reta, fechado[prox.i1]), X));
    const ang = Math.acos(Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1])));
    if (ang < 0.2 || ang > Math.PI - 0.2) return null;
    const run = fechado.slice(p.i0, p.i1 + 1);
    const d = Math.min(...run.map((q) => dist(q, X)));
    const r = d / (1 / Math.sin(ang / 2) - 1);
    const t = r / Math.tan(ang / 2);
    if (!(r > 0.05) || t > 0.95 * dist(X, fechado[ant.i0]) || t > 0.95 * dist(X, fechado[prox.i1])) return null;
    const A: Point = [X[0] + v1[0] * t, X[1] + v1[1] * t];
    const B: Point = [X[0] + v2[0] * t, X[1] + v2[1] * t];
    // centro do arco e conferência: o desenho tem de estar mesmo perto dele
    const bis = unit([v1[0] + v2[0], v1[1] + v2[1]]);
    const C: Point = [X[0] + bis[0] * (r / Math.sin(ang / 2)), X[1] + bis[1] * (r / Math.sin(ang / 2))];
    if (Math.max(...run.map((q) => Math.abs(dist(q, C) - r))) > Math.max(0.35, 0.15 * r)) return null;
    const kk = (4 / 3) * Math.tan((Math.PI - ang) / 4) * r;
    const seg: CubicSegment = { c1: [A[0] - v1[0] * kk, A[1] - v1[1] * kk], c2: [B[0] - v2[0] * kk, B[1] - v2[1] * kk], to: B };
    return { A, B, seg };
  });

  // pontos de encontro entre peças vizinhas
  const juncao: Point[] = [];
  for (let k = 0; k < m; k++) {
    const a = pecas[k], b = pecas[(k + 1) % m];
    const original = fechado[a.i1];
    let q: Point = original;
    const fa = filetes[k], fb = filetes[(k + 1) % m];
    if (fb) q = fb.A;
    else if (fa) q = fa.B;
    else if (a.reta && b.reta) {
      const x = cruzamento(a.reta, b.reta);
      q = x && dist(x, original) < 3 ? x : projetar(a.reta, original);
    } else if (a.reta) q = projetar(a.reta, original);
    else if (b.reta) q = projetar(b.reta, original);
    juncao.push(q);
  }

  const start = juncao[m - 1];
  const segments: CubicSegment[] = [];
  for (let k = 0; k < m; k++) {
    const p = pecas[k];
    const ini = k === 0 ? start : juncao[k - 1];
    const fim = juncao[k];
    if (p.reta) {
      segments.push({ c1: null, c2: null, to: fim });
      continue;
    }
    if (filetes[k]) {
      segments.push(filetes[k]!.seg);
      continue;
    }
    const trecho = [ini, ...fechado.slice(p.i0 + 1, p.i1), fim];
    // entalhe, bico: trechos curtos mas retos, com quinas vivas entre eles
    const quebrada = comoQuebrada(trecho, o);
    if (quebrada) {
      for (const q of quebrada.slice(1)) segments.push({ c1: null, c2: null, to: q });
      continue;
    }
    const curva = trecho.length >= 3 ? fitFreehand(trecho, 0.08, false) : null;
    if (!curva || !curva.segments.length) {
      segments.push({ c1: null, c2: null, to: fim });
      continue;
    }
    const segs = curva.segments.map((s) => ({ ...s }));
    // costura exata nas pontas (o ajuste suaviza e pode sair uns centésimos)
    if (segs[0].c1) segs[0].c1 = [segs[0].c1[0] + ini[0] - curva.start[0], segs[0].c1[1] + ini[1] - curva.start[1]];
    segs[segs.length - 1].to = fim;
    segments.push(...segs);
  }
  return { start, closed: true, segments };
}

/** Furo: círculo ou cápsula quando for; senão o contorno regularizado. */
export function regularizarFuro(path: VPath, o: OpcoesRegularizar = REGULARIZAR_PADRAO): VPath {
  const pts = flattenPath(path, 0.1);
  return comoCirculo(pts) ?? comoCapsula(pts, o) ?? regularizarContorno(path, o);
}

/** Dobra reta quase horizontal/vertical fica exata (gira em volta do meio). */
export function endireitarDobra(path: VPath, o: OpcoesRegularizar = REGULARIZAR_PADRAO): VPath {
  if (path.segments.length !== 1 || path.segments[0].c1) return path;
  const a = path.start, b = path.segments[0].to;
  const r = encaixar({ c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], u: [(b[0] - a[0]) / (dist(a, b) || 1), (b[1] - a[1]) / (dist(a, b) || 1)] }, o.encaixeAngulo);
  return linha(projetar(r, a), projetar(r, b));
}
