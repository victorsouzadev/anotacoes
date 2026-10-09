/** Decalque: transforma a foto (ou o scan) de um molde de papel em linhas de
 * corte e de dobra, em mm de verdade.
 *
 * 1. A foto é endireitada pelos quatro cantos do papel (homografia) numa grade
 *    de pixels de tamanho conhecido — é daí que sai a escala.
 * 2. "Tinta" é o pixel mais escuro que o limiar. O que dá pra alcançar da
 *    borda da imagem sem atravessar tinta é fora do molde; o resto é a peça.
 * 3. O contorno da peça é o corte. Vãos fechados pequenos lá dentro são furos
 *    (também corte); vãos grandes são painéis cercados por dobra contínua.
 * 4. A tinta de dentro, longe do contorno, é afinada até um pixel de largura,
 *    vira polilinha, e os tracinhos alinhados são emendados: é a dobra, mesmo
 *    quando o molde a desenha tracejada.
 *
 * Tudo aqui é puro (sem DOM), pra testar com imagens sintéticas. */

import { Point, Polygon, traceMask } from '../imagem/contour';
import { VPath, polygonToVPath } from '../imagem/illustration-model';
import { fitFreehand, offsetOutline } from '../imagem/vector-ops';
import { linha } from './geometria';
import { REGULARIZAR_PADRAO, endireitarDobra, regularizarContorno, regularizarFuro } from './regularizar';
import { area } from './toppers';

export interface Cinza {
  data: Uint8Array;
  w: number;
  h: number;
}

/** Cantos do papel na foto, em px: superior esquerdo, superior direito,
 * inferior direito, inferior esquerdo. */
export type Cantos = [Point, Point, Point, Point];

export function paraCinza(rgba: ArrayLike<number>, w: number, h: number): Cinza {
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255;
    // transparente conta como papel branco
    const l = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    data[i] = Math.round(l * a + 255 * (1 - a));
  }
  return { data, w, h };
}

// ---------------------------------------------------------------- perspectiva

/** Homografia que leva os 4 pontos `de` nos 4 pontos `para` (3×3, por linhas). */
export function homografia(de: Point[], para: Point[]): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = de[i];
    const [u, v] = para[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // eliminação de Gauss com pivô parcial
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c] || 1e-12;
    for (let k = c; k < 9; k++) A[c][k] /= d;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c];
      if (f) for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [...A.map((row) => row[8]), 1];
}

export function aplicarH(H: number[], [x, y]: Point): Point {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** Endireita o quadrilátero `cantos` num retângulo `outW` × `outH` px. */
export function retificar(src: Cinza, cantos: Cantos, outW: number, outH: number): Cinza {
  const H = homografia([[0, 0], [outW, 0], [outW, outH], [0, outH]], cantos);
  const data = new Uint8Array(outW * outH);
  const { w, h } = src;
  for (let v = 0; v < outH; v++) {
    for (let u = 0; u < outW; u++) {
      const [sx, sy] = aplicarH(H, [u + 0.5, v + 0.5]);
      const x = sx - 0.5, y = sy - 0.5;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) {
        data[v * outW + u] = 255;
        continue;
      }
      const fx = x - x0, fy = y - y0;
      const i = y0 * w + x0;
      const a = src.data[i] + (src.data[i + 1] - src.data[i]) * fx;
      const b = src.data[i + w] + (src.data[i + w + 1] - src.data[i + w]) * fx;
      data[v * outW + u] = Math.round(a + (b - a) * fy);
    }
  }
  return { data, w: outW, h: outH };
}

/** Limiar de Otsu: separa o histograma em duas turmas (tinta e papel). */
export function otsu(g: Cinza): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < g.data.length; i++) hist[g.data[i]]++;
  const total = g.data.length;
  let soma = 0;
  for (let i = 0; i < 256; i++) soma += i * hist[i];
  let somaB = 0, pesoB = 0, melhor = 0, limiar = 128;
  for (let t = 0; t < 256; t++) {
    pesoB += hist[t];
    if (!pesoB) continue;
    const pesoF = total - pesoB;
    if (!pesoF) break;
    somaB += t * hist[t];
    const mB = somaB / pesoB, mF = (soma - somaB) / pesoF;
    const entre = pesoB * pesoF * (mB - mF) * (mB - mF);
    if (entre > melhor) { melhor = entre; limiar = t; }
  }
  return limiar;
}

/** Palpite dos cantos do papel numa foto: o papel é a maior mancha clara, e os
 * cantos são os pontos dela mais pra cada diagonal. Sem mancha clara grande
 * (é um scan, ou a mesa é clara), devolve os cantos da imagem. */
export function acharCantos(g: Cinza): Cantos {
  const { w, h } = g;
  const inteira: Cantos = [[0, 0], [w, 0], [w, h], [0, h]];
  const t = otsu(g);
  const claro = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) claro[i] = g.data[i] > t ? 1 : 0;
  const { rotulo, areas } = rotular(claro, w, h);
  let maior = -1;
  areas.forEach((a, k) => { if (maior < 0 || a > areas[maior]) maior = k; });
  if (maior < 0 || areas[maior] < w * h * 0.2) return inteira;
  // encosta nas quatro bordas: o papel ocupa a foto toda (scan)
  let bordas = 0;
  const toca = (i: number): boolean => rotulo[i] === maior + 1;
  if ([...Array(w).keys()].some((x) => toca(x))) bordas++;
  if ([...Array(w).keys()].some((x) => toca((h - 1) * w + x))) bordas++;
  if ([...Array(h).keys()].some((y) => toca(y * w))) bordas++;
  if ([...Array(h).keys()].some((y) => toca(y * w + w - 1))) bordas++;
  if (bordas >= 3) return inteira;
  const melhor: [number, Point][] = [[Infinity, [0, 0]], [-Infinity, [w, 0]], [-Infinity, [w, h]], [-Infinity, [0, h]]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rotulo[y * w + x] !== maior + 1) continue;
      if (x + y < melhor[0][0]) melhor[0] = [x + y, [x, y]];
      if (x - y > melhor[1][0]) melhor[1] = [x - y, [x + 1, y]];
      if (x + y > melhor[2][0]) melhor[2] = [x + y, [x + 1, y + 1]];
      if (y - x > melhor[3][0]) melhor[3] = [y - x, [x, y + 1]];
    }
  }
  return melhor.map((m) => m[1]) as Cantos;
}

/** Molde desenhado no computador (print de tela, arquivo baixado): não há
 * papel pra achar, então procura o próprio molde — a maior forma fechada que
 * não encosta na borda da imagem (barra de navegação e botões do celular
 * encostam ou são pequenos). Devolve o retângulo em volta dele, com folga, ou
 * null se não achou nada que pareça um molde. */
export function acharMolde(g: Cinza): Cantos | null {
  const { w, h } = g;
  // fundo é o tom mais comum; tinta é o que fica bem mais escuro que ele
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < w * h; i++) hist[g.data[i]]++;
  const fundo = hist.indexOf(Math.max(...hist));
  if (fundo < 150) return null;
  const tinta = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (g.data[i] < fundo - 45) tinta[i] = 1;
  // O lado de fora do molde é a área clara que o envolve: a que tem a maior
  // caixa. Não dá pra partir da borda da imagem — num print, o molde costuma
  // estar num cartão branco cercado de preto (barra de status, navegação).
  const claro = dilatar(tinta, w, h, 1).map((v) => (v ? 0 : 1));
  const fundos = rotular(claro, w, h);
  const caixaF = fundos.areas.map(() => [w, h, -1, -1]);
  for (let i = 0; i < w * h; i++) {
    const c = fundos.rotulo[i] - 1;
    if (c < 0) continue;
    const x = i % w, y = (i - x) / w;
    const b = caixaF[c];
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
  }
  let externo = -1, maiorCaixa = -1;
  caixaF.forEach(([a, b, c, d], i) => {
    const area = (c - a + 1) * (d - b + 1);
    if (c >= 0 && area > maiorCaixa) { maiorCaixa = area; externo = i; }
  });
  if (externo < 0) return null;
  const dentro = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (fundos.rotulo[i] !== externo + 1) dentro[i] = 1;
  const { rotulo, areas } = rotular(dentro, w, h);
  const caixa = areas.map(() => [w, h, -1, -1]);
  for (let i = 0; i < w * h; i++) {
    const c = rotulo[i] - 1;
    if (c < 0) continue;
    const x = i % w, y = (i - x) / w;
    const b = caixa[c];
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
  }
  let melhor = -1;
  areas.forEach((a, c) => {
    const [x0, y0, x1, y1] = caixa[c];
    const encosta = x0 <= 0 || y0 <= 0 || x1 >= w - 1 || y1 >= h - 1;
    if (!encosta && a >= w * h * 0.03 && (melhor < 0 || a > areas[melhor])) melhor = c;
  });
  if (melhor < 0) return null;
  const [x0, y0, x1, y1] = caixa[melhor];
  const folga = Math.round(Math.max(x1 - x0, y1 - y0) * 0.015) + 2;
  const a = Math.max(0, x0 - folga), b = Math.max(0, y0 - folga);
  const c = Math.min(w, x1 + 1 + folga), d = Math.min(h, y1 + 1 + folga);
  return [[a, b], [c, b], [c, d], [a, d]];
}

// ---------------------------------------------------------------- máscaras

/** Dilatação quadrada de raio `r` (separável: linha, depois coluna). */
export function dilatar(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return m.slice();
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let conta = 0;
    for (let x = -r; x < w; x++) {
      if (x + r < w && m[y * w + x + r]) conta++;
      if (x - r - 1 >= 0 && m[y * w + x - r - 1]) conta--;
      if (x >= 0) tmp[y * w + x] = conta > 0 ? 1 : 0;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let conta = 0;
    for (let y = -r; y < h; y++) {
      if (y + r < h && tmp[(y + r) * w + x]) conta++;
      if (y - r - 1 >= 0 && tmp[(y - r - 1) * w + x]) conta--;
      if (y >= 0) out[y * w + x] = conta > 0 ? 1 : 0;
    }
  }
  return out;
}

/** Pixels alcançáveis a partir da borda sem passar por `bloqueio` (4-vizinhos). */
export function inundarDeFora(bloqueio: Uint8Array, w: number, h: number): Uint8Array {
  const fora = new Uint8Array(w * h);
  const fila = new Int32Array(w * h);
  let ini = 0, fim = 0;
  const semear = (i: number): void => {
    if (!bloqueio[i] && !fora[i]) { fora[i] = 1; fila[fim++] = i; }
  };
  for (let x = 0; x < w; x++) { semear(x); semear((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { semear(y * w); semear(y * w + w - 1); }
  while (ini < fim) {
    const i = fila[ini++];
    const x = i % w;
    if (x > 0) semear(i - 1);
    if (x < w - 1) semear(i + 1);
    if (i >= w) semear(i - w);
    if (i < w * (h - 1)) semear(i + w);
  }
  return fora;
}

/** Componentes conexos (4-vizinhos) dos pixels 1. Rótulo 0 = fundo. */
export function rotular(m: Uint8Array, w: number, h: number): { rotulo: Int32Array; areas: number[] } {
  const rotulo = new Int32Array(w * h);
  const areas: number[] = [];
  const fila = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || rotulo[s]) continue;
    const id = areas.length + 1;
    let ini = 0, fim = 0, area = 0;
    rotulo[s] = id;
    fila[fim++] = s;
    while (ini < fim) {
      const i = fila[ini++];
      area++;
      const x = i % w;
      const viz = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of viz) {
        if (j < 0 || j >= w * h || !m[j] || rotulo[j]) continue;
        rotulo[j] = id;
        fila[fim++] = j;
      }
    }
    areas.push(area);
  }
  return { rotulo, areas };
}

/** Distância (em passos de 8-vizinhos) até o pixel-fonte mais perto, até `max`. */
export function distancia(fontes: Uint8Array, w: number, h: number, max: number): Uint16Array {
  const d = new Uint16Array(w * h).fill(max);
  const fila = new Int32Array(w * h);
  let ini = 0, fim = 0;
  for (let i = 0; i < w * h; i++) if (fontes[i]) { d[i] = 0; fila[fim++] = i; }
  while (ini < fim) {
    const i = fila[ini++];
    const nd = d[i] + 1;
    if (nd >= max) continue;
    const x = i % w, y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (d[j] > nd) { d[j] = nd; fila[fim++] = j; }
      }
    }
  }
  return d;
}

/** Afinamento de Zhang-Suen: deixa cada traço com um pixel de largura. */
export function esqueleto(m: Uint8Array, w: number, h: number): Uint8Array {
  const s = m.slice();
  for (let x = 0; x < w; x++) { s[x] = 0; s[(h - 1) * w + x] = 0; }
  for (let y = 0; y < h; y++) { s[y * w] = 0; s[y * w + w - 1] = 0; }
  const apagar: number[] = [];
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (let passo = 0; passo < 2; passo++) {
      apagar.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!s[i]) continue;
          const p2 = s[i - w], p3 = s[i - w + 1], p4 = s[i + 1], p5 = s[i + w + 1];
          const p6 = s[i + w], p7 = s[i + w - 1], p8 = s[i - 1], p9 = s[i - w - 1];
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let a = 0;
          for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) a++;
          if (a !== 1) continue;
          if (passo === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
          apagar.push(i);
        }
      }
      for (const i of apagar) s[i] = 0;
      if (apagar.length) mudou = true;
    }
  }
  return s;
}

const VIZ8: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];

/** Esqueleto → polilinhas (px). Cruzamentos encerram a linha; voltas fechadas
 * saem como uma linha que termina onde começa. */
export function tracarEsqueleto(sk: Uint8Array, w: number, h: number): Point[][] {
  const viz = (i: number): number[] => {
    const x = i % w, y = (i - x) / w;
    const out: number[] = [];
    for (const [dx, dy] of VIZ8) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && sk[yy * w + xx]) out.push(yy * w + xx);
    }
    return out;
  };
  const grau = new Uint8Array(w * h);
  const pixels: number[] = [];
  for (let i = 0; i < w * h; i++) if (sk[i]) { grau[i] = viz(i).length; pixels.push(i); }
  const visto = new Uint8Array(w * h);
  const pt = (i: number): Point => [i % w + 0.5, Math.floor(i / w) + 0.5];
  const linhas: Point[][] = [];

  const andar = (ini: number, prox: number): void => {
    const caminho = [ini, prox];
    if (grau[prox] < 3) visto[prox] = 1;
    let ant = ini, cur = prox;
    while (grau[cur] < 3) {
      const cands = viz(cur).filter((j) => j !== ant && !caminho.includes(j) && (!visto[j] || grau[j] >= 3));
      if (!cands.length) {
        // volta fechada: o vizinho que sobrou é o começo
        if (viz(cur).includes(ini) && caminho.length > 3) caminho.push(ini);
        break;
      }
      // segue pelo vizinho de lado (4-vizinho) antes da diagonal
      const j = cands.find((c) => Math.abs(c - cur) === 1 || Math.abs(c - cur) === w) ?? cands[0];
      caminho.push(j);
      if (grau[j] < 3) visto[j] = 1;
      ant = cur;
      cur = j;
    }
    linhas.push(caminho.map(pt));
  };

  // primeiro das pontas, depois dos cruzamentos, depois o que sobrou (voltas)
  for (const i of pixels) if (grau[i] === 1 && !visto[i]) { visto[i] = 1; const n = viz(i)[0]; if (n !== undefined && (!visto[n] || grau[n] >= 3)) andar(i, n); }
  for (const i of pixels) {
    if (grau[i] < 3) continue;
    for (const n of viz(i)) if (!visto[n] && grau[n] < 3) andar(i, n);
  }
  for (const i of pixels) {
    if (visto[i] || grau[i] >= 3) continue;
    visto[i] = 1;
    const n = viz(i).find((j) => !visto[j]);
    if (n !== undefined) andar(i, n);
  }
  return linhas;
}

/** Ramer-Douglas-Peucker. */
export function simplificar(pts: Point[], tol: number): Point[] {
  if (pts.length < 3) return pts.slice();
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let maior = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = L < 1e-9 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L;
    if (d > maior) { maior = d; idx = i; }
  }
  if (maior <= tol) return [a, b];
  return [...simplificar(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplificar(pts.slice(idx), tol)];
}

function comprimentoPts(pts: Point[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

/** Direção de saída na ponta (`inicio` ou fim), medida num trecho de até `trecho`. */
function direcaoNaPonta(pts: Point[], inicio: boolean, trecho: number): Point {
  const seq = inicio ? pts : [...pts].reverse();
  const p0 = seq[0];
  let q = seq[seq.length - 1];
  let acc = 0;
  for (let i = 1; i < seq.length; i++) {
    acc += Math.hypot(seq[i][0] - seq[i - 1][0], seq[i][1] - seq[i - 1][1]);
    if (acc >= trecho) { q = seq[i]; break; }
  }
  const dx = p0[0] - q[0], dy = p0[1] - q[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

/** Separa os componentes pequenos e compridos da máscara (os traços de um
 * tracejado) e devolve cada um como o segmento do seu eixo principal; o resto
 * da máscara segue pro afinamento. Bolinha (pingo, sujeira) some. */
export function tracinhos(m: Uint8Array, w: number, h: number, maxComprimento: number): { pedacos: Point[][]; resto: Uint8Array } {
  const resto = m.slice();
  const visto = new Uint8Array(w * h);
  const pedacos: Point[][] = [];
  const fila: number[] = [];
  const comp: number[] = [];
  for (let s0 = 0; s0 < w * h; s0++) {
    if (!m[s0] || visto[s0]) continue;
    // componente com 8 vizinhos (traço diagonal fino só se toca pelas quinas)
    comp.length = 0;
    fila.length = 0;
    fila.push(s0);
    visto[s0] = 1;
    let grande = false;
    while (fila.length) {
      const i = fila.pop()!;
      comp.push(i);
      if (comp.length > maxComprimento * maxComprimento) grande = true;
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (m[j] && !visto[j]) { visto[j] = 1; fila.push(j); }
      }
    }
    if (grande) continue;
    // eixo principal pela covariância dos pixels
    let mx = 0, my = 0;
    for (const i of comp) { mx += i % w; my += Math.floor(i / w); }
    mx /= comp.length; my /= comp.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const i of comp) {
      const dx = (i % w) - mx, dy = Math.floor(i / w) - my;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ux = Math.cos(ang), uy = Math.sin(ang);
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const i of comp) {
      const dx = (i % w) - mx, dy = Math.floor(i / w) - my;
      const t = dx * ux + dy * uy, n = -dx * uy + dy * ux;
      a = Math.min(a, t); b = Math.max(b, t); c = Math.min(c, n); d = Math.max(d, n);
    }
    const comprimento = b - a + 1, largura = d - c + 1;
    if (comprimento > maxComprimento) continue;
    for (const i of comp) resto[i] = 0;
    if (comprimento < largura * 1.6) continue;
    pedacos.push([[mx + 0.5 + ux * a, my + 0.5 + uy * a], [mx + 0.5 + ux * b, my + 0.5 + uy * b]]);
  }
  return { pedacos, resto };
}

function distanciaAPolilinha(p: Point, l: Point[]): number {
  let melhor = Infinity;
  for (let i = 0; i < l.length; i++) {
    const a = l[i], b = l[Math.min(i + 1, l.length - 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    melhor = Math.min(melhor, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return melhor;
}

/** Emenda os traços de uma linha tracejada: pontas próximas, alinhadas entre si
 * e com o vão entre elas. */
export function juntarTracos(linhas: Point[][], vaoMax: number, angMaxGraus: number, desvioMax: number): Point[][] {
  const n = linhas.length;
  const cosMax = Math.cos((angMaxGraus * Math.PI) / 180);
  const ponta = (e: number): Point => (e % 2 === 0 ? linhas[e >> 1][0] : linhas[e >> 1][linhas[e >> 1].length - 1]);
  const dir = linhas.flatMap((l) => [direcaoNaPonta(l, true, vaoMax), direcaoNaPonta(l, false, vaoMax)]);
  const pares: { a: number; b: number; d: number }[] = [];
  for (let ea = 0; ea < 2 * n; ea++) {
    for (let eb = ea + 1; eb < 2 * n; eb++) {
      if (ea >> 1 === eb >> 1) continue;
      const pa = ponta(ea), pb = ponta(eb);
      const g: Point = [pb[0] - pa[0], pb[1] - pa[1]];
      const d = Math.hypot(g[0], g[1]);
      if (d > vaoMax) continue;
      const da = dir[ea], db = dir[eb];
      // as duas saídas apontam uma pra outra
      if (da[0] * -db[0] + da[1] * -db[1] < cosMax) continue;
      if (d > 1e-6) {
        if ((da[0] * g[0] + da[1] * g[1]) / d < cosMax) continue;
        // e a outra ponta não está deslocada de lado
        if (Math.abs(da[0] * g[1] - da[1] * g[0]) > desvioMax) continue;
      }
      pares.push({ a: ea, b: eb, d });
    }
  }
  pares.sort((x, y) => x.d - y.d);
  const liga = new Int32Array(2 * n).fill(-1);
  const pai = Array.from({ length: n }, (_, i) => i);
  const raiz = (i: number): number => (pai[i] === i ? i : (pai[i] = raiz(pai[i])));
  for (const { a, b } of pares) {
    if (liga[a] >= 0 || liga[b] >= 0) continue;
    const ra = raiz(a >> 1), rb = raiz(b >> 1);
    if (ra === rb) continue;
    liga[a] = b;
    liga[b] = a;
    pai[ra] = rb;
  }
  const usada = new Uint8Array(n);
  const out: Point[][] = [];
  const montar = (i: number, entrada: number): void => {
    const pts: Point[] = [];
    let atual = i, ent = entrada;
    while (atual >= 0 && !usada[atual]) {
      usada[atual] = 1;
      const l = ent % 2 === 0 ? linhas[atual] : [...linhas[atual]].reverse();
      pts.push(...l);
      const saida = ent % 2 === 0 ? 2 * atual + 1 : 2 * atual;
      const prox = liga[saida];
      if (prox < 0) break;
      atual = prox >> 1;
      ent = prox;
    }
    out.push(pts);
  };
  for (let i = 0; i < n; i++) {
    if (usada[i]) continue;
    if (liga[2 * i] < 0) montar(i, 2 * i);
    else if (liga[2 * i + 1] < 0) montar(i, 2 * i + 1);
  }
  for (let i = 0; i < n; i++) if (!usada[i]) montar(i, 2 * i);
  return out;
}

// ---------------------------------------------------------------- decalque

export interface OpcoesDecalque {
  /** Pixels da imagem endireitada por mm. */
  pxPorMm: number;
  /** 0–255; até este tom é tinta (o Otsu devolve o último tom da turma escura). */
  limiar: number;
  /** Fecha falhas do contorno até este tamanho, em mm (foto com traço falhado). */
  fecharFalhas: number;
  /** Vão fechado com área até esta fração da peça é furo; maior, é painel. */
  furoMax: number;
  /** Maior vão entre traços de uma dobra tracejada, em mm. */
  vaoTracejado: number;
  /** Linha de dobra mais curta que isto (mm) é descartada (sujeira, texto miúdo). */
  minimo: number;
  /** Troca o traçado fiel aos pixels por retas, círculos e curvas limpas. */
  regularizar?: boolean;
}

export const OPCOES_PADRAO: Omit<OpcoesDecalque, 'pxPorMm' | 'limiar'> = {
  fecharFalhas: 0.4,
  furoMax: 0.02,
  vaoTracejado: 5,
  minimo: 5,
  regularizar: true,
};

export type OrigemLinha = 'contorno' | 'furo' | 'interna';
export type TipoLinha = 'corte' | 'dobra' | 'ignorar';

export interface LinhaDetectada {
  id: number;
  origem: OrigemLinha;
  /** Sugestão: contorno e furo são corte, interna é dobra. */
  tipo: TipoLinha;
  path: VPath;
}

export interface ResultadoDecalque {
  linhas: LinhaDetectada[];
  /** Espessura média do traço do molde, em mm. */
  traco: number;
  w: number;
  h: number;
  avisos: string[];
}

const polyMm = (poly: Polygon, k: number): VPath => polygonToVPath(poly.map(([x, y]): Point => [x / k, y / k]));

export function decalcar(g: Cinza, o: OpcoesDecalque): ResultadoDecalque {
  const { w, h } = g;
  const k = o.pxPorMm;
  const avisos: string[] = [];
  const tinta = new Uint8Array(w * h);
  let nTinta = 0;
  for (let i = 0; i < w * h; i++) if (g.data[i] <= o.limiar) { tinta[i] = 1; nTinta++; }
  const vazio: ResultadoDecalque = { linhas: [], traco: 0, w: w / k, h: h / k, avisos };
  if (nTinta < 20) {
    avisos.push('Não achei linhas na imagem. Aumente a sensibilidade ou confira os cantos.');
    return vazio;
  }
  if (nTinta > w * h * 0.5) {
    avisos.push('Mais da metade da imagem ficou escura: diminua a sensibilidade ou marque só o papel.');
    return vazio;
  }

  const r = Math.max(0, Math.round(o.fecharFalhas * k));
  const tintaD = dilatar(tinta, w, h, r);
  const fora = inundarDeFora(tintaD, w, h);
  const peca = new Uint8Array(w * h);
  let areaPeca = 0;
  for (let i = 0; i < w * h; i++) if (!fora[i]) { peca[i] = 255; areaPeca++; }
  if (areaPeca < w * h * 0.005) {
    avisos.push('Não achei um contorno fechado. Se o traço do corte tem falhas, aumente "Fechar falhas".');
    return vazio;
  }

  // espessura do traço = área de tinta / comprimento do esqueleto
  const skTudo = esqueleto(tinta, w, h);
  let nSk = 0;
  for (let i = 0; i < w * h; i++) if (skTudo[i]) nSk++;
  const tracoPx = Math.max(1, Math.min(20, nTinta / Math.max(1, nSk)));
  const recuo = (tracoPx / 2 + r) / k;

  const linhas: LinhaDetectada[] = [];
  let id = 0;

  // contorno: a borda da peça, puxada pra dentro até o meio do traço
  const minArea = Math.max(16, (10 * k) ** 2);
  for (const poly of traceMask({ data: peca, w, h }, { fillHoles: true, smoothSigma: 1, minArea })) {
    for (const path of offsetOutline([area([polyMm(poly, k)])], -recuo, { outerOnly: true })) {
      linhas.push({ id: id++, origem: 'contorno', tipo: 'corte', path });
    }
  }

  // furos: vãos fechados pequenos dentro da peça
  const dentroVazio = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (!fora[i] && !tintaD[i]) dentroVazio[i] = 1;
  const { rotulo, areas } = rotular(dentroVazio, w, h);
  const ehFuro = areas.map((a) => a <= areaPeca * o.furoMax && a >= (1.2 * k) ** 2);
  // Vão separado de fora só pelo traço do contorno é aba ou painel fechado por
  // dobra contínua (moldes que desenham a dobra como linha cheia), não furo.
  const encostaLim = Math.ceil(tracoPx * 1.5 + r + 2);
  const distFora = distancia(fora, w, h, encostaLim + 1);
  for (let i = 0; i < w * h; i++) {
    const c = rotulo[i] - 1;
    if (c >= 0 && ehFuro[c] && distFora[i] <= encostaLim) ehFuro[c] = false;
  }
  const furos = new Uint8Array(w * h);
  // caixa de cada componente numa passada só
  const caixa = areas.map(() => [w, h, 0, 0]);
  for (let i = 0; i < w * h; i++) {
    const c = rotulo[i] - 1;
    if (c < 0 || !ehFuro[c]) continue;
    const x = i % w, y = (i - x) / w;
    const b = caixa[c];
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
  }
  areas.forEach((_, c) => {
    if (!ehFuro[c]) return;
    const [x0, y0, x1, y1] = caixa[c];
    // recorte com 2 px de folga, pro traçado ter borda
    const cw = x1 - x0 + 5, ch = y1 - y0 + 5;
    const m = new Uint8Array(cw * ch);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (rotulo[y * w + x] === c + 1) { m[(y - y0 + 2) * cw + (x - x0 + 2)] = 255; furos[y * w + x] = 1; }
    }
    for (const poly of traceMask({ data: m, w: cw, h: ch }, { fillHoles: true, smoothSigma: 1, minArea: 4 })) {
      const desloc = poly.map(([x, y]): Point => [x + x0 - 2, y + y0 - 2]);
      for (const path of offsetOutline([area([polyMm(desloc, k)])], recuo, { outerOnly: true })) {
        linhas.push({ id: id++, origem: 'furo', tipo: 'corte', path });
      }
    }
  });

  // dobras: a tinta de dentro, longe do contorno e dos furos
  const faixa = Math.ceil(tracoPx * 1.5 + r + 1);
  const borda = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (fora[i] || furos[i]) borda[i] = 1;
  const dist = distancia(borda, w, h, faixa + 2);
  const interna = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (tinta[i] && !fora[i] && dist[i] > faixa) interna[i] = 1;
  // Traço curto (pedaço de tracejado) vira o próprio eixo dele: o afinamento
  // reduziria um tracinho fino de 2 mm a dois ou três pixels.
  const { pedacos, resto } = tracinhos(interna, w, h, Math.max(8, 8 * k));
  const sk = esqueleto(resto, w, h);
  const brutas = [...tracarEsqueleto(sk, w, h).map((l) => simplificar(l, 0.7)), ...pedacos]
    .filter((l) => comprimentoPts(l) >= Math.max(2, 0.8 * k));
  const emendadas = juntarTracos(brutas, o.vaoTracejado * k, 25, Math.max(2, 0.8 * k))
    .map((l) => simplificar(l, 0.7))
    .filter((l) => comprimentoPts(l) >= o.minimo * k);

  // As pontas pararam a uma faixa do contorno: estica até o meio do traço do
  // corte, se ele estiver ali na frente. Guarda quais pontas chegaram nele.
  const chegou = emendadas.map((l) =>
    [true, false].map((inicio) => {
      const p = inicio ? l[0] : l[l.length - 1];
      const d = direcaoNaPonta(l, inicio, 3 * k);
      // o tracejado pode terminar num vão: alcança até um vão inteiro além da faixa
      const max = faixa + tracoPx * 2 + Math.max(2, o.vaoTracejado) * k;
      for (let t = 0; t <= max; t += 0.5) {
        const x = Math.floor(p[0] + d[0] * t), y = Math.floor(p[1] + d[1] * t);
        if (x < 0 || y < 0 || x >= w || y >= h || fora[y * w + x] || furos[y * w + x]) {
          const recuoPx = tracoPx / 2 + r;
          if (t > recuoPx) {
            const q: Point = [p[0] + d[0] * (t - recuoPx), p[1] + d[1] * (t - recuoPx)];
            if (inicio) l.unshift(q); else l.push(q);
          }
          return true;
        }
      }
      return false;
    }),
  );

  // Linha solta no meio da peça — nenhuma ponta no contorno nem em outra linha
  // — é fenda (de encaixe, de alça), e fenda se corta. Volta fechada também.
  const perto = Math.max(3 * tracoPx, 1.5 * k, 0.8 * o.vaoTracejado * k);
  // fenda é curta; linha comprida solta é dobra que o tracejado não deixou emendar
  const fendaMax = 60 * k;
  // ponta perto do contorno (até um vão de tracejado) também não é solta
  const limBorda = faixa + Math.ceil(Math.max(2, o.vaoTracejado) * k) + 2;
  const distBorda = distancia(fora, w, h, limBorda + 1);
  const pertoDaBorda = (pt: Point): boolean => {
    const x = Math.min(w - 1, Math.max(0, Math.floor(pt[0]))), y = Math.min(h - 1, Math.max(0, Math.floor(pt[1])));
    return distBorda[y * w + x] <= limBorda;
  };
  const pontaLivre = (pt: Point, j: number): boolean =>
    !pertoDaBorda(pt) && emendadas.every((outra, i) => i === j || distanciaAPolilinha(pt, outra) > perto);
  emendadas.forEach((l, j) => {
    const fechada = l.length > 3 && Math.hypot(l[0][0] - l[l.length - 1][0], l[0][1] - l[l.length - 1][1]) < perto;
    const solta = !chegou[j][0] && !chegou[j][1] && comprimentoPts(l) <= fendaMax && pontaLivre(l[0], j) && pontaLivre(l[l.length - 1], j);
    const mm = l.map(([x, y]): Point => [x / k, y / k]);
    const reta = simplificar(mm, 0.35).length === 2;
    const path = reta ? linha(mm[0], mm[mm.length - 1]) : fitFreehand(mm, 0.2, fechada);
    if (path) linhas.push({ id: id++, origem: 'interna', tipo: fechada || solta ? 'corte' : 'dobra', path });
  });

  if (o.regularizar ?? true) {
    for (const l of linhas) {
      try {
        if (l.origem === 'contorno') l.path = regularizarContorno(l.path, REGULARIZAR_PADRAO);
        else if (l.origem === 'furo' || (l.path.closed && l.tipo === 'corte')) l.path = regularizarFuro(l.path, REGULARIZAR_PADRAO);
        else l.path = endireitarDobra(l.path, REGULARIZAR_PADRAO);
      } catch {
        // regularizar é acabamento: se falhar, fica o traçado fiel
      }
    }
  }

  if (!linhas.some((l) => l.origem === 'contorno')) avisos.push('Não consegui fechar o contorno do molde.');
  return { linhas, traco: tracoPx / k, w: w / k, h: h / k, avisos };
}
