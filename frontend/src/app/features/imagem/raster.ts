/** Operações de pixel do editor de imagens: silhueta, dilatação do contorno,
 * restrição à região externa, borracha e remoção de fundo. Ficam fora do
 * componente porque são lógica pura de canvas — testáveis isoladamente. */

/** Uma borrachada: círculo em coordenadas de pixel da arte original (pode cair
 * fora dos limites dela, já que o contorno extrapola a arte). */
export interface Erasure {
  x: number;
  y: number;
  r: number;
}

/** Máscara binária da arte (alpha >= 128) posicionada na moldura do contorno. */
function artMask(source: HTMLCanvasElement, W: number, H: number, offset: number): Uint8Array {
  const w = source.width;
  const h = source.height;
  const mask = new Uint8Array(W * H);
  const px = source.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  for (let y = 0; y < h; y++) {
    const destino = (y + offset) * W + offset;
    const origem = y * w;
    for (let x = 0; x < w; x++) {
      if (px[(origem + x) * 4 + 3] >= 128) mask[destino + x] = 1;
    }
  }
  return mask;
}

/** Transformada de distância 1-D de Felzenszwalb & Huttenlocher: envoltória
 * inferior das parábolas, em tempo linear. */
function edt1d(f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array, n: number): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dist = q - v[k];
    d[q] = dist * dist + f[v[k]];
  }
}

/** Distância euclidiana (ao quadrado) de cada pixel até a arte mais próxima.
 * Substitui a dilatação por carimbos: é exata e custa O(pixels), enquanto
 * carimbar a silhueta centenas de vezes custava O(pixels × carimbos) — a conta
 * que travava a aba em imagens grandes. */
function squaredDistanceToMask(mask: Uint8Array, W: number, H: number): Float64Array {
  const INF = 1e20;
  const dist = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) dist[i] = mask[i] ? 0 : INF;

  const n = Math.max(W, H);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  for (let y = 0; y < H; y++) {
    const linha = y * W;
    for (let x = 0; x < W; x++) f[x] = dist[linha + x];
    edt1d(f, d, v, z, W);
    for (let x = 0; x < W; x++) dist[linha + x] = d[x];
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = dist[y * W + x];
    edt1d(f, d, v, z, H);
    for (let y = 0; y < H; y++) dist[y * W + x] = d[y];
  }
  return dist;
}

/** Região alcançável a partir da moldura sem atravessar a arte (busca em
 * largura com fila em Int32Array — um array comum cresceria pra milhões). */
function outsideMask(mask: Uint8Array, W: number, H: number): Uint8Array {
  const fora = new Uint8Array(W * H);
  const fila = new Int32Array(W * H);
  let fim = 0;
  const semear = (i: number): void => {
    if (!mask[i] && !fora[i]) {
      fora[i] = 1;
      fila[fim++] = i;
    }
  };
  for (let x = 0; x < W; x++) { semear(x); semear((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { semear(y * W); semear(y * W + W - 1); }
  for (let ini = 0; ini < fim; ini++) {
    const idx = fila[ini];
    const x = idx % W;
    if (x > 0) semear(idx - 1);
    if (x < W - 1) semear(idx + 1);
    if (idx >= W) semear(idx - W);
    if (idx < W * (H - 1)) semear(idx + W);
  }
  return fora;
}

function parseHex(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [255, 255, 255];
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

/** Camada de contorno tipo "sticker" seguindo a silhueta (sem a arte), com
 * faixa branca opcional (gapPx) entre a arte e o contorno colorido.
 *
 * `outerOnly` descarta o contorno que nasce dentro de vãos fechados do desenho
 * (típico de arte de traço, que ganha borda dos dois lados). O que fica sob a
 * própria arte também some, mas a arte é desenhada por cima. */
export function buildContourLayer(
  source: HTMLCanvasElement,
  marginPx: number,
  gapPx: number,
  color: string,
  outerOnly = false,
): HTMLCanvasElement {
  const m = Math.max(0, Math.round(marginPx));
  const g = Math.max(0, Math.round(gapPx));
  const total = m + g;
  const W = source.width + total * 2;
  const H = source.height + total * 2;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  if (total === 0) return out;

  const mask = artMask(source, W, H, total);
  const dist2 = squaredDistanceToMask(mask, W, H);
  const fora = outerOnly ? outsideMask(mask, W, H) : null;
  const [r, gCor, b] = parseHex(color);

  const img = new ImageData(W, H);
  const dados = img.data;
  const limite = total;
  const limiteGap = g;
  for (let i = 0; i < W * H; i++) {
    if (fora && !fora[i]) continue; // contorno nascido dentro de vão fechado
    const d = Math.sqrt(dist2[i]);
    if (d > limite) continue;
    const o = i * 4;
    if (g > 0 && d <= limiteGap) {
      dados[o] = 255; dados[o + 1] = 255; dados[o + 2] = 255;
    } else {
      dados[o] = r; dados[o + 1] = gCor; dados[o + 2] = b;
    }
    // meio pixel de suavização na borda externa, pra não sair serrilhado
    dados[o + 3] = d > limite - 1 ? Math.round((limite - d) * 255) : 255;
  }
  out.getContext('2d')!.putImageData(img, 0, 0);
  return out;
}

/** Aplica as borrachadas (círculos em coordenadas da arte) sobre a camada de
 * contorno. A arte nunca é tocada: ela entra depois, por cima. */
export function applyErasures(
  contour: HTMLCanvasElement,
  erasures: Erasure[],
  offsetX: number,
  offsetY: number,
  mirrored: boolean,
  artWidth: number,
): void {
  if (!erasures.length) return;
  const ctx = contour.getContext('2d')!;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  for (const e of erasures) {
    const x = mirrored ? artWidth - e.x : e.x;
    ctx.beginPath();
    ctx.arc(offsetX + x, offsetY + e.y, e.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Cópia reduzida da arte, pra prévia trabalhar no tamanho que aparece na tela
 * em vez de na resolução cheia — o custo de tudo depois cai com o quadrado. */
export function downscale(source: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(source.width * factor));
  out.height = Math.max(1, Math.round(source.height * factor));
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

export function flipHorizontal(source: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d')!;
  ctx.translate(out.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, 0, 0);
  return out;
}

/** Codifica a arte pra guardar no projeto: PNG quando há transparência (JPEG
 * perderia o canal alfa, que é o que define o recorte) e JPEG quando é opaca,
 * onde o payload menor compensa. */
export function encodeCanvas(source: HTMLCanvasElement): string {
  const { data } = source.getContext('2d')!.getImageData(0, 0, source.width, source.height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return source.toDataURL('image/png');
  }
  return source.toDataURL('image/jpeg', 0.92);
}

export function makeThumb(source: HTMLCanvasElement): string {
  const size = 72;
  const scale = Math.min(size / source.width, size / source.height, 1);
  const thumb = document.createElement('canvas');
  thumb.width = Math.max(1, Math.round(source.width * scale));
  thumb.height = Math.max(1, Math.round(source.height * scale));
  thumb.getContext('2d')!.drawImage(source, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL('image/png');
}

/** Remove o fundo por inundação (flood fill) a partir do pixel clicado:
 * apaga a região contígua de cor parecida (distância RGB ≤ tolerância). */
export function floodRemoveBackground(source: HTMLCanvasElement, startX: number, startY: number, tolerance: number): boolean {
  const w = source.width;
  const h = source.height;
  if (startX < 0 || startY < 0 || startX >= w || startY >= h) return false;
  const ctx = source.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const start = (startY * w + startX) * 4;
  if (data[start + 3] === 0) return false;
  const r0 = data[start];
  const g0 = data[start + 1];
  const b0 = data[start + 2];
  const tol2 = tolerance * tolerance;

  const visited = new Uint8Array(w * h);
  const stack: number[] = [startY * w + startX];
  visited[stack[0]] = 1;
  while (stack.length) {
    const idx = stack.pop()!;
    const o = idx * 4;
    const dr = data[o] - r0;
    const dg = data[o + 1] - g0;
    const db = data[o + 2] - b0;
    if (dr * dr + dg * dg + db * db > tol2 || data[o + 3] === 0) continue;
    data[o + 3] = 0;
    const x = idx % w;
    const y = (idx / w) | 0;
    if (x > 0 && !visited[idx - 1]) { visited[idx - 1] = 1; stack.push(idx - 1); }
    if (x < w - 1 && !visited[idx + 1]) { visited[idx + 1] = 1; stack.push(idx + 1); }
    if (y > 0 && !visited[idx - w]) { visited[idx - w] = 1; stack.push(idx - w); }
    if (y < h - 1 && !visited[idx + w]) { visited[idx + w] = 1; stack.push(idx + w); }
  }
  ctx.putImageData(imageData, 0, 0);
  return true;
}
