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

/** Silhueta da arte (canal alpha) preenchida numa cor sólida. */
export function buildSilhouette(source: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const sil = document.createElement('canvas');
  sil.width = source.width;
  sil.height = source.height;
  const sctx = sil.getContext('2d')!;
  sctx.drawImage(source, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = color;
  sctx.fillRect(0, 0, sil.width, sil.height);
  // reforça o alpha das bordas suavizadas pra silhueta não ficar translúcida
  sctx.globalCompositeOperation = 'source-over';
  sctx.drawImage(sil, 0, 0);
  sctx.drawImage(sil, 0, 0);
  return sil;
}

/** Carimba a silhueta dilatada por um raio: a união dos deslocamentos da forma
 * cheia em todos os raios até `radius` cobre a dilatação inteira. */
export function stampDilated(ctx: CanvasRenderingContext2D, sil: HTMLCanvasElement, offset: number, radius: number): void {
  const angleSteps = 16;
  const radialStep = Math.max(1, Math.floor(radius / 14));
  for (let r = radius; r > 0; r -= radialStep) {
    for (let a = 0; a < angleSteps; a++) {
      const t = (a / angleSteps) * Math.PI * 2;
      ctx.drawImage(sil, offset + Math.cos(t) * r, offset + Math.sin(t) * r);
    }
  }
  ctx.drawImage(sil, offset, offset);
}

/** Camada de contorno tipo "sticker" seguindo a silhueta (sem a arte), com
 * faixa branca opcional (gapPx) entre a arte e o contorno colorido. */
export function buildContourLayer(source: HTMLCanvasElement, marginPx: number, gapPx: number, color: string): HTMLCanvasElement {
  const m = Math.max(0, Math.round(marginPx));
  const g = Math.max(0, Math.round(gapPx));
  const total = m + g;
  const out = document.createElement('canvas');
  out.width = source.width + total * 2;
  out.height = source.height + total * 2;

  if (total > 0) {
    const ctx = out.getContext('2d')!;
    const sil = buildSilhouette(source, color);
    stampDilated(ctx, sil, total, total);
    if (g > 0) {
      const white = buildSilhouette(source, '#ffffff');
      stampDilated(ctx, white, total, g);
    }
  }
  return out;
}

/** Apaga da camada de contorno tudo que não está na região ligada à borda do
 * canvas — ou seja, o contorno que nasceu dentro de vãos fechados do desenho.
 * O que fica sob a própria arte também some, mas a arte é desenhada por cima. */
export function restrictContourToOuterRegion(contour: HTMLCanvasElement, source: HTMLCanvasElement, offset: number): void {
  const W = contour.width;
  const H = contour.height;
  const artMask = document.createElement('canvas');
  artMask.width = W;
  artMask.height = H;
  artMask.getContext('2d')!.drawImage(source, offset, offset);
  const art = artMask.getContext('2d')!.getImageData(0, 0, W, H).data;

  const outside = new Uint8Array(W * H);
  const stack: number[] = [];
  const visit = (idx: number): void => {
    if (!outside[idx] && art[idx * 4 + 3] < 128) {
      outside[idx] = 1;
      stack.push(idx);
    }
  };
  for (let x = 0; x < W; x++) { visit(x); visit((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { visit(y * W); visit(y * W + W - 1); }
  while (stack.length) {
    const idx = stack.pop()!;
    const x = idx % W;
    const y = (idx / W) | 0;
    if (x > 0) visit(idx - 1);
    if (x < W - 1) visit(idx + 1);
    if (y > 0) visit(idx - W);
    if (y < H - 1) visit(idx + W);
  }

  const ctx = contour.getContext('2d')!;
  const img = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < W * H; i++) {
    if (!outside[i]) img.data[i * 4 + 3] = 0;
  }
  ctx.putImageData(img, 0, 0);
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
