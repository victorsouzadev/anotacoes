import { denoiseRgba } from './denoise';

const W = 128;
const H = 128;

/** Degrau vertical com ruído gaussiano: o caso que separa redução de ruído de
 * desfoque — o desfoque também derruba o ruído, mas leva a borda junto. */
function noisyStep(sigma: number, seed = 1): { pixels: Uint8ClampedArray; clean: Float64Array } {
  const pixels = new Uint8ClampedArray(W * H * 4);
  const clean = new Float64Array(W * H);
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const base = x < W / 2 ? 70 : 185;
      clean[i] = base;
      let g = 0;
      for (let k = 0; k < 6; k++) g += random();
      const noise = ((g - 3) / Math.SQRT1_2) * sigma;
      pixels[i * 4] = base + noise;
      pixels[i * 4 + 1] = base + noise;
      pixels[i * 4 + 2] = base + noise * 0.8;
      pixels[i * 4 + 3] = 255;
    }
  }
  return { pixels, clean };
}

function rmse(pixels: Uint8ClampedArray, clean: Float64Array): number {
  let err = 0;
  for (let i = 0; i < W * H; i++) {
    const luma = 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2];
    err += (luma - clean[i]) ** 2;
  }
  return Math.sqrt(err / (W * H));
}

/** Contraste medido a 5 px de cada lado da borda. */
function edgeContrast(pixels: Uint8ClampedArray): number {
  let dark = 0;
  let light = 0;
  for (let y = 0; y < H; y++) {
    dark += pixels[(y * W + W / 2 - 5) * 4];
    light += pixels[(y * W + W / 2 + 5) * 4];
  }
  return (light - dark) / H;
}

describe('redução de ruído', () => {
  it('não mexe na imagem com força zero', () => {
    const { pixels } = noisyStep(10);
    const copy = new Uint8ClampedArray(pixels);
    denoiseRgba(copy, W, H, 0);
    expect(Array.from(copy)).toEqual(Array.from(pixels));
  });

  it('derruba o ruído bem mais do que o contraste da borda', () => {
    const { pixels, clean } = noisyStep(14);
    const before = { rmse: rmse(pixels, clean), edge: edgeContrast(pixels) };
    denoiseRgba(pixels, W, H, 60);
    const after = { rmse: rmse(pixels, clean), edge: edgeContrast(pixels) };

    // o ruído cai pelo menos pela metade...
    expect(after.rmse).toBeLessThan(before.rmse * 0.5);
    // ...e a borda continua lá, com a maior parte do contraste original
    expect(after.edge).toBeGreaterThan(before.edge * 0.8);
  });

  it('limpa mais quanto maior a força', () => {
    const { pixels, clean } = noisyStep(14);
    const leve = new Uint8ClampedArray(pixels);
    const forte = new Uint8ClampedArray(pixels);
    denoiseRgba(leve, W, H, 20);
    denoiseRgba(forte, W, H, 90);
    expect(rmse(forte, clean)).toBeLessThan(rmse(leve, clean));
  });

  it('preserva o alfa', () => {
    const { pixels } = noisyStep(10);
    for (let i = 0; i < W * H; i++) pixels[i * 4 + 3] = 128;
    denoiseRgba(pixels, W, H, 70);
    expect(pixels[3]).toBe(128);
    expect(pixels[(W * H - 1) * 4 + 3]).toBe(128);
  });

  it('ignora imagem pequena demais pra decomposição', () => {
    const tiny = new Uint8ClampedArray(4 * 4 * 4).fill(200);
    const copy = new Uint8ClampedArray(tiny);
    denoiseRgba(copy, 4, 4, 100);
    expect(Array.from(copy)).toEqual(Array.from(tiny));
  });
});
