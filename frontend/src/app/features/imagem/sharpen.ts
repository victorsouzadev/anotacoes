/** Máscara de nitidez (unsharp mask), a última etapa do caminho da foto.
 *
 * Toda redução de tamanho custa micro-contraste: os detalhes que ocupavam
 * vários pixels passam a ocupar um, e a média que faz isso é, por definição,
 * um borrão. A máscara devolve esse contraste comparando a imagem com uma
 * versão borrada dela mesma e empurrando a diferença de volta.
 *
 * Duas decisões que separam nitidez de "aquele efeito plastificado":
 *
 * - Só a **luminância** é afiada. Mexer nos canais de cor cria franja colorida
 *   nas bordas de alto contraste, que é o cheiro de imagem tratada demais.
 * - Diferença pequena é **ruído**, não detalhe, e fica de fora por um limiar.
 *   Sem isso a máscara amplifica exatamente o grão que a redução de ruído
 *   acabou de tirar. */

/** Gaussiana aproximada por três passadas de média móvel — o teorema central
 * do limite fazendo o trabalho pesado, com custo independente do raio. */
function boxBlurPass(src: Float32Array, dst: Float32Array, w: number, h: number, radius: number): void {
  const span = radius * 2 + 1;
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum / span;
      const add = src[row + Math.min(w - 1, x + radius + 1)];
      const drop = src[row + Math.max(0, x - radius)];
      sum += add - drop;
    }
  }
  // vertical, sobre o resultado da horizontal
  const column = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) column[y] = dst[y * w + x];
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += column[Math.min(h - 1, Math.max(0, k))];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum / span;
      const add = column[Math.min(h - 1, y + radius + 1)];
      const drop = column[Math.max(0, y - radius)];
      sum += add - drop;
    }
  }
}

/** Afia os pixels RGBA in loco. `amount` vai de 0 (nada) a 100. O raio
 * acompanha o tamanho da imagem: nitidez é um efeito de borda, e uma borda tem
 * a espessura que o tamanho da foto determina. */
export function sharpenRgba(pixels: Uint8ClampedArray, w: number, h: number, amount: number): void {
  if (!(amount > 0) || w < 8 || h < 8) return;
  const strength = Math.min(100, amount) / 100;
  const n = w * h;

  const luma = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    luma[i] = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
  }

  const radius = Math.max(1, Math.round(Math.max(w, h) / 700));
  const blurred = new Float32Array(n);
  boxBlurPass(luma, blurred, w, h, radius);
  const second = new Float32Array(n);
  boxBlurPass(blurred, second, w, h, radius);
  boxBlurPass(second, blurred, w, h, radius);

  // Até 2× de reforço na força máxima. Acima disso a borda ganha auréola.
  const gain = strength * 2;
  /** O limiar é descontado, não usado como corte seco: um corte cria degrau
   * onde a diferença cruza o valor, e degrau numa área lisa é pior que o grão
   * que ele queria evitar. */
  const threshold = 1.5;

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const diff = luma[i] - blurred[i];
    const useful = diff > threshold ? diff - threshold : (diff < -threshold ? diff + threshold : 0);
    if (useful === 0) continue;
    const boost = useful * gain;
    pixels[p] += boost;
    pixels[p + 1] += boost;
    pixels[p + 2] += boost;
  }
}
