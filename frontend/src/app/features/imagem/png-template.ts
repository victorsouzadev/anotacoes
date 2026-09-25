/** Molde a partir de um PNG com áreas transparentes (moldura, porta-retrato,
 * cartão com janela): cada região transparente *fechada* vira um encaixe, e o
 * PNG fica por cima como a moldura. Região transparente que encosta na borda é
 * o fundo da imagem, não janela, e fica de fora. */

import { traceCutPaths } from './contour';
import { pathsToD, polygonToVPath } from './illustration-model';
import { TemplateError } from './svg-template';
import { offsetOutline } from './vector-ops';

/** Lado maior usado na detecção: mais que isso só gasta tempo. */
const DETECT_SIDE = 1200;
/** Lado maior da imagem embutida no molde (vai pro projeto salvo). */
const MAX_EMBED_SIDE = 2400;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new TemplateError('Não consegui abrir esse PNG.'));
    img.src = src;
  });
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new TemplateError('Falha ao ler o arquivo.'));
    r.readAsDataURL(file);
  });
}

/** Rótulos das regiões transparentes (4-vizinhança); marca as que tocam a borda. */
export function transparentRegions(alpha: Uint8ClampedArray | Uint8Array, w: number, h: number, threshold = 128): { labels: Int32Array; sizes: number[]; border: boolean[] } {
  const labels = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const border: boolean[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (labels[start] !== -1 || alpha[start] >= threshold) continue;
    const id = sizes.length;
    let size = 0, touches = false;
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w, y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j >= 0 && labels[j] === -1 && alpha[j] < threshold) {
          labels[j] = id;
          stack.push(j);
        }
      }
    }
    sizes.push(size);
    border.push(touches);
  }
  return { labels, sizes, border };
}

export async function pngToTemplate(file: File): Promise<{ svg: string; holes: number }> {
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) throw new TemplateError('O PNG está vazio.');

  // detecção numa cópia reduzida
  const k = Math.min(1, DETECT_SIDE / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = rgba[i * 4 + 3];
  const { labels, sizes, border } = transparentRegions(alpha, w, h);

  const minArea = w * h * 0.005;
  const holes = sizes.map((size, id) => ({ id, size })).filter((r) => !border[r.id] && r.size >= minArea);
  if (!holes.length) {
    throw new TemplateError('Não achei nenhuma janela transparente fechada nesse PNG — a foto precisa de um buraco cercado pela moldura.');
  }
  // de cima pra baixo, da esquerda pra direita, pra numeração fazer sentido
  const firstPixel = (id: number): number => labels.indexOf(id);
  holes.sort((a, b) => firstPixel(a.id) - firstPixel(b.id));

  // folga pra foto passar por baixo da borda serrilhada da moldura
  const grow = Math.max(2, Math.min(W, H) * 0.004);
  const paths: string[] = [];
  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = h;
  const mctx = mask.getContext('2d')!;
  holes.forEach((hole, n) => {
    const data = mctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) if (labels[i] === hole.id) data.data[i * 4 + 3] = 255;
    mctx.putImageData(data, 0, 0);
    const polys = traceCutPaths(mask, { smoothSigma: 1, simplifyEpsilon: 0.6, fillHoles: true, minArea: minArea / 4 })
      .map((poly) => poly.map(([x, y]) => [x / k, y / k] as [number, number]));
    const vpaths = offsetOutline([{ paths: polys.map(polygonToVPath), pad: 0, strokeOnly: false }], grow, { outerOnly: true });
    const d = pathsToD(vpaths, 2);
    if (d) paths.push(`  <path id="foto-${n + 1}" d="${d}" fill="none" />`);
  });

  // imagem embutida: a original, ou reduzida se for grande demais pro projeto
  let href = original;
  if (Math.max(W, H) > MAX_EMBED_SIDE) {
    const s = MAX_EMBED_SIDE / Math.max(W, H);
    const e = document.createElement('canvas');
    e.width = Math.round(W * s);
    e.height = Math.round(H * s);
    e.getContext('2d')!.drawImage(img, 0, 0, e.width, e.height);
    href = e.toDataURL('image/png');
  }
  // tamanho de impressão pensando em 300 DPI, dentro de uma faixa razoável
  const widthMm = Math.round(Math.min(400, Math.max(50, (W / 300) * 25.4)));
  const heightMm = Math.round((widthMm * H) / W * 100) / 100;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${W} ${H}">\n` +
    `${paths.join('\n')}\n` +
    `  <image href="${href}" x="0" y="0" width="${W}" height="${H}" />\n` +
    `</svg>\n`;
  return { svg, holes: paths.length };
}
