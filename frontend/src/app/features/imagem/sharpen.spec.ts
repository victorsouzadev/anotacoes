import { sharpenRgba } from './sharpen';

/** Cena em alta resolução com textura fina e uma área lisa, reduzida por média
 * de blocos — que é o que um downscale correto faz. É o cenário real: a
 * nitidez existe pra devolver o que a redução tirou. */
function scene(noise: number, factor = 4): { pixels: Uint8ClampedArray; w: number; h: number } {
  const w = 400;
  const h = 120;
  const hi = new Float64Array(w * factor * h * factor);
  const hiW = w * factor;
  let state = 7;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  for (let y = 0; y < h * factor; y++) {
    for (let x = 0; x < hiW; x++) {
      const stripes = x < hiW / 2 ? 60 + (Math.floor(x / (3 * factor)) % 2) * 70 : 190;
      hi[y * hiW + x] = stripes + (random() - 0.5) * noise;
    }
  }
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let j = 0; j < factor; j++) for (let i = 0; i < factor; i++) sum += hi[(y * factor + j) * hiW + x * factor + i];
      const v = sum / (factor * factor);
      const o = (y * w + x) * 4;
      pixels[o] = v;
      pixels[o + 1] = v;
      pixels[o + 2] = v;
      pixels[o + 3] = 255;
    }
  }
  return { pixels, w, h };
}

/** Contraste da textura fina — "definição" medida. */
function detail({ pixels, w, h }: { pixels: Uint8ClampedArray; w: number; h: number }): number {
  let min = 255;
  let max = 0;
  for (let y = 10; y < h - 10; y++) {
    for (let x = 20; x < w / 2 - 20; x++) {
      const v = pixels[(y * w + x) * 4];
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return max - min;
}

/** Desvio na área lisa — se subir junto, a nitidez está amplificando grão. */
function flatNoise({ pixels, w, h }: { pixels: Uint8ClampedArray; w: number; h: number }): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 10; y < h - 10; y++) {
    for (let x = w / 2 + 20; x < w - 20; x++) {
      const v = pixels[(y * w + x) * 4];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  return Math.sqrt(Math.max(0, sumSq / n - (sum / n) ** 2));
}

describe('nitidez', () => {
  it('não mexe na imagem com força zero', () => {
    const base = scene(0);
    const copy = new Uint8ClampedArray(base.pixels);
    sharpenRgba(copy, base.w, base.h, 0);
    expect(Array.from(copy)).toEqual(Array.from(base.pixels));
  });

  it('devolve o contraste que a redução comeu', () => {
    const base = scene(0);
    const before = detail(base);
    const after = { ...base, pixels: new Uint8ClampedArray(base.pixels) };
    sharpenRgba(after.pixels, after.w, after.h, 40);
    expect(detail(after)).toBeGreaterThan(before * 1.3);
  });

  it('não amplifica o grão da área lisa', () => {
    const base = scene(8);
    const noiseBefore = flatNoise(base);
    const after = { ...base, pixels: new Uint8ClampedArray(base.pixels) };
    sharpenRgba(after.pixels, after.w, after.h, 60);
    // o detalhe sobe bastante...
    expect(detail(after)).toBeGreaterThan(detail(base) * 1.5);
    // ...enquanto o liso continua liso (o limiar é o que segura isso)
    expect(flatNoise(after)).toBeLessThan(noiseBefore * 1.3);
  });

  it('afia mais quanto maior a força', () => {
    const base = scene(0);
    const leve = new Uint8ClampedArray(base.pixels);
    const forte = new Uint8ClampedArray(base.pixels);
    sharpenRgba(leve, base.w, base.h, 25);
    sharpenRgba(forte, base.w, base.h, 85);
    expect(detail({ ...base, pixels: forte })).toBeGreaterThan(detail({ ...base, pixels: leve }));
  });

  it('preserva o alfa', () => {
    const base = scene(0);
    for (let i = 0; i < base.w * base.h; i++) base.pixels[i * 4 + 3] = 200;
    sharpenRgba(base.pixels, base.w, base.h, 70);
    expect(base.pixels[3]).toBe(200);
  });
});
