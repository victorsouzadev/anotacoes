/** Saídas do modo Ilustração. O SVG sai com as coordenadas já na prancheta
 * (sem transform nos caminhos) e em mm — é o que abre igual no Inkscape, no
 * Illustrator, no CanvasWorkspace da ScanNCut e no Silhouette Studio
 * Designer; o Studio Basic abre o DXF de corte. */

import { FontLibrary, nearestWeight } from './fonts';
import { IllustrationStore } from './illustration-store';
import { DxfPolyline, buildDxf, pageFrame } from './dxf';
import { Bounds, Layer, TextLayer, VPath, fillRuleOf, flattenPath, growBounds, layerMatrix, matrixAttr, pathsToD, round } from './illustration-model';
import { clipDef, clipId, effectsPad, fillRef, paintDef, underlays } from './illustration-paint';
import { booleanPaths } from './vector-ops';

export interface SvgOptions {
  /** Só as linhas de corte (camadas marcadas, ou todo vetor se nenhuma for). */
  cutOnly?: boolean;
  /** Texto reto sai como <text> editável, com a fonte embutida. */
  textAsText?: boolean;
  /** Deixa as camadas de corte de fora (a arte que vai pra impressão). */
  skipCut?: boolean;
  /** Recorta a prancheta à caixa do conteúdo. */
  bounds?: Bounds | null;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function n(v: number): string {
  return String(round(v, 3));
}

const IDS = 'ile-';

function paintAttrs(l: Layer): string {
  const fill = `fill="${fillRef(IDS, l)}"`;
  const stroke = l.stroke && l.strokeWidth > 0 && !l.mask
    ? ` stroke="${l.stroke}" stroke-width="${n(l.strokeWidth)}" stroke-linejoin="round" stroke-linecap="round"`
    : '';
  const opacity = l.opacity < 1 ? ` opacity="${n(l.opacity)}"` : '';
  return `${fill}${stroke}${opacity}`;
}

async function fontFaceCss(fonts: FontLibrary, texts: TextLayer[]): Promise<string> {
  const faces: string[] = [];
  const done = new Set<string>();
  for (const t of texts) {
    const fam = fonts.family(t.fontId);
    const weight = nearestWeight(fam.weights, t.weight);
    const key = `${fam.id}@${weight}`;
    if (done.has(key)) continue;
    done.add(key);
    let src: string | null = null;
    if (fonts.isUpload(fam.id)) {
      src = fonts.uploads().find((u) => fonts.uploadFontId(u.id) === fam.id)?.dataUrl ?? null;
    } else {
      try {
        const res = await fetch(new URL(`fonts/${fam.id}-${weight}.woff`, document.baseURI).href);
        const blob = await res.blob();
        src = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve((r.result as string).replace(/^data:[^;]*/, 'data:font/woff'));
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
      } catch { /* sem a fonte embutida, vale a instalada no computador */ }
    }
    if (src) faces.push(`@font-face{font-family:"${esc(fam.name)}";font-weight:${weight};src:url(${src});}`);
  }
  return faces.length ? `<style>${faces.join('')}</style>\n` : '';
}

/** Texto reto como <text>: mesma caixa de métricas da diagramação, então cai
 * no mesmo lugar do contorno. */
function textElement(store: IllustrationStore, t: TextLayer): string | null {
  const font = store.fonts.get(t.fontId, t.weight);
  if (!font || t.curve !== 'reta') return null;
  const fam = store.fonts.family(t.fontId);
  const lines = t.text.split('\n');
  const layout = store.textLayout(t);
  if (!layout) return null;
  const scale = t.sizeMm / font.unitsPerEm;
  const lh = t.lineHeight * t.sizeMm;
  // Mesma conta do layoutText: centro da caixa de métricas.
  const widths = lines.map((line) => {
    const glyphs = line ? font.stringToGlyphs(line) : [];
    let pen = 0;
    glyphs.forEach((g, i) => {
      pen += (g.advanceWidth ?? 0) * scale + (t.tracking / 1000) * t.sizeMm;
      if (glyphs[i + 1]) pen += font.getKerningValue(g, glyphs[i + 1]) * scale;
    });
    return glyphs.length ? pen - (t.tracking / 1000) * t.sizeMm : 0;
  });
  let box: Bounds | null = null;
  widths.forEach((w, i) => {
    const x0 = t.align === 'center' ? -w / 2 : t.align === 'right' ? -w : 0;
    box = growBounds(box, [x0, i * lh - font.ascender * scale]);
    box = growBounds(box, [x0 + w, i * lh - font.descender * scale]);
  });
  if (!box) return null;
  const b = box as Bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const anchor = t.align === 'center' ? 'middle' : t.align === 'right' ? 'end' : 'start';
  const spans = lines
    .map((line, i) => `<tspan x="${n(-cx)}" y="${n(i * lh - cy)}">${esc(line) || ' '}</tspan>`)
    .join('');
  const spacing = t.tracking ? ` letter-spacing="${n((t.tracking / 1000) * t.sizeMm)}"` : '';
  const stroke = t.stroke && t.strokeWidth > 0
    ? ` stroke="${t.stroke}" stroke-width="${n(t.strokeWidth / (Math.sqrt(Math.abs(t.scaleX * t.scaleY)) || 1))}"`
    : '';
  return `  <text transform="${matrixAttr(layerMatrix(t))}" font-family="${esc(fam.name)}" font-weight="${nearestWeight(fam.weights, t.weight)}" ` +
    `font-size="${n(t.sizeMm)}" text-anchor="${anchor}"${spacing} fill="${t.fill ?? 'none'}"${stroke}` +
    `${t.opacity < 1 ? ` opacity="${n(t.opacity)}"` : ''} xml:space="preserve">${spans}</text>\n`;
}

export async function buildSvg(store: IllustrationStore, options: SvgOptions = {}): Promise<string> {
  const layers = store.layers().filter((l) => l.visible);
  // Garante as fontes antes de ler contorno de texto.
  await Promise.all(layers.filter((l): l is TextLayer => l.kind === 'texto').map((t) => store.fonts.load(t.fontId, t.weight)));

  const b = options.bounds ?? { minX: 0, minY: 0, maxX: store.widthMm(), maxY: store.heightMm() };
  const W = b.maxX - b.minX;
  const H = b.maxY - b.minY;
  let body = '';
  let fontCss = '';

  const masks = new Map(layers.filter((l) => l.mask).map((l) => [l.id, l]));
  let defs = '';

  if (options.cutOnly) {
    for (const paths of cutPaths(store)) {
      const d = pathsToD(paths);
      if (d) body += `  <path d="${d}" fill="none" stroke="#ff0000" stroke-width="0.2" />\n`;
    }
    for (const l of penLayers(store)) {
      const d = pathsToD(store.worldPaths(l));
      if (d) body += `  <path id="caneta-${l.id.slice(0, 4)}" d="${d}" fill="none" stroke="#00a000" stroke-width="0.2" />\n`;
    }
  } else {
    const texts: TextLayer[] = [];
    for (const m of masks.values()) defs += clipDef(IDS, m.id, pathsToD(store.worldPaths(m)), fillRuleOf(m));
    for (const l of layers) {
      if (options.skipCut && (l.cut || l.pen)) continue;
      if (l.mask) continue;
      const clip = l.clipBy && masks.has(l.clipBy) ? ` clip-path="url(#${clipId(IDS, l.clipBy)})"` : '';
      if (clip) body += `  <g${clip}>\n`;
      if (l.kind === 'imagem') {
        body += `  <image href="${l.src}" x="${n(-l.w / 2)}" y="${n(-l.h / 2)}" width="${n(l.w)}" height="${n(l.h)}" ` +
          `preserveAspectRatio="none" transform="${matrixAttr(layerMatrix(l))}"${l.opacity < 1 ? ` opacity="${n(l.opacity)}"` : ''} />\n`;
        if (clip) body += `  </g>\n`;
        continue;
      }
      defs += paintDef(IDS, l, layerMatrix(l));
      const d = pathsToD(store.worldPaths(l));
      for (const u of underlays(l)) {
        if (!d) break;
        const shift = u.dx || u.dy ? ` transform="translate(${n(u.dx)} ${n(u.dy)})"` : '';
        const op = u.opacity * l.opacity;
        body += `  <path d="${d}" fill-rule="${fillRuleOf(l)}" fill="${u.color}"` +
          (u.widthMm > 0 ? ` stroke="${u.color}" stroke-width="${n(u.widthMm)}" stroke-linejoin="round" stroke-linecap="round"` : '') +
          `${op < 1 ? ` opacity="${n(op)}"` : ''}${shift} />\n`;
      }
      if (l.kind === 'texto' && options.textAsText && !l.paint) {
        const el = textElement(store, l);
        if (el) {
          body += el;
          texts.push(l);
          if (clip) body += `  </g>\n`;
          continue;
        }
      }
      if (d) body += `  <path id="${esc(l.name.replace(/[^\w-]+/g, '-'))}-${l.id.slice(0, 4)}" d="${d}" fill-rule="${fillRuleOf(l)}" ${paintAttrs(l)} />\n`;
      if (clip) body += `  </g>\n`;
    }
    if (texts.length) fontCss = await fontFaceCss(store.fonts, texts);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(W)}mm" height="${n(H)}mm" viewBox="${n(b.minX)} ${n(b.minY)} ${n(W)} ${n(H)}">\n` +
    fontCss + (defs ? `<defs>${defs}</defs>\n` : '') + body + `</svg>\n`;
}

/** As linhas que a lâmina corta, na prancheta: as camadas marcadas como
 * corte, ou todo vetor se nenhuma for. Recortada por máscara, só a parte que
 * aparece. */
export function cutPaths(store: IllustrationStore): VPath[][] {
  const layers = store.layers().filter((l) => l.visible);
  const masks = new Map(layers.filter((l) => l.mask).map((l) => [l.id, l]));
  const flagged = layers.filter((l) => l.cut && l.kind !== 'imagem' && !l.mask && !l.pen);
  const cut = flagged.length ? flagged : layers.filter((l) => l.kind !== 'imagem' && !l.mask && !l.pen);
  return cut.map((l) => {
    const mask = l.clipBy ? masks.get(l.clipBy) : undefined;
    return mask
      ? booleanPaths('intersecao', [
        { paths: store.worldPaths(l), pad: l.stroke && l.strokeWidth > 0 ? l.strokeWidth / 2 : 0, strokeOnly: !l.fill && !l.paint },
        { paths: store.worldPaths(mask), pad: 0, strokeOnly: false },
      ])
      : store.worldPaths(l);
  });
}

/** Camadas desenhadas pela caneta da máquina (Sketch). */
export function penLayers(store: IllustrationStore): Layer[] {
  return store.layers().filter((l) => l.visible && l.pen && l.kind !== 'imagem');
}

/** DXF das linhas de corte de uma prancheta (pro Silhouette Studio Basic). */
export function cutDxf(store: IllustrationStore, b: Bounds): string {
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  const lines: DxfPolyline[] = [pageFrame(w, h)];
  for (const paths of cutPaths(store)) {
    for (const p of paths) {
      const pts = flattenPath(p, 0.1).map(([x, y]) => [x - b.minX, y - b.minY] as [number, number]);
      lines.push({ layer: 'CORTE', closed: p.closed, points: pts });
    }
  }
  // Caneta numa camada própria (verde): no Studio, "Linha" por cor dá a ela a
  // ferramenta Sketch e ao vermelho a lâmina.
  for (const l of penLayers(store)) {
    for (const p of store.worldPaths(l)) {
      const pts = flattenPath(p, 0.1).map(([x, y]) => [x - b.minX, y - b.minY] as [number, number]);
      lines.push({ layer: 'CANETA', closed: p.closed, points: pts });
    }
  }
  return buildDxf(lines, [{ name: 'CORTE', color: 1 }, { name: 'CANETA', color: 3 }, { name: 'PAGINA', color: 8 }], h);
}

/** Caixa do que vai ser impresso (sem as linhas de corte). */
export function contentBounds(store: IllustrationStore, skipCut: boolean): Bounds | null {
  let b: Bounds | null = null;
  const layers = store.layers();
  for (const l of layers) {
    if (!l.visible || (skipCut && (l.cut || l.pen)) || l.mask) continue;
    let lb = store.worldBounds(l);
    const pad = Math.max(l.stroke && l.kind !== 'imagem' ? l.strokeWidth / 2 : 0, effectsPad(l));
    const mask = l.clipBy ? layers.find((m) => m.id === l.clipBy && m.mask) : undefined;
    if (mask) {
      // o que passa da máscara não aparece, então não conta na caixa
      const mb = store.worldBounds(mask);
      lb = { minX: Math.max(lb.minX - pad, mb.minX), minY: Math.max(lb.minY - pad, mb.minY), maxX: Math.min(lb.maxX + pad, mb.maxX), maxY: Math.min(lb.maxY + pad, mb.maxY) };
      if (lb.minX >= lb.maxX || lb.minY >= lb.maxY) continue;
      b = growBounds(growBounds(b, [lb.minX, lb.minY]), [lb.maxX, lb.maxY]);
      continue;
    }
    b = growBounds(growBounds(b, [lb.minX - pad, lb.minY - pad]), [lb.maxX + pad, lb.maxY + pad]);
  }
  return b;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Falha ao desenhar o SVG.'));
    img.src = src;
  });
}

/** Rasteriza o SVG no tamanho físico. Teto de pixels pra não estourar o
 * canvas em navegador modesto. */
export async function rasterizeSvg(svg: string, wMm: number, hMm: number, dpi: number, background: string | null, maxPixels = 60_000_000): Promise<HTMLCanvasElement> {
  let width = Math.max(1, Math.round((wMm / 25.4) * dpi));
  let height = Math.max(1, Math.round((hMm / 25.4) * dpi));
  const shrink = Math.sqrt(maxPixels / (width * height));
  if (shrink < 1) {
    width = Math.max(1, Math.round(width * shrink));
    height = Math.max(1, Math.round(height * shrink));
  }
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar a imagem.'))), type, quality);
  });
}
