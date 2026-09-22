/** Separação de uma arte em elementos independentes: uma folha com seis
 * adesivos iguais chega aqui como um PNG só e sai como seis artes, cada uma
 * com seu próprio recorte — e, no editor, com seus próprios ajustes de corte.
 *
 * O agrupamento é por vizinhança: pedaços que se tocam viram um elemento, e
 * pedaços separados por um vão menor que a folga (uma estrela solta na cabeça,
 * a ponta de um tentáculo cortada pelo anti-aliasing) entram no mesmo elemento.
 * O que decide é o vão em pixels, não o desenho — por isso a folga é parâmetro. */

import { AlphaMask } from './contour';

export interface SplitOptions {
  /** Alpha mínimo (0–255) pra um pixel contar como desenho. */
  alphaThreshold?: number;
  /** Vão máximo, em px, entre dois pedaços do MESMO elemento. */
  gapPx?: number;
  /** Área mínima, em px², pra um grupo virar elemento (descarta sujeira). */
  minAreaPx?: number;
  /** Folga, em px, deixada em volta do recorte. */
  padPx?: number;
}

export interface SplitElement {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Quantos pixels de desenho o elemento tem (área, não a caixa). */
  area: number;
  /** Rótulos dos componentes que formam o elemento, pra recortar só eles. */
  labels: number[];
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
  labels: number[];
}

/** Componentes conexos (8-vizinhos) da máscara, rotulados a partir de 1. */
function labelComponents(mask: AlphaMask, threshold: number): { labels: Int32Array; boxes: Box[] } {
  const { data, w, h } = mask;
  const labels = new Int32Array(w * h);
  const boxes: Box[] = [];
  const fila = new Int32Array(w * h);

  for (let i = 0; i < labels.length; i++) {
    if (labels[i] || data[i] < threshold) continue;
    const label = boxes.length + 1;
    let cabeca = 0;
    let cauda = 0;
    fila[cauda++] = i;
    labels[i] = label;
    const box: Box = { x0: i % w, y0: (i / w) | 0, x1: i % w, y1: (i / w) | 0, area: 0, labels: [label] };
    while (cabeca < cauda) {
      const p = fila[cabeca++];
      const x = p % w;
      const y = (p / w) | 0;
      box.area++;
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (labels[q] || data[q] < threshold) continue;
          labels[q] = label;
          fila[cauda++] = q;
        }
      }
    }
    boxes.push(box);
  }
  return { labels, boxes };
}

function overlaps(a: Box, b: Box, gap: number): boolean {
  return a.x0 - gap <= b.x1 && b.x0 - gap <= a.x1 && a.y0 - gap <= b.y1 && b.y0 - gap <= a.y1;
}

function merge(a: Box, b: Box): Box {
  return {
    x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
    area: a.area + b.area, labels: [...a.labels, ...b.labels],
  };
}

/** Junta componentes cujas caixas, afastadas pela folga, se encostam — e repete
 * até estabilizar, porque juntar dois pode encostar num terceiro. */
function groupBoxes(boxes: Box[], gap: number): Box[] {
  let grupos = boxes;
  for (let volta = 0; volta < boxes.length; volta++) {
    const proximos: Box[] = [];
    let juntou = false;
    for (const box of grupos) {
      const alvo = proximos.findIndex((g) => overlaps(g, box, gap));
      if (alvo >= 0) {
        proximos[alvo] = merge(proximos[alvo], box);
        juntou = true;
      } else {
        proximos.push(box);
      }
    }
    grupos = proximos;
    if (!juntou) break;
  }
  return grupos;
}

/** Elementos da máscara, em ordem de leitura (de cima pra baixo, da esquerda
 * pra direita), com a caixa já folgada e presa aos limites da imagem. */
export function findElements(mask: AlphaMask, options: SplitOptions = {}): SplitElement[] {
  const { alphaThreshold = 128, gapPx = 0, minAreaPx = 64, padPx = 0 } = options;
  const { boxes } = labelComponents(mask, alphaThreshold);
  const grupos = groupBoxes(boxes, gapPx).filter((g) => g.area >= minAreaPx);

  const elementos = grupos.map((g) => {
    const x0 = Math.max(0, Math.floor(g.x0 - padPx));
    const y0 = Math.max(0, Math.floor(g.y0 - padPx));
    const x1 = Math.min(mask.w - 1, Math.ceil(g.x1 + padPx));
    const y1 = Math.min(mask.h - 1, Math.ceil(g.y1 + padPx));
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area: g.area, labels: g.labels };
  });

  // Ordem de leitura: linhas são definidas pela altura do próprio elemento, pra
  // uma fileira levemente desalinhada não embaralhar a numeração.
  const alturaMedia = elementos.reduce((s, e) => s + e.h, 0) / (elementos.length || 1);
  return elementos.sort((a, b) => {
    const linha = Math.round((a.y - b.y) / Math.max(1, alturaMedia * 0.6));
    return linha !== 0 ? linha : a.x - b.x;
  });
}

/** Recorta cada elemento num canvas próprio, levando só os pixels dele: um
 * vizinho que caia dentro da caixa (braço de outro polvo) não vai junto. */
export function splitCanvasElements(
  source: HTMLCanvasElement, options: SplitOptions = {},
): HTMLCanvasElement[] {
  const { alphaThreshold = 128 } = options;
  const w = source.width;
  const h = source.height;
  const rgba = source.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];

  const mask: AlphaMask = { data: alpha, w, h };
  const { labels } = labelComponents(mask, alphaThreshold);
  const elementos = findElements(mask, options);

  return elementos.map((el) => {
    const doGrupo = new Set(el.labels);
    const canvas = document.createElement('canvas');
    canvas.width = el.w;
    canvas.height = el.h;
    const ctx = canvas.getContext('2d')!;
    const out = ctx.createImageData(el.w, el.h);
    for (let y = 0; y < el.h; y++) {
      for (let x = 0; x < el.w; x++) {
        const origem = (el.y + y) * w + (el.x + x);
        const label = labels[origem];
        // Pixel rotulado só entra se for deste elemento; pixel sem rótulo é
        // franja de anti-aliasing e vai junto, pra a borda não ficar dura.
        if (label && !doGrupo.has(label)) continue;
        const destino = (y * el.w + x) * 4;
        const fonte = origem * 4;
        out.data[destino] = rgba[fonte];
        out.data[destino + 1] = rgba[fonte + 1];
        out.data[destino + 2] = rgba[fonte + 2];
        out.data[destino + 3] = rgba[fonte + 3];
      }
    }
    ctx.putImageData(out, 0, 0);
    return canvas;
  });
}
