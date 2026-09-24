/** Vetorização de imagem do modo Ilustração: lê um bitmap e devolve camadas
 * de curvas. Quatro leituras, cada uma boa pra um tipo de arte:
 *
 * - **cores**: quantiza em N cores (k-means) e vetoriza cada uma. As camadas
 *   são empilhadas — cada uma cobre também a área das que vêm por cima —, o
 *   que elimina as frestas brancas entre cores vizinhas;
 * - **traço**: limiar de luminância, pra desenho a traço, letra e logo P&B;
 * - **silhueta**: só a forma de fora (pelo alpha, ou pela diferença do fundo);
 * - **centro**: afina o traço até um pixel e segue o esqueleto — sai uma
 *   linha só no meio do risco, pra caneta da plotter ou caligrafia.
 *
 * Tudo em pixels da imagem, puro e síncrono: roda no worker e nos testes. */

import { CORNER_ANGLE, Point, Polygon, polygonArea, polygonToCubics, traceMask } from './contour';
import { VPath, rgbToHex } from './illustration-model';

export type VectorMode = 'cores' | 'traco' | 'silhueta' | 'centro';
export type PresetId = 'logo' | 'traco' | 'clipart' | 'foto' | 'silhueta' | 'centro';

export interface RgbaImage {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

export interface VectorizeParams {
  mode: VectorMode;
  /** Cores da quantização (modo cores), 2 a 16. */
  colors: number;
  /** Limiar de luminância 0–255 (traço/centro) ou tolerância do fundo
   * (silhueta). -1 = automático (Otsu / valor padrão). */
  threshold: number;
  /** Traço claro sobre fundo escuro. */
  invert: boolean;
  /** 0–100: quanto maior, menores as manchas que sobrevivem. */
  detail: number;
  /** Desvio-padrão da suavização do contorno, em px. */
  smoothing: number;
  /** Raio do desfoque antes de quantizar (tira ruído e textura de foto). */
  blur: number;
  keepCorners: boolean;
  /** Descarta a cor do fundo (a que domina a borda da imagem). */
  removeBackground: boolean;
  /** Silhueta: mantém os vãos internos. */
  keepHoles: boolean;
}

export interface VectorLayerOut {
  name: string;
  color: string;
  paths: VPath[];
  /** Linha (sem preenchimento), com a espessura em px. */
  stroke: boolean;
  strokeWidthPx: number;
}

export interface VectorizeResult {
  layers: VectorLayerOut[];
  w: number;
  h: number;
}

export interface ImageStats {
  /** Fração de pixels transparentes. */
  transparent: number;
  /** Saturação média (0–1) dos pixels opacos. */
  colorfulness: number;
  /** Fração de pixels quase brancos / quase pretos. */
  light: number;
  dark: number;
  /** Cores que sobram depois de juntar as parecidas, com ao menos 1% da área. */
  effectiveColors: number;
  /** Fração dos pixels que ficam perto do centro da sua cor: 1 = chapado. */
  flatness: number;
  otsu: number;
  /** A borda é quase toda de uma cor clara (fundo removível). */
  plainBackground: boolean;
}

export interface Suggestion {
  preset: PresetId;
  reason: string;
  params: VectorizeParams;
}

export const DEFAULT_PARAMS: VectorizeParams = {
  mode: 'cores', colors: 6, threshold: -1, invert: false, detail: 60, smoothing: 1.2, blur: 0,
  keepCorners: true, removeBackground: true, keepHoles: true,
};

export const PRESET_LABELS: Record<PresetId, string> = {
  logo: 'Logo / ícone',
  traco: 'Desenho a traço',
  clipart: 'Clipart colorido',
  foto: 'Foto',
  silhueta: 'Silhueta',
  centro: 'Linha central',
};

// ---------- análise ----------

function lum(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Cor composta sobre branco: pixel semitransparente conta como mais claro. */
function over(data: Uint8ClampedArray, i: number): [number, number, number] {
  const a = data[i + 3] / 255;
  return [data[i] * a + 255 * (1 - a), data[i + 1] * a + 255 * (1 - a), data[i + 2] * a + 255 * (1 - a)];
}

/** Limiar de Otsu. Em imagem de poucos tons a separação ótima é um platô
 * (todo limiar entre o preto e o branco separa igual); o do meio do platô é o
 * que deixa folga dos dois lados, em vez de cravar em cima da cor do traço. */
export function otsuThreshold(hist: ArrayLike<number>): number {
  let total = 0, sum = 0;
  for (let i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
  let sumB = 0, wB = 0, best = -1, from = 128, to = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    sumB += t * hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best * (1 + 1e-9)) { best = between; from = to = t; }
    else if (between >= best * (1 - 1e-9)) to = t;
  }
  // `from` é o último tom da classe escura; o platô vai até o tom antes da clara.
  return Math.round((from + to + 1) / 2);
}

/** Gerador pseudoaleatório fixo: a mesma imagem sempre vira o mesmo vetor. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Rgb = [number, number, number];

function d2(a: Rgb, b: Rgb): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** k-means++ em RGB sobre uma amostra. */
export function kmeans(samples: Rgb[], k: number, iterations = 12): Rgb[] {
  if (!samples.length) return [];
  const rand = rng(samples.length * 31 + k);
  const centers: Rgb[] = [samples[Math.floor(rand() * samples.length)]];
  const dist = new Float64Array(samples.length).fill(Infinity);
  while (centers.length < Math.min(k, samples.length)) {
    const c = centers[centers.length - 1];
    let total = 0;
    for (let i = 0; i < samples.length; i++) {
      dist[i] = Math.min(dist[i], d2(samples[i], c));
      total += dist[i];
    }
    if (total === 0) break;
    let r = rand() * total;
    let pick = 0;
    for (; pick < samples.length - 1; pick++) {
      r -= dist[pick];
      if (r <= 0) break;
    }
    centers.push([...samples[pick]] as Rgb);
  }
  const assign = new Int32Array(samples.length);
  for (let it = 0; it < iterations; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < samples.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = d2(samples[i], centers[c]);
        if (d < bd) { bd = d; best = c; }
      }
      assign[i] = best;
      const a = acc[best];
      a[0] += samples[i][0]; a[1] += samples[i][1]; a[2] += samples[i][2]; a[3]++;
    }
    let moved = false;
    centers.forEach((c, i) => {
      const a = acc[i];
      if (!a[3]) return;
      const n: Rgb = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
      if (d2(n, c) > 0.25) moved = true;
      centers[i] = n;
    });
    if (!moved) break;
  }
  return centers;
}

/** Junta centros quase iguais: pedir 2 cores numa arte de uma cor só não
 * deve dar duas camadas do mesmo cinza. */
function mergeClose(centers: Rgb[], minDist: number): Rgb[] {
  const out: Rgb[] = [];
  for (const c of centers) if (!out.some((o) => d2(o, c) < minDist * minDist)) out.push(c);
  return out;
}

function sampleOpaque(img: RgbaImage, max: number): Rgb[] {
  const n = img.w * img.h;
  const stride = Math.max(1, Math.floor(n / max));
  const out: Rgb[] = [];
  for (let p = 0; p < n; p += stride) {
    const i = p * 4;
    if (img.data[i + 3] >= 128) out.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
  }
  return out;
}

function borderPixels(img: RgbaImage): number[] {
  const idx: number[] = [];
  const { w, h } = img;
  const step = Math.max(1, Math.floor((w + h) / 400));
  for (let x = 0; x < w; x += step) idx.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y += step) idx.push(y * w, y * w + w - 1);
  return idx;
}

export function analyzeImage(img: RgbaImage): ImageStats {
  const n = img.w * img.h;
  const stride = Math.max(1, Math.floor(n / 250_000));
  let counted = 0, transparent = 0, sat = 0, light = 0, dark = 0;
  const hist = new Float64Array(256);
  for (let p = 0; p < n; p += stride) {
    const i = p * 4;
    counted++;
    if (img.data[i + 3] < 128) { transparent++; continue; }
    const [r, g, b] = over(img.data, i);
    const l = lum(r, g, b);
    hist[Math.round(l)]++;
    sat += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    if (l > 225) light++;
    if (l < 60) dark++;
  }
  const opaque = Math.max(1, counted - transparent);

  // Cores efetivas: quantiza em 16 e junta os centros parecidos.
  const samples = sampleOpaque(img, 12_000);
  const centers = kmeans(samples, 16, 8);
  const share = centers.map(() => 0);
  let near = 0;
  for (const s of samples) {
    let best = 0, bd = Infinity;
    centers.forEach((c, i) => {
      const d = d2(s, c);
      if (d < bd) { bd = d; best = i; }
    });
    share[best]++;
    if (bd < 28 * 28) near++;
  }
  const merged: { c: Rgb; n: number }[] = [];
  centers
    .map((c, i) => ({ c, n: share[i] }))
    .sort((a, b) => b.n - a.n)
    .forEach((e) => {
      const hit = merged.find((m) => d2(m.c, e.c) < 45 * 45);
      if (hit) hit.n += e.n;
      else merged.push({ ...e });
    });
  const effectiveColors = merged.filter((m) => m.n / Math.max(1, samples.length) >= 0.01).length;

  // Fundo: a borda é dominada por uma cor clara?
  let plainBackground = false;
  if (transparent / counted < 0.02) {
    const border = borderPixels(img).map((p) => over(img.data, p * 4) as Rgb);
    const ref = medianColor(border);
    const same = border.filter((c) => d2(c, ref) < 30 * 30).length;
    plainBackground = same / Math.max(1, border.length) > 0.7 && lum(...ref) > 170;
  }

  return {
    transparent: transparent / counted,
    colorfulness: sat / opaque,
    light: light / opaque,
    dark: dark / opaque,
    effectiveColors: Math.max(1, effectiveColors),
    flatness: samples.length ? near / samples.length : 1,
    otsu: otsuThreshold(hist),
    plainBackground,
  };
}

function medianColor(colors: Rgb[]): Rgb {
  if (!colors.length) return [255, 255, 255];
  const med = (k: 0 | 1 | 2): number => {
    const v = colors.map((c) => c[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  return [med(0), med(1), med(2)];
}

export function presetParams(preset: PresetId, stats: ImageStats | null): VectorizeParams {
  const colors = stats ? stats.effectiveColors : 6;
  // Com transparência o fundo já é o alfa: "remover a cor da borda" apagaria a
  // própria arte quando ela encosta na borda (recorte rente ao desenho).
  const bg = stats ? stats.plainBackground && stats.transparent < 0.01 : true;
  switch (preset) {
    case 'logo':
      return { ...DEFAULT_PARAMS, mode: 'cores', colors: clamp(colors, 2, 8), detail: 75, smoothing: 1, blur: 0, removeBackground: bg };
    case 'clipart':
      return { ...DEFAULT_PARAMS, mode: 'cores', colors: clamp(colors + 2, 4, 12), detail: 60, smoothing: 1.2, blur: 1, removeBackground: bg };
    case 'foto':
      return { ...DEFAULT_PARAMS, mode: 'cores', colors: 8, detail: 35, smoothing: 2, blur: 2, keepCorners: false, removeBackground: false };
    case 'traco':
      return { ...DEFAULT_PARAMS, mode: 'traco', detail: 70, smoothing: 1, invert: stats ? stats.dark > 0.6 : false };
    case 'silhueta':
      return { ...DEFAULT_PARAMS, mode: 'silhueta', detail: 50, smoothing: 1.5, keepHoles: false };
    case 'centro':
      return { ...DEFAULT_PARAMS, mode: 'centro', detail: 60, smoothing: 1, invert: stats ? stats.dark > 0.6 : false };
  }
}

/** Mede a imagem e escolhe a leitura: é o que evita o usuário ter de entender
 * cada controle antes do primeiro resultado. */
export function suggestPreset(stats: ImageStats): Suggestion {
  const make = (preset: PresetId, reason: string): Suggestion => ({ preset, reason, params: presetParams(preset, stats) });
  const bw = stats.light + stats.dark;
  if (stats.colorfulness < 0.08 && bw > 0.8 && stats.dark < 0.55) {
    return make('traco', 'Quase só preto e branco — parece desenho a traço, letra ou logo P&B.');
  }
  if (stats.effectiveColors <= 6 && stats.flatness > 0.85) {
    return make('logo', `Poucas cores chapadas (${stats.effectiveColors}) — parece logo ou ícone.`);
  }
  if (stats.flatness > 0.7) {
    return make('clipart', `Cores chapadas com algum degradê (${stats.effectiveColors} cores principais) — tratado como clipart.`);
  }
  return make('foto', 'Muitas cores e tons contínuos — parece foto; sai em camadas posterizadas.');
}

// ---------- vetorização ----------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Área mínima em px² pra uma mancha sobreviver, pelo controle de detalhe. */
export function minAreaFor(detail: number, w: number, h: number): number {
  return Math.max(4, w * h * 10 ** (-2.7 - clamp(detail, 0, 100) * 0.025));
}

function boxBlurRgb(img: RgbaImage, radius: number): RgbaImage {
  const r = Math.round(radius);
  if (r <= 0) return img;
  const { w, h } = img;
  const src = img.data;
  const tmp = new Float32Array(w * h * 3);
  const out = new Uint8ClampedArray(src);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[(y * w + clamp(k, 0, w - 1)) * 4 + c];
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 3 + c] = acc / win;
        acc += src[(y * w + clamp(x + r + 1, 0, w - 1)) * 4 + c] - src[(y * w + clamp(x - r, 0, w - 1)) * 4 + c];
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[(clamp(k, 0, h - 1) * w + x) * 3 + c];
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 4 + c] = acc / win;
        acc += tmp[(clamp(y + r + 1, 0, h - 1) * w + x) * 3 + c] - tmp[(clamp(y - r, 0, h - 1) * w + x) * 3 + c];
      }
    }
  }
  return { data: out, w, h };
}

/** Máscara binária (0/1) vira máscara suave (0–255) com um 3×3: a rampa na
 * borda dá ao marching squares o que interpolar, e a escada do pixel some. */
function soften(bin: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) s += bin[yy * w + xx];
        }
      }
      out[y * w + x] = Math.round((s / 9) * 255);
    }
  }
  return out;
}

function traceToPaths(mask: Uint8Array, w: number, h: number, p: VectorizeParams, fillHoles: boolean): VPath[] {
  const corner = p.keepCorners ? CORNER_ANGLE : 0;
  const polys = traceMask({ data: mask, w, h }, {
    fillHoles,
    smoothSigma: Math.max(0, p.smoothing),
    cornerAngle: corner,
    minArea: minAreaFor(p.detail, w, h),
  });
  return polys.map((poly) => closedCurve(poly, corner));
}

function closedCurve(poly: Polygon, cornerAngle: number): VPath {
  const c = polygonToCubics(poly, { tolerance: 0.35, cornerAngle });
  return { start: c.start, segments: c.segments, closed: true };
}

export function vectorize(img: RgbaImage, params: VectorizeParams): VectorizeResult {
  const { w, h } = img;
  switch (params.mode) {
    case 'cores': return { w, h, layers: vectorizeColors(img, params) };
    case 'traco': return { w, h, layers: vectorizeLineArt(img, params) };
    case 'silhueta': return { w, h, layers: vectorizeSilhouette(img, params) };
    case 'centro': return { w, h, layers: vectorizeCenterline(img, params) };
  }
}

/** Filtro de moda 3×3: cada pixel fica com o rótulo mais comum em volta. Tira
 * o pontilhado que a quantização deixa em degradê e textura. */
function modeFilter(labels: Int16Array, w: number, h: number, k: number): Int16Array {
  const out = new Int16Array(labels);
  const count = new Int32Array(k);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (labels[i] < 0) continue;
      count.fill(0);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const l = labels[i + dy * w + dx];
          if (l >= 0) count[l]++;
        }
      }
      let best = labels[i];
      for (let c = 0; c < k; c++) if (count[c] > count[best]) best = c;
      if (count[best] >= 5) out[i] = best;
    }
  }
  return out;
}

function vectorizeColors(source: RgbaImage, p: VectorizeParams): VectorLayerOut[] {
  const img = boxBlurRgb(source, p.blur);
  const { w, h } = img;
  const k = clamp(Math.round(p.colors), 2, 16);
  const centers = mergeClose(kmeans(sampleOpaque(img, 30_000), k), 14);
  if (!centers.length) return [];
  let transparent = 0;
  for (let i = 3; i < source.data.length; i += 4) if (source.data[i] < 128) transparent++;
  let labels: Int16Array = new Int16Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) {
    if (source.data[i * 4 + 3] < 128) continue;
    const c: Rgb = [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]];
    let best = 0, bd = Infinity;
    for (let j = 0; j < centers.length; j++) {
      const d = d2(c, centers[j]);
      if (d < bd) { bd = d; best = j; }
    }
    labels[i] = best;
  }
  if (p.blur > 0 || p.detail < 50) labels = modeFilter(labels, w, h, centers.length);

  const count = new Int32Array(centers.length);
  for (const l of labels) if (l >= 0) count[l]++;

  let background = -1;
  if (p.removeBackground && transparent / (w * h) < 0.01) {
    const border = new Int32Array(centers.length);
    let borderTotal = 0;
    for (const i of borderPixels(img)) {
      if (labels[i] >= 0) { border[labels[i]]++; borderTotal++; }
    }
    const top = border.indexOf(Math.max(...border));
    if (borderTotal && border[top] / borderTotal > 0.5) background = top;
  }

  // Da maior pra menor área: as grandes ficam atrás e as pequenas por cima.
  const order = centers.map((_, i) => i).filter((i) => i !== background && count[i] > 0).sort((a, b) => count[b] - count[a]);
  const rank = new Int16Array(centers.length).fill(-1);
  order.forEach((c, r) => (rank[c] = r));

  const layers: VectorLayerOut[] = [];
  const bin = new Uint8Array(w * h);
  order.forEach((c, r) => {
    // Empilhado: a camada cobre a própria cor e todas as que vêm por cima.
    for (let i = 0; i < w * h; i++) bin[i] = labels[i] >= 0 && rank[labels[i]] >= r ? 1 : 0;
    const paths = traceToPaths(soften(bin, w, h), w, h, p, false);
    if (paths.length) {
      const [cr, cg, cb] = centers[c];
      layers.push({ name: `Cor ${layers.length + 1}`, color: rgbToHex(cr, cg, cb), paths, stroke: false, strokeWidthPx: 0 });
    }
  });
  return layers;
}

/** Tinta do traço: pixel escuro (ou claro, invertido), composto sobre branco. */
function inkMask(img: RgbaImage, p: VectorizeParams): { soft: Uint8Array; bin: Uint8Array; color: string } {
  const { w, h, data } = img;
  const hist = new Float64Array(256);
  const lumArr = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = over(data, i * 4);
    lumArr[i] = lum(r, g, b);
    hist[Math.round(lumArr[i])]++;
  }
  const t = p.threshold >= 0 ? p.threshold : otsuThreshold(hist);
  const soft = new Uint8Array(w * h);
  const bin = new Uint8Array(w * h);
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    const d = p.invert ? lumArr[i] - t : t - lumArr[i];
    soft[i] = clamp(Math.round(128 + d * 8), 0, 255);
    if (d > 0) {
      bin[i] = 1;
      sr += data[i * 4]; sg += data[i * 4 + 1]; sb += data[i * 4 + 2]; n++;
    }
  }
  return { soft, bin, color: n ? rgbToHex(sr / n, sg / n, sb / n) : '#1a1a1a' };
}

function vectorizeLineArt(img: RgbaImage, p: VectorizeParams): VectorLayerOut[] {
  const { soft, color } = inkMask(img, p);
  const paths = traceToPaths(soft, img.w, img.h, p, false);
  return paths.length ? [{ name: 'Traço', color, paths, stroke: false, strokeWidthPx: 0 }] : [];
}

function vectorizeSilhouette(img: RgbaImage, p: VectorizeParams): VectorLayerOut[] {
  const { w, h, data } = img;
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) transparent++;
  const mask = new Uint8Array(w * h);
  if (transparent / (w * h) > 0.01) {
    for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3];
  } else {
    const bg = medianColor(borderPixels(img).map((i) => over(data, i * 4) as Rgb));
    const tol = p.threshold >= 0 ? p.threshold : 48;
    for (let i = 0; i < w * h; i++) {
      const d = Math.sqrt(d2(over(data, i * 4) as Rgb, bg));
      mask[i] = clamp(Math.round(128 + (d - tol) * 6), 0, 255);
    }
  }
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    if (mask[i] < 128) continue;
    sr += data[i * 4]; sg += data[i * 4 + 1]; sb += data[i * 4 + 2]; n++;
  }
  const paths = traceToPaths(mask, w, h, p, !p.keepHoles);
  const color = n ? rgbToHex(sr / n, sg / n, sb / n) : '#222222';
  return paths.length ? [{ name: 'Silhueta', color, paths, stroke: false, strokeWidthPx: 0 }] : [];
}

// ---------- linha central ----------

/** Afinamento de Zhang-Suen: descasca a máscara até sobrar o esqueleto de
 * 1 px, sem partir o traço. */
export function thin(bin: Uint8Array, w: number, h: number): Uint8Array {
  const img = new Uint8Array(bin);
  const at = (x: number, y: number): number => (x >= 0 && y >= 0 && x < w && y < h ? img[y * w + x] : 0);
  const remove: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      remove.length = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!img[y * w + x]) continue;
          const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1);
          const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let a = 0;
          for (let i = 0; i < 8; i++) if (!seq[i] && seq[i + 1]) a++;
          if (a !== 1) continue;
          if (step === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
          remove.push(y * w + x);
        }
      }
      for (const i of remove) img[i] = 0;
      if (remove.length) changed = true;
    }
  }
  return img;
}

/** Distância (chanfro 3-4, em px) de cada pixel de tinta até o fundo. */
function distanceTransform(bin: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = bin[i] ? INF : 0;
  const get = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], get(x - 1, y) + 3, get(x, y - 1) + 3, get(x - 1, y - 1) + 4, get(x + 1, y - 1) + 4);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], get(x + 1, y) + 3, get(x, y + 1) + 3, get(x + 1, y + 1) + 4, get(x - 1, y + 1) + 4);
    }
  }
  for (let i = 0; i < w * h; i++) d[i] /= 3;
  return d;
}

const N8: Point[] = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];
const RING: Point[] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

/** Segue o esqueleto e devolve as polilinhas. Ponta e junção são reconhecidas
 * pelo número de transições em volta do pixel (não pela contagem de vizinhos,
 * que a escada diagonal do esqueleto engana). */
export function traceSkeleton(skel: Uint8Array, w: number, h: number): { lines: Point[][]; loops: Point[][] } {
  const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && skel[y * w + x] === 1;
  const transitions = (x: number, y: number): number => {
    let t = 0;
    for (let i = 0; i < 8; i++) {
      const [ax, ay] = RING[i];
      const [bx, by] = RING[(i + 1) % 8];
      if (!on(x + ax, y + ay) && on(x + bx, y + by)) t++;
    }
    return t;
  };
  const isNode = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      const t = transitions(x, y);
      if (t !== 2) isNode[y * w + x] = 1;
    }
  }
  const visited = new Uint8Array(w * h);
  const lines: Point[][] = [];

  const walk = (sx: number, sy: number, fx: number, fy: number): Point[] => {
    const line: Point[] = [[sx, sy], [fx, fy]];
    let px = sx, py = sy, cx = fx, cy = fy;
    visited[cy * w + cx] = 1;
    while (!isNode[cy * w + cx]) {
      let next: Point | null = null;
      for (const [dx, dy] of N8) {
        const nx = cx + dx, ny = cy + dy;
        if ((nx === px && ny === py) || !on(nx, ny)) continue;
        const ni = ny * w + nx;
        if (isNode[ni] && !(nx === sx && ny === sy && line.length < 3)) { next = [nx, ny]; break; }
        if (!visited[ni]) { next = [nx, ny]; break; }
      }
      if (!next) break;
      px = cx; py = cy;
      [cx, cy] = next;
      line.push([cx, cy]);
      if (isNode[cy * w + cx]) break;
      visited[cy * w + cx] = 1;
    }
    return line;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y) || !isNode[y * w + x]) continue;
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy;
        if (!on(nx, ny) || visited[ny * w + nx] || isNode[ny * w + nx]) continue;
        lines.push(walk(x, y, nx, ny));
      }
    }
  }

  // O que sobrou sem ponta nem junção são laços fechados (um "O").
  const loops: Point[][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y) || visited[y * w + x] || isNode[y * w + x]) continue;
      visited[y * w + x] = 1;
      const loop: Point[] = [[x, y]];
      let cx = x, cy = y;
      for (;;) {
        let next: Point | null = null;
        for (const [dx, dy] of N8) {
          const nx = cx + dx, ny = cy + dy;
          if (on(nx, ny) && !visited[ny * w + nx]) { next = [nx, ny]; break; }
        }
        if (!next) break;
        [cx, cy] = next;
        visited[cy * w + cx] = 1;
        loop.push([cx, cy]);
      }
      if (loop.length >= 8) loops.push(loop);
    }
  }
  return { lines, loops };
}

function smoothPolyline(pts: Point[], closed: boolean, passes = 2): Point[] {
  let cur = pts;
  for (let k = 0; k < passes; k++) {
    const n = cur.length;
    if (n < 3) return cur;
    cur = cur.map((p, i) => {
      if (!closed && (i === 0 || i === n - 1)) return p;
      const a = cur[(i - 1 + n) % n], b = cur[(i + 1) % n];
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4] as Point;
    });
  }
  return cur;
}

function rdpOpen(points: Point[], eps: number): Point[] {
  if (points.length < 3) return points;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const len = Math.hypot(bx - ax, by - ay);
  let idx = -1, maxD = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const d = len ? Math.abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) / len : Math.hypot(px - ax, py - ay);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [points[0], points[points.length - 1]];
  return [...rdpOpen(points.slice(0, idx + 1), eps).slice(0, -1), ...rdpOpen(points.slice(idx), eps)];
}

/** Catmull-Rom → Bézier: a curva passa por todos os pontos, sem bico. */
export function catmullRom(points: Point[], closed: boolean): VPath {
  const n = points.length;
  const at = (i: number): Point => (closed ? points[((i % n) + n) % n] : points[clamp(i, 0, n - 1)]);
  const segments = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    segments.push({
      c1: [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6] as Point,
      c2: [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6] as Point,
      to: p2,
    });
  }
  return { start: points[0], segments, closed };
}

function vectorizeCenterline(img: RgbaImage, p: VectorizeParams): VectorLayerOut[] {
  const { w, h } = img;
  const { bin, color } = inkMask(img, p);
  const skel = thin(bin, w, h);
  const dt = distanceTransform(bin, w, h);
  let sum = 0, n = 0;
  for (let i = 0; i < w * h; i++) if (skel[i]) { sum += dt[i]; n++; }
  const halfWidth = n ? sum / n : 1;
  const { lines, loops } = traceSkeleton(skel, w, h);
  // Esporão: galho curto que o afinamento deixa na quina de um traço grosso.
  const minLen = Math.max(3, halfWidth * 2, Math.sqrt(minAreaFor(p.detail, w, h)));
  const eps = 0.6 + p.smoothing * 0.3;
  const paths: VPath[] = [];
  for (const line of lines) {
    if (pathLength(line) < minLen) continue;
    const simple = rdpOpen(smoothPolyline(line, false), eps);
    if (simple.length >= 2) paths.push(catmullRom(simple, false));
  }
  for (const loop of loops) {
    const smooth = smoothPolyline(loop, true);
    if (Math.abs(polygonArea(smooth)) < minLen * minLen) continue;
    const simple = rdpOpen([...smooth, smooth[0]], eps).slice(0, -1);
    if (simple.length >= 3) paths.push(catmullRom(simple, true));
  }
  return paths.length ? [{ name: 'Linha central', color, paths, stroke: true, strokeWidthPx: Math.max(1, halfWidth * 2) }] : [];
}

function pathLength(pts: Point[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}
