/** Vetorização do contorno de corte: extrai polígonos fechados da silhueta
 * (canal alpha) de um canvas via marching squares, com simplificação
 * (Ramer-Douglas-Peucker) e suavização (Chaikin) — pra linha de corte sair
 * limpa pra máquina (ScanNCut etc.) em vez de serrilhada pixel a pixel. */

export type Point = [number, number];
export type Polygon = Point[];

export interface TraceOptions {
  /** Alpha mínimo (0–255) pra um pixel contar como "dentro". */
  alphaThreshold?: number;
  /** Mantém só os contornos externos, descartando furos internos. */
  fillHoles?: boolean;
  /** Tolerância de simplificação em px (0 = desliga). */
  simplifyEpsilon?: number;
  /** Iterações de suavização Chaikin (0 = desliga). */
  chaikinIterations?: number;
  /** Área mínima em px² pra um contorno ser mantido (descarta ruído). */
  minArea?: number;
}

export function traceCutPaths(canvas: HTMLCanvasElement, options: TraceOptions = {}): Polygon[] {
  const {
    alphaThreshold = 128,
    fillHoles = true,
    simplifyEpsilon = 0,
    chaikinIterations = 0,
    minArea = 16,
  } = options;

  const w = canvas.width;
  const h = canvas.height;
  const data = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const inside = (x: number, y: number): number =>
    x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] >= alphaThreshold ? 1 : 0;

  // Marching squares em células entre amostras (incluindo uma borda virtual
  // vazia em volta, pra silhuetas encostadas na borda fecharem o contorno).
  // Segmentos direcionados são ligados por ponto inicial num Map — cada
  // vértice de contorno tem exatamente uma entrada e uma saída.
  const segments = new Map<number, { ex: number; ey: number }>();
  // coords são múltiplos de 0.5; chave inteira única = (x*2) + (y*2) * stride
  const stride = (w + 2) * 2;
  const key = (x: number, y: number): number => x * 2 + 1 + (y * 2 + 1) * stride;

  const addSeg = (sx: number, sy: number, ex: number, ey: number): void => {
    segments.set(key(sx, sy), { ex, ey });
  };

  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const tl = inside(x, y);
      const tr = inside(x + 1, y);
      const br = inside(x + 1, y + 1);
      const bl = inside(x, y + 1);
      const idx = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (idx === 0 || idx === 15) continue;

      const tx = x + 0.5, ty = y;       // meio da aresta superior
      const rx = x + 1, ry = y + 0.5;   // direita
      const bx = x + 0.5, by = y + 1;   // inferior
      const lx = x, ly = y + 0.5;       // esquerda

      switch (idx) {
        case 1: addSeg(lx, ly, bx, by); break;
        case 2: addSeg(bx, by, rx, ry); break;
        case 3: addSeg(lx, ly, rx, ry); break;
        case 4: addSeg(rx, ry, tx, ty); break;
        case 5: addSeg(lx, ly, tx, ty); addSeg(rx, ry, bx, by); break;
        case 6: addSeg(bx, by, tx, ty); break;
        case 7: addSeg(lx, ly, tx, ty); break;
        case 8: addSeg(tx, ty, lx, ly); break;
        case 9: addSeg(tx, ty, bx, by); break;
        case 10: addSeg(tx, ty, rx, ry); addSeg(bx, by, lx, ly); break;
        case 11: addSeg(tx, ty, rx, ry); break;
        case 12: addSeg(rx, ry, lx, ly); break;
        case 13: addSeg(rx, ry, bx, by); break;
        case 14: addSeg(bx, by, lx, ly); break;
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
      loop.push([seg.ex, seg.ey]);
      k = key(seg.ex, seg.ey);
      if (k === startKey) break;
    }
    if (loop.length >= 3) loops.push(loop);
  }

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

  return kept.map(({ poly }) => {
    let p = poly;
    if (simplifyEpsilon > 0) p = simplifyClosed(p, simplifyEpsilon);
    for (let i = 0; i < chaikinIterations; i++) p = chaikin(p);
    return p;
  }).filter((p) => p.length >= 3);
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

/** Suavização Chaikin (corner cutting) pra polígono fechado. */
function chaikin(poly: Polygon): Polygon {
  const out: Polygon = [];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    out.push([x1 * 0.75 + x2 * 0.25, y1 * 0.75 + y2 * 0.25]);
    out.push([x1 * 0.25 + x2 * 0.75, y1 * 0.25 + y2 * 0.75]);
  }
  return out;
}

/** Monta o atributo `d` de um <path> SVG a partir dos polígonos. */
export function polygonsToPathData(polys: Polygon[], decimals = 2): string {
  return polys
    .map((poly) => {
      const pts = poly.map(([x, y]) => `${x.toFixed(decimals)} ${y.toFixed(decimals)}`);
      return `M ${pts.join(' L ')} Z`;
    })
    .join(' ');
}

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
