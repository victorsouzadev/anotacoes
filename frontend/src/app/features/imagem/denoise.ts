/** Redução de ruído de verdade, não desfoque.
 *
 * Duas coisas acontecem aqui, e são separadas de propósito porque o ruído de
 * sensor tem duas caras:
 *
 * 1. **Luminância** — decomposição à trous ("algorithme à trous", wavelet sem
 *    subamostragem) em níveis de detalhe, com *soft threshold* em cada nível.
 *    Detalhe menor que o limiar é ruído e some; detalhe maior é borda e passa
 *    inteiro, encolhido apenas pelo limiar. É por isso que a imagem não borra:
 *    a estrutura vive nos coeficientes grandes, que sobrevivem.
 * 2. **Croma** — o ruído colorido (aquelas manchas vermelhas e verdes na
 *    sombra) mora em Cb/Cr e o olho quase não enxerga detalhe de cor. Uma
 *    suavização forte só nesses dois canais limpa as manchas sem custar
 *    nitidez nenhuma.
 *
 * O limiar sai de uma estimativa do próprio ruído da foto (MAD do nível mais
 * fino), então "força 50" quer dizer a mesma coisa numa foto limpa e numa foto
 * granulada — não é um número solto.
 *
 * Tudo opera sobre a Uint8ClampedArray do ImageData, in loco, pra poder rodar
 * num worker sem copiar a imagem. */

/** Kernel B3-spline, o de sempre na decomposição à trous. */
const KERNEL = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
/** Três níveis cobrem o grão fino e as manchas médias; acima disso o que resta
 * já é estrutura da foto. */
const LEVELS = 3;
/** Quanto do ruído estimado cada nível descarta. O grão vive no nível fino, e
 * cortar fundo nos níveis grossos é o que achata a imagem — daí a queda. */
const LEVEL_WEIGHTS = [1, 0.4, 0.15];
/** Converte MAD (desvio absoluto mediano) em desvio-padrão de uma gaussiana. */
const MAD_TO_SIGMA = 1 / 0.6745;

/** Espelha o índice na borda, pra suavização não escurecer as margens. */
function mirror(i: number, n: number): number {
  if (i < 0) return -i % n;
  if (i >= n) return (n - 2 - ((i - n) % n) + n) % n;
  return i;
}

/** Uma passada do kernel à trous com "buracos" de `step` pixels, separável:
 * horizontal e depois vertical. */
function atrousBlur(src: Float32Array, dst: Float32Array, tmp: Float32Array, w: number, h: number, step: number): void {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) sum += KERNEL[k + 2] * src[row + mirror(x + k * step, w)];
      tmp[row + x] = sum;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) sum += KERNEL[k + 2] * tmp[mirror(y + k * step, h) * w + x];
      dst[y * w + x] = sum;
    }
  }
}

/** Desvio absoluto mediano dos detalhes finos — estimativa de ruído que não se
 * deixa enganar por bordas fortes, ao contrário do desvio-padrão. */
function estimateSigma(detail: Float32Array): number {
  // Amostra em vez de ordenar milhões de valores: o MAD é robusto o bastante
  // pra que alguns milhares de pixels deem a mesma resposta.
  const stride = Math.max(1, Math.floor(detail.length / 20000));
  const sample: number[] = [];
  for (let i = 0; i < detail.length; i += stride) sample.push(Math.abs(detail[i]));
  if (!sample.length) return 0;
  sample.sort((a, b) => a - b);
  return sample[sample.length >> 1] * MAD_TO_SIGMA;
}

function softThreshold(value: number, t: number): number {
  if (value > t) return value - t;
  if (value < -t) return value + t;
  return 0;
}

/** Média móvel separável — usada só no croma, onde borrar é justamente o
 * objetivo. Soma acumulada, então o custo não cresce com o raio. */
function boxBlur(plane: Float32Array, tmp: Float32Array, w: number, h: number, radius: number): void {
  if (radius < 1) return;
  const span = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += plane[row + mirror(k, w)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / span;
      sum += plane[row + mirror(x + radius + 1, w)] - plane[row + mirror(x - radius, w)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[mirror(k, h) * w + x];
    for (let y = 0; y < h; y++) {
      plane[y * w + x] = sum / span;
      sum += tmp[mirror(y + radius + 1, h) * w + x] - tmp[mirror(y - radius, h) * w + x];
    }
  }
}

/** Reduz o ruído dos pixels RGBA, in loco. `strength` vai de 0 (não faz nada) a
 * 100. O alfa não é tocado. */
export function denoiseRgba(pixels: Uint8ClampedArray, w: number, h: number, strength: number): void {
  if (!(strength > 0) || w < 8 || h < 8) return;
  const amount = Math.min(100, strength) / 100;
  const n = w * h;

  const y = new Float32Array(n);
  const cb = new Float32Array(n);
  const cr = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = pixels[p];
    const g = pixels[p + 1];
    const b = pixels[p + 2];
    y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b;
    cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
  }

  // --- luminância: encolhe o detalhe de cada nível ---
  const smooth = new Float32Array(n);
  const tmp = new Float32Array(n);
  const detail = new Float32Array(n);
  const kept = new Float32Array(n);
  let current = y;
  let sigma = 0;

  for (let level = 0; level < LEVELS; level++) {
    atrousBlur(current, smooth, tmp, w, h, 1 << level);
    for (let i = 0; i < n; i++) detail[i] = current[i] - smooth[i];
    // O ruído é medido uma vez, no nível mais fino, que é onde ele domina.
    if (level === 0) sigma = estimateSigma(detail);
    // 3 desvios na força máxima. Medido num degrau com ruído: acima disso a
    // borda perde mais contraste do que o ruído que ainda sai compensa.
    const t = sigma * LEVEL_WEIGHTS[level] * amount * 3;
    for (let i = 0; i < n; i++) kept[i] += softThreshold(detail[i], t);
    // `smooth` vira a entrada do próximo nível; `current` volta a ser rascunho.
    const next = current === y ? new Float32Array(n) : current;
    next.set(smooth);
    current = next;
  }
  for (let i = 0; i < n; i++) y[i] = current[i] + kept[i];

  // --- croma: suaviza forte, que o olho não vê ---
  const radius = Math.round(1 + amount * 5);
  boxBlur(cb, tmp, w, h, radius);
  boxBlur(cr, tmp, w, h, radius);

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const luma = y[i];
    const u = cb[i];
    const v = cr[i];
    pixels[p] = luma + 1.402 * v;
    pixels[p + 1] = luma - 0.344136 * u - 0.714136 * v;
    pixels[p + 2] = luma + 1.772 * u;
  }
}
