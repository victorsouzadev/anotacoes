/** Vetorização do contorno de corte: extrai polígonos fechados da silhueta
 * (canal alpha) de um canvas via marching squares com interpolação subpixel,
 * suaviza com um passa-baixa gaussiano ao longo do contorno (preservando os
 * cantos propositais da arte) e emite curvas de Bézier — pra linha de corte
 * sair limpa pra máquina (ScanNCut etc.) em vez de serrilhada pixel a pixel. */

export type Point = [number, number];
export type Polygon = Point[];

/** Canal alpha já separado, que é tudo que o traçado precisa. */
export interface AlphaMask {
  data: ArrayLike<number>;
  w: number;
  h: number;
}

export interface TraceOptions {
  /** Alpha mínimo (0–255) pra um pixel contar como "dentro". */
  alphaThreshold?: number;
  /** Mantém só os contornos externos, descartando furos internos. */
  fillHoles?: boolean;
  /** Desvio-padrão da suavização, em px de contorno (0 = desliga). */
  smoothSigma?: number;
  /** Virada acima deste ângulo (graus) é canto proposital e escapa da
   * suavização. 0 desliga a proteção e arredonda o contorno inteiro. */
  cornerAngle?: number;
  /** Tolerância de decimação em px, só pra enxugar a contagem de pontos
   * depois de suavizar (0 = desliga). Não é controle de suavização. */
  simplifyEpsilon?: number;
  /** Área mínima em px² pra um contorno ser mantido (descarta ruído). */
  minArea?: number;
}

/** Virada a partir da qual o contorno conta como canto proposital da arte
 * (bico de estrela, quina de quadrado) em vez de curva. */
export const CORNER_ANGLE = 60;

export function traceCutPaths(canvas: HTMLCanvasElement, options: TraceOptions = {}): Polygon[] {
  const w = canvas.width;
  const h = canvas.height;
  const rgba = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  return traceMask({ data: alpha, w, h }, options);
}

export function traceMask(mask: AlphaMask, options: TraceOptions = {}): Polygon[] {
  const {
    alphaThreshold = 128,
    fillHoles = true,
    smoothSigma = 0,
    cornerAngle = CORNER_ANGLE,
    simplifyEpsilon = 0,
    minArea = 16,
  } = options;

  const loops = marchingSquares(mask, alphaThreshold);

  // Filtra por área e, opcionalmente, descarta furos (orientação oposta à do
  // maior contorno — a tabela de casos gera orientação consistente).
  const withArea = loops
    .map((poly) => ({ poly, area: signedArea(poly) }))
    .filter((l) => Math.abs(l.area) >= minArea);
  if (!withArea.length) return [];

  let kept = withArea;
  if (fillHoles) {
    const outerSign = Math.sign(withArea.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a)).area);
    kept = withArea.filter((l) => Math.sign(l.area) === outerSign);
  }

  return kept
    .map(({ poly, area }) => {
      let p = poly;
      if (smoothSigma > 0) p = smoothContour(p, area, smoothSigma, cornerAngle);
      if (simplifyEpsilon > 0) p = simplifyClosed(p, simplifyEpsilon);
      return p;
    })
    .filter((p) => p.length >= 3);
}

// ---------- traçado ----------

/** Marching squares com interpolação subpixel: em vez de cravar o vértice no
 * meio da aresta da célula (o que fixa a escada do pixel de uma vez por todas),
 * procura onde o alpha cruza o limiar entre as duas amostras. A camada de
 * contorno já grava uma rampa de 1 px na borda externa, então essa informação
 * existe — só estava sendo jogada fora pelo teste binário.
 *
 * Os segmentos são indexados pela *aresta* de onde saem, não pela coordenada:
 * com interpolação a coordenada vira float arbitrário, mas a aresta continua
 * sendo um inteiro exato, e como toda aresta é compartilhada por exatamente
 * duas células ela é início de no máximo um segmento — que é o que garante a
 * ligação em loops fechados. */
function marchingSquares(mask: AlphaMask, threshold: number): Polygon[] {
  const { data, w, h } = mask;
  // Uma borda virtual vazia em volta faz silhuetas encostadas na borda fecharem.
  const at = (x: number, y: number): number =>
    x >= 0 && y >= 0 && x < w && y < h ? data[y * w + x] : 0;

  const stride = w + 2;
  /** Aresta horizontal entre (x,y) e (x+1,y). */
  const hKey = (x: number, y: number): number => ((y + 1) * stride + (x + 1)) * 2;
  /** Aresta vertical entre (x,y) e (x,y+1). */
  const vKey = (x: number, y: number): number => ((y + 1) * stride + (x + 1)) * 2 + 1;

  /** Fração em que o alpha cruza o limiar entre duas amostras vizinhas. */
  const cross = (a: number, b: number): number => (a === b ? 0.5 : (threshold - a) / (b - a));

  const segments = new Map<number, { k: number; x: number; y: number }>();

  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const atl = at(x, y);
      const atr = at(x + 1, y);
      const abr = at(x + 1, y + 1);
      const abl = at(x, y + 1);
      const idx =
        ((atl >= threshold ? 1 : 0) << 3) |
        ((atr >= threshold ? 1 : 0) << 2) |
        ((abr >= threshold ? 1 : 0) << 1) |
        (abl >= threshold ? 1 : 0);
      if (idx === 0 || idx === 15) continue;

      const tk = hKey(x, y), tx = x + cross(atl, atr), ty = y;
      const rk = vKey(x + 1, y), rx = x + 1, ry = y + cross(atr, abr);
      const bk = hKey(x, y + 1), bx = x + cross(abl, abr), by = y + 1;
      const lk = vKey(x, y), lx = x, ly = y + cross(atl, abl);

      const add = (sk: number, ek: number, ex: number, ey: number): void => {
        segments.set(sk, { k: ek, x: ex, y: ey });
      };

      switch (idx) {
        case 1: add(lk, bk, bx, by); break;
        case 2: add(bk, rk, rx, ry); break;
        case 3: add(lk, rk, rx, ry); break;
        case 4: add(rk, tk, tx, ty); break;
        case 5: add(lk, tk, tx, ty); add(rk, bk, bx, by); break;
        case 6: add(bk, tk, tx, ty); break;
        case 7: add(lk, tk, tx, ty); break;
        case 8: add(tk, lk, lx, ly); break;
        case 9: add(tk, bk, bx, by); break;
        case 10: add(tk, rk, rx, ry); add(bk, lk, lx, ly); break;
        case 11: add(tk, rk, rx, ry); break;
        case 12: add(rk, lk, lx, ly); break;
        case 13: add(rk, bk, bx, by); break;
        case 14: add(bk, lk, lx, ly); break;
      }
    }
  }

  // Liga os segmentos em loops fechados.
  const loops: Polygon[] = [];
  while (segments.size) {
    const startKey = segments.keys().next().value as number;
    const loop: Polygon = [];
    let k = startKey;
    for (;;) {
      const seg = segments.get(k);
      if (!seg) break;
      segments.delete(k);
      loop.push([seg.x, seg.y]);
      k = seg.k;
      if (k === startKey) break;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

// ---------- suavização ----------

/** Reamostra em passo constante, detecta os cantos, aplica o passa-baixa em
 * cada trecho entre cantos e devolve a área perdida no caminho. */
function smoothContour(poly: Polygon, area: number, sigma: number, cornerAngle: number): Polygon {
  const passo = 1;
  let p = resampleClosed(poly, passo);
  if (p.length < 5) return poly;
  const sigmaAmostras = sigma / passo;
  // A janela acompanha a escala da suavização, mas nunca desce de 4 amostras:
  // a escada do pixel vira 90° de um passo pro outro, e uma janela curta a
  // confundiria com canto proposital — aí a suavização fraca não suavizaria
  // nada. Larga demais também não serve: aí a curvatura de uma peça pequena
  // passaria por canto, e é por isso que ela cresce só junto com o sigma.
  const janela = Math.max(4, Math.round(sigmaAmostras));
  const cantos = findCorners(p, cornerAngle, janela);
  p = smoothClosed(p, sigmaAmostras, cantos);
  return restoreArea(p, area, sigma);
}

/** Reamostra o contorno em passo constante de comprimento de arco: o passa-baixa
 * precisa de amostras equiespaçadas pra suavizar igual em todo canto (o traçado
 * cru alterna segmentos de 1 px com diagonais de 1,4). */
function resampleClosed(poly: Polygon, step: number): Polygon {
  const n = poly.length;
  const comprimentos = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    comprimentos[i] = Math.hypot(b[0] - a[0], b[1] - a[1]);
    total += comprimentos[i];
  }
  if (!total) return poly;

  const quantidade = Math.max(4, Math.round(total / step));
  const passo = total / quantidade;
  const out: Polygon = [];
  let aresta = 0;
  let andado = 0;
  for (let k = 0; k < quantidade; k++) {
    const alvo = k * passo;
    while (aresta < n - 1 && andado + comprimentos[aresta] < alvo) {
      andado += comprimentos[aresta];
      aresta++;
    }
    const a = poly[aresta];
    const b = poly[(aresta + 1) % n];
    const t = comprimentos[aresta] ? (alvo - andado) / comprimentos[aresta] : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** Marca os vértices onde o contorno vira mais do que `angleDeg`, medindo a
 * virada sobre um trecho de `span` amostras pra cada lado — ponto a ponto a
 * conta pegaria o degrau do pixel em vez do canto de verdade. A supressão de
 * não-máximos garante que um canto vire um vértice só, não um punhado. */
function findCorners(poly: Polygon, angleDeg: number, span: number): boolean[] {
  const n = poly.length;
  const cantos = new Array<boolean>(n).fill(false);
  if (angleDeg <= 0 || n < 3) return cantos;

  const limite = (angleDeg * Math.PI) / 180;
  // a janela nunca passa de um quarto da volta, senão em contornos curtos
  // (o retângulo analítico tem 4 pontos) ela daria a volta e mediria bobagem
  const s = Math.max(1, Math.min(span, Math.floor(n / 4)));
  const virada = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = poly[(i - s + n) % n];
    const b = poly[i];
    const c = poly[(i + s) % n];
    const ax = b[0] - a[0], ay = b[1] - a[1];
    const bx = c[0] - b[0], by = c[1] - b[1];
    virada[i] = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
  }
  for (let i = 0; i < n; i++) {
    if (virada[i] < limite) continue;
    // empate fica de pé dos dois lados de propósito: num quadrado as quatro
    // viradas são iguais e todas as quatro são canto de verdade
    let maior = true;
    for (let d = -s; d <= s && maior; d++) {
      if (d !== 0 && virada[(i + d + n) % n] > virada[i]) maior = false;
    }
    cantos[i] = maior;
  }
  return cantos;
}

/** Passa-baixa ao longo do contorno. Sem cantos é uma convolução circular;
 * com cantos, cada trecho entre dois cantos é suavizado à parte, então o canto
 * não é atravessado pelo filtro e continua vivo. */
function smoothClosed(poly: Polygon, sigma: number, cantos: boolean[]): Polygon {
  const n = poly.length;
  const indices: number[] = [];
  for (let i = 0; i < n; i++) if (cantos[i]) indices.push(i);
  if (!indices.length) return gaussianClosed(poly, sigma);

  const out = new Array<Point>(n);
  for (let k = 0; k < indices.length; k++) {
    const ini = indices[k];
    const fim = indices[(k + 1) % indices.length];
    // com um canto só, o trecho dá a volta inteira e fecha nele mesmo
    const passos = (fim - ini + n) % n || n;
    const trecho: Polygon = [];
    for (let j = 0; j <= passos; j++) trecho.push(poly[(ini + j) % n]);
    const suave = gaussianOpen(trecho, sigma);
    for (let j = 0; j < passos; j++) out[(ini + j) % n] = suave[j];
  }
  return out;
}

function gaussianKernel(sigma: number): Float64Array {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float64Array(r * 2 + 1);
  let soma = 0;
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = w;
    soma += w;
  }
  for (let i = 0; i < k.length; i++) k[i] /= soma;
  return k;
}

function gaussianClosed(poly: Polygon, sigma: number): Polygon {
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) / 2;
  const n = poly.length;
  const out: Polygon = new Array(n);
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0;
    for (let j = -r; j <= r; j++) {
      const p = poly[(((i + j) % n) + n) % n];
      x += p[0] * k[j + r];
      y += p[1] * k[j + r];
    }
    out[i] = [x, y];
  }
  return out;
}

/** Trecho aberto: as pontas são cantos e precisam ficar exatamente onde estão.
 * O preenchimento fora do trecho é a reflexão ímpar em torno da ponta
 * (p[−i] = 2·p[0] − p[i]), que preserva a direção da tangente e faz os pesos se
 * cancelarem na ponta — replicar o último ponto puxaria a curva pra dentro do
 * canto, que é justamente o que se quer evitar. */
function gaussianOpen(poly: Polygon, sigma: number): Polygon {
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) / 2;
  const n = poly.length;
  const amostra = (i: number): Point => {
    if (i < 0) {
      const p = poly[Math.min(-i, n - 1)];
      return [2 * poly[0][0] - p[0], 2 * poly[0][1] - p[1]];
    }
    if (i >= n) {
      const p = poly[Math.max(0, 2 * (n - 1) - i)];
      return [2 * poly[n - 1][0] - p[0], 2 * poly[n - 1][1] - p[1]];
    }
    return poly[i];
  };
  const out: Polygon = new Array(n);
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0;
    for (let j = -r; j <= r; j++) {
      const p = amostra(i + j);
      x += p[0] * k[j + r];
      y += p[1] * k[j + r];
    }
    out[i] = [x, y];
  }
  return out;
}

/** O passa-baixa encurta curvas convexas, então a área sempre cai um pouco — e
 * com ela a linha de corte migra pra dentro da margem colorida impressa, ou
 * seja, o corte come a borda. Aqui a área original volta empurrando todo mundo
 * pra fora ao longo da normal (em primeira ordem, deslocar `d` muda a área em
 * `d × perímetro`). */
function restoreArea(poly: Polygon, areaAlvo: number, maxOffset: number): Polygon {
  const area = signedArea(poly);
  if (!area) return poly;
  const n = poly.length;
  let perimetro = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    perimetro += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  if (!perimetro) return poly;

  const delta = (Math.abs(areaAlvo) - Math.abs(area)) / perimetro;
  if (!(delta > 0)) return poly;
  const d = Math.min(delta, maxOffset);
  const sinal = area > 0 ? 1 : -1;

  return poly.map((p, i) => {
    const a = poly[(i - 1 + n) % n];
    const b = poly[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (!len) return p;
    return [p[0] + (sinal * dy * d) / len, p[1] - (sinal * dx * d) / len] as Point;
  });
}

// ---------- geometria ----------

/** Área com sinal (positiva/negativa conforme a orientação do polígono). */
export function polygonArea(poly: Polygon): number {
  return signedArea(poly);
}

/** Ray casting: o ponto está dentro do polígono? */
export function pointInPolygon(poly: Polygon, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Índice do menor contorno que contém o ponto, ou -1. "Menor" porque o ponto
 * clicado dentro de um recorte interno também cai dentro do contorno externo —
 * quem o usuário mirou é sempre o mais justo ao clique. */
export function smallestPathContaining(paths: Polygon[], x: number, y: number): number {
  let best = -1;
  let bestArea = Infinity;
  for (let i = 0; i < paths.length; i++) {
    if (!pointInPolygon(paths[i], x, y)) continue;
    const area = Math.abs(signedArea(paths[i]));
    if (area < bestArea) {
      bestArea = area;
      best = i;
    }
  }
  return best;
}

function signedArea(poly: Polygon): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Ramer-Douglas-Peucker pra polígono fechado: ancora nos dois pontos mais
 * distantes entre si e simplifica cada metade. */
function simplifyClosed(poly: Polygon, epsilon: number): Polygon {
  if (poly.length < 4) return poly;
  let iA = 0, iB = 0, maxD = -1;
  // aproximação: ponto mais distante do primeiro, depois o mais distante dele
  for (let i = 1; i < poly.length; i++) {
    const d = dist2(poly[0], poly[i]);
    if (d > maxD) { maxD = d; iA = i; }
  }
  maxD = -1;
  for (let i = 0; i < poly.length; i++) {
    const d = dist2(poly[iA], poly[i]);
    if (d > maxD) { maxD = d; iB = i; }
  }
  const [lo, hi] = iA < iB ? [iA, iB] : [iB, iA];
  const half1 = poly.slice(lo, hi + 1);
  const half2 = [...poly.slice(hi), ...poly.slice(0, lo + 1)];
  const s1 = rdp(half1, epsilon);
  const s2 = rdp(half2, epsilon);
  return [...s1.slice(0, -1), ...s2.slice(0, -1)];
}

function rdp(points: Polygon, epsilon: number): Polygon {
  if (points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  let index = -1, maxD = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxD) { maxD = d; index = i; }
  }
  if (maxD > epsilon) {
    const left = rdp(points.slice(0, index + 1), epsilon);
    const right = rdp(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.sqrt(dist2(p, a));
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.sqrt(len2);
}

function dist2(a: Point, b: Point): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

// ---------- curvas ----------

/** Um trecho da curva. `c1`/`c2` nulos = trecho reto (de canto a canto). */
export interface CubicSegment {
  c1: Point | null;
  c2: Point | null;
  to: Point;
}

export interface CubicPath {
  start: Point;
  segments: CubicSegment[];
}

export interface FitOptions {
  /** Erro máximo tolerado entre a curva e o contorno, em px. */
  tolerance?: number;
  /** Virada acima deste ângulo (graus) vira quebra: a curva chega e sai dela
   * em linha reta, então ponta de estrela continua ponta. */
  cornerAngle?: number;
}

const MAX_REPARAM = 4;
/** Teto do tamanho da tangente, em múltiplos da corda. Uma cúbica que aproxima
 * até uma semicircunferência precisa de ~0,7 da corda, então 3 é folga larga e
 * ainda assim barra o estufamento do ajuste degenerado. */
const MAX_ALPHA = 3;
const MAX_DEPTH = 24;

/** A máquina desacelera em cada vértice de uma polilinha, então a saída é
 * curva. O ajuste é de mínimos quadrados (Schneider, Graphics Gems 1990): cada
 * trecho ganha a cúbica que melhor aproxima *todos* os pontos e só é partido em
 * dois quando o erro passa da tolerância.
 *
 * Passar uma curva pelos pontos de um polígono decimado — que era o que se
 * fazia antes — custa caro em fidelidade: o RDP escolhe quem fica medindo
 * distância até uma *reta*, sem saber que a saída ia ser curva, e o erro dele
 * entra inteiro no resultado. Aqui o contorno denso é a referência e a
 * tolerância é garantida, então sai ao mesmo tempo mais fiel e com menos
 * curvas. */
export function polygonToCubics(poly: Polygon, options: FitOptions = {}): CubicPath {
  const { tolerance = 0.25, cornerAngle = CORNER_ANGLE } = options;
  const n = poly.length;
  if (n < 3) return { start: poly[0] ?? [0, 0], segments: [] };

  const cantos = findCorners(poly, cornerAngle, 1);
  const quebras: number[] = [];
  for (let i = 0; i < n; i++) if (cantos[i]) quebras.push(i);
  const segments: CubicSegment[] = [];
  const tol2 = tolerance * tolerance;

  if (!quebras.length) {
    // Laço sem canto: abre na costura e casa as tangentes das duas pontas com
    // os vizinhos que dão a volta — senão a emenda sairia com um bico.
    const t = unit(sub(poly[1], poly[n - 1]));
    fitCubic([...poly, poly[0]], 0, n, t, neg(t), tol2, 0, segments);
    return { start: poly[0], segments };
  }

  for (let k = 0; k < quebras.length; k++) {
    const ini = quebras[k];
    const passos = (quebras[(k + 1) % quebras.length] - ini + n) % n || n;
    const trecho: Polygon = [];
    for (let j = 0; j <= passos; j++) trecho.push(poly[(ini + j) % n]);
    fitCubic(trecho, 0, passos, tangentAt(trecho, 0, 1), tangentAt(trecho, passos, -1), tol2, 0, segments);
  }
  // o caminho tem de começar num canto, pra os trechos fecharem a volta
  return { start: poly[quebras[0]], segments };
}

/** Direção do contorno na ponta de um trecho, olhando pra dentro dele. */
function tangentAt(d: Polygon, i: number, passo: number): Point {
  return unit(sub(d[i + passo], d[i]));
}

function fitCubic(
  d: Polygon, first: number, last: number, tHat1: Point, tHat2: Point,
  tol2: number, depth: number, out: CubicSegment[],
): void {
  if (last - first === 1) {
    const dist = Math.hypot(d[last][0] - d[first][0], d[last][1] - d[first][1]) / 3;
    push(out, [d[first], add(d[first], scale(tHat1, dist)), add(d[last], scale(tHat2, dist)), d[last]]);
    return;
  }

  let u = chordLengthParameterize(d, first, last);
  let bez = generateBezier(d, first, last, u, tHat1, tHat2);
  let { erro, corte } = maxError(d, first, last, bez, u);
  if (erro < tol2) { push(out, bez); return; }

  // Perto o bastante: vale reposicionar os parâmetros antes de partir em dois,
  // porque o comprimento de corda é só um chute de onde cada ponto cai na curva.
  if (erro < tol2 * 4) {
    for (let i = 0; i < MAX_REPARAM; i++) {
      u = reparameterize(d, first, last, u, bez);
      bez = generateBezier(d, first, last, u, tHat1, tHat2);
      ({ erro, corte } = maxError(d, first, last, bez, u));
      if (erro < tol2) { push(out, bez); return; }
    }
  }
  if (depth >= MAX_DEPTH) { push(out, bez); return; }

  const centro = centerTangent(d, corte);
  fitCubic(d, first, corte, tHat1, centro, tol2, depth + 1, out);
  fitCubic(d, corte, last, neg(centro), tHat2, tol2, depth + 1, out);
}

function push(out: CubicSegment[], bez: Point[]): void {
  out.push(isStraight(bez) ? { c1: null, c2: null, to: bez[3] } : { c1: bez[1], c2: bez[2], to: bez[3] });
}

/** Cúbica com os dois controles em cima da corda *é* a reta. Vale gravar como
 * reta: sai menor no SVG e a lâmina não tem por que tratar como curva. É o que
 * mantém o retângulo analítico com quatro lados retos. */
function isStraight(bez: Point[]): boolean {
  const [p0, c1, c2, p3] = bez;
  const dx = p3[0] - p0[0];
  const dy = p3[1] - p0[1];
  const len = Math.hypot(dx, dy);
  if (!len) return true;
  const desvio = (c: Point): number => Math.abs(dy * (c[0] - p0[0]) - dx * (c[1] - p0[1])) / len;
  return desvio(c1) < 1e-6 && desvio(c2) < 1e-6;
}

/** Resolve por mínimos quadrados o tamanho das duas tangentes que melhor
 * encaixam a cúbica nos pontos, com as direções já fixadas. */
function generateBezier(d: Polygon, first: number, last: number, u: number[], tHat1: Point, tHat2: Point): Point[] {
  const p0 = d[first];
  const p3 = d[last];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;

  for (let i = first; i <= last; i++) {
    const t = u[i - first];
    const a0 = scale(tHat1, bern(1, t));
    const a1 = scale(tHat2, bern(2, t));
    c00 += dot(a0, a0);
    c01 += dot(a0, a1);
    c11 += dot(a1, a1);
    const base0 = bern(0, t) + bern(1, t);
    const base3 = bern(2, t) + bern(3, t);
    const resto: Point = [
      d[i][0] - (p0[0] * base0 + p3[0] * base3),
      d[i][1] - (p0[1] * base0 + p3[1] * base3),
    ];
    x0 += dot(a0, resto);
    x1 += dot(a1, resto);
  }

  const det = c00 * c11 - c01 * c01;
  const corda = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  let alfa1 = 0, alfa2 = 0;
  if (Math.abs(det) > 1e-12) {
    alfa1 = (x0 * c11 - x1 * c01) / det;
    alfa2 = (c00 * x1 - c01 * x0) / det;
  }
  // Sistema degenerado: cai no palpite de Wu/Barsky, um terço da corda pra cada
  // lado. Além da tangente pra trás (alfa negativo), o teto importa: num trecho
  // de escada as tangentes das pontas ficam quase perpendiculares à corda, o
  // mínimos quadrados responde com alfa de dezenas de vezes a corda e a curva
  // estufa pra longe. O erro medido nos pontos não pega isso, porque a barriga
  // fica *entre* eles — então o limite tem de estar aqui.
  const teto = corda * MAX_ALPHA;
  if (!(alfa1 > 1e-6 * corda) || !(alfa2 > 1e-6 * corda) || alfa1 > teto || alfa2 > teto) {
    const terco = corda / 3;
    return [p0, add(p0, scale(tHat1, terco)), add(p3, scale(tHat2, terco)), p3];
  }
  return [p0, add(p0, scale(tHat1, alfa1)), add(p3, scale(tHat2, alfa2)), p3];
}

/** Maior distância (ao quadrado) entre a curva e os pontos, e onde ela está —
 * é por ali que o trecho é partido quando não cabe na tolerância. */
function maxError(d: Polygon, first: number, last: number, bez: Point[], u: number[]): { erro: number; corte: number } {
  let erro = 0;
  let corte = first + Math.floor((last - first) / 2);
  for (let i = first + 1; i < last; i++) {
    const p = bezierAt(bez, u[i - first]);
    const dx = p[0] - d[i][0];
    const dy = p[1] - d[i][1];
    const dist = dx * dx + dy * dy;
    if (dist >= erro) { erro = dist; corte = i; }
  }
  return { erro, corte };
}

/** Newton-Raphson em cada ponto: acha o parâmetro em que a curva passa mais
 * perto dele, no lugar do chute pelo comprimento de corda. */
function reparameterize(d: Polygon, first: number, last: number, u: number[], bez: Point[]): number[] {
  const d1 = derivative(bez);
  const d2 = derivative(d1);
  const out: number[] = [];
  for (let i = first; i <= last; i++) {
    const t = u[i - first];
    const q = bezierAt(bez, t);
    const q1 = bezierAt(d1, t);
    const q2 = bezierAt(d2, t);
    const dx = q[0] - d[i][0];
    const dy = q[1] - d[i][1];
    const num = dx * q1[0] + dy * q1[1];
    const den = q1[0] * q1[0] + q1[1] * q1[1] + dx * q2[0] + dy * q2[1];
    out.push(den === 0 ? t : t - num / den);
  }
  return out;
}

function centerTangent(d: Polygon, i: number): Point {
  const a = sub(d[i - 1], d[i]);
  const b = sub(d[i], d[i + 1]);
  const m = unit([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  // trecho reto: a média se anula e não sobra direção nenhuma
  return m[0] === 0 && m[1] === 0 ? unit(sub(d[i - 1], d[i + 1])) : m;
}

function chordLengthParameterize(d: Polygon, first: number, last: number): number[] {
  const u = [0];
  for (let i = first + 1; i <= last; i++) {
    u.push(u[i - first - 1] + Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]));
  }
  const total = u[u.length - 1];
  if (!total) return u.map(() => 0);
  return u.map((v) => v / total);
}

/** Base de Bernstein de grau 3. */
function bern(i: number, t: number): number {
  const u = 1 - t;
  if (i === 0) return u * u * u;
  if (i === 1) return 3 * t * u * u;
  if (i === 2) return 3 * t * t * u;
  return t * t * t;
}

/** de Casteljau — serve pra curva de qualquer grau, inclusive as derivadas. */
function bezierAt(ctrl: Point[], t: number): Point {
  const p = ctrl.map((c) => [c[0], c[1]] as Point);
  for (let k = p.length - 1; k > 0; k--) {
    for (let i = 0; i < k; i++) {
      p[i][0] += (p[i + 1][0] - p[i][0]) * t;
      p[i][1] += (p[i + 1][1] - p[i][1]) * t;
    }
  }
  return p[0];
}

function derivative(ctrl: Point[]): Point[] {
  const grau = ctrl.length - 1;
  const out: Point[] = [];
  for (let i = 0; i < grau; i++) {
    out.push([(ctrl[i + 1][0] - ctrl[i][0]) * grau, (ctrl[i + 1][1] - ctrl[i][1]) * grau]);
  }
  return out;
}

function sub(a: Point, b: Point): Point { return [a[0] - b[0], a[1] - b[1]]; }
function add(a: Point, b: Point): Point { return [a[0] + b[0], a[1] + b[1]]; }
function neg(a: Point): Point { return [-a[0], -a[1]]; }
function scale(a: Point, k: number): Point { return [a[0] * k, a[1] * k]; }
function dot(a: Point, b: Point): number { return a[0] * b[0] + a[1] * b[1]; }
function unit(a: Point): Point {
  const len = Math.hypot(a[0], a[1]);
  return len ? [a[0] / len, a[1] / len] : [0, 0];
}

/** Monta o atributo `d` de um <path> SVG a partir dos polígonos, em curvas. */
export function polygonsToPathData(polys: Polygon[], decimals = 2, options: FitOptions = {}): string {
  return cubicPathsToData(polys.map((poly) => polygonToCubics(poly, options)), decimals);
}

/** Mesmo `d`, a partir de curvas já ajustadas — quem guarda o ajuste usa esta,
 * pra o SVG e o tracejado da prévia saírem do mesmo caminho. */
export function cubicPathsToData(paths: CubicPath[], decimals = 2): string {
  return paths.map((p) => cubicPathToData(p, decimals)).filter(Boolean).join(' ');
}

/** Leva a curva pra outro sistema de coordenadas (px da peça → mm da folha),
 * levando junto os pontos de controle. */
export function mapCubicPath(path: CubicPath, f: (p: Point) => Point): CubicPath {
  return {
    start: f(path.start),
    segments: path.segments.map((s) => ({
      c1: s.c1 ? f(s.c1) : null,
      c2: s.c2 ? f(s.c2) : null,
      to: f(s.to),
    })),
  };
}

function cubicPathToData(path: CubicPath, decimals: number): string {
  if (!path.segments.length) return '';
  const f = (v: number): string => v.toFixed(decimals);
  const pt = (p: Point): string => `${f(p[0])} ${f(p[1])}`;
  let d = `M ${pt(path.start)}`;
  for (let i = 0; i < path.segments.length; i++) {
    const s = path.segments[i];
    if (s.c1 && s.c2) d += ` C ${pt(s.c1)} ${pt(s.c2)} ${pt(s.to)}`;
    // o último trecho reto é o próprio fechamento: o Z já desenha essa linha
    else if (i < path.segments.length - 1) d += ` L ${pt(s.to)}`;
  }
  return `${d} Z`;
}

// ---------- PNG ----------

/** Injeta um chunk pHYs (DPI) num PNG já codificado, logo após o IHDR, pra
 * impressão sair no tamanho físico certo sem depender de ajuste manual. */
export async function pngBlobWithDpi(blob: Blob, dpi: number): Promise<Blob> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  // assinatura PNG (8) + IHDR: len(4) + tipo(4) + dados(13) + crc(4) = offset 33
  const insertAt = 33;
  const ppm = Math.round(dpi / 0.0254);
  const chunkData = new Uint8Array(4 + 4 + 9 + 4);
  const view = new DataView(chunkData.buffer);
  view.setUint32(0, 9);
  chunkData.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunkData[16] = 1; // unidade: metro
  view.setUint32(17, crc32(chunkData.subarray(4, 17)));
  const out = new Uint8Array(buf.length + chunkData.length);
  out.set(buf.subarray(0, insertAt));
  out.set(chunkData, insertAt);
  out.set(buf.subarray(insertAt), insertAt + chunkData.length);
  return new Blob([out], { type: 'image/png' });
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
