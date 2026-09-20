import { applyLook, colorMatrix, isNeutralLook } from './color';
import { FILTER_PRESETS, NEUTRAL } from './social-model';

const W = 600;
const H = 24;

/** Céu: gradiente lento, já quantizado em 8 bits como vem de qualquer JPEG.
 * É o caso em que a faixa aparece. */
function sky(): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.round(120 + (20 * x) / W);
      const o = (y * W + x) * 4;
      pixels[o] = v;
      pixels[o + 1] = v + 6;
      pixels[o + 2] = v + 22;
      pixels[o + 3] = 255;
    }
  }
  return pixels;
}

/** A pilha de filtros que existia antes: cada etapa arredonda pra 8 bits. */
function chained(pixels: Uint8ClampedArray, brightness: number, contrast: number, saturation: number): void {
  const q = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  for (let i = 0; i < pixels.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      pixels[i + c] = q(q(pixels[i + c] * (brightness / 100)) - 127.5) + 127.5;
      pixels[i + c] = q((pixels[i + c] - 127.5) * (contrast / 100) + 127.5);
    }
    const luma = 0.213 * pixels[i] + 0.715 * pixels[i + 1] + 0.072 * pixels[i + 2];
    for (let c = 0; c < 3; c++) pixels[i + c] = q(luma + (pixels[i + c] - luma) * (saturation / 100));
  }
}

/** Maior sequência de pixels idênticos numa linha: é o que o olho lê como faixa. */
function widestBand(pixels: Uint8ClampedArray): number {
  let run = 1;
  let widest = 1;
  const y = H >> 1;
  for (let x = 1; x < W; x++) {
    if (pixels[(y * W + x - 1) * 4] === pixels[(y * W + x) * 4]) widest = Math.max(widest, ++run);
    else run = 1;
  }
  return widest;
}

function levels(pixels: Uint8ClampedArray): number {
  const seen = new Set<number>();
  const y = H >> 1;
  for (let x = 0; x < W; x++) seen.add(pixels[(y * W + x) * 4]);
  return seen.size;
}

describe('cor em ponto flutuante', () => {
  it('quebra a faixa que a pilha de filtros criava', () => {
    const look = { ...NEUTRAL, brightness: 106, contrast: 128, saturation: 118 };
    const antigo = sky();
    chained(antigo, look.brightness, look.contrast, look.saturation);
    const novo = sky();
    applyLook(novo, W, H, look);

    expect(widestBand(novo)).toBeLessThan(widestBand(antigo) / 2);
    expect(levels(novo)).toBeGreaterThan(levels(antigo));
  });

  it('a vinheta, que era o pior degradê, também sai sem faixa larga', () => {
    const pixels = sky();
    applyLook(pixels, W, H, { ...NEUTRAL, vignette: 60 });
    expect(widestBand(pixels)).toBeLessThan(40);
  });

  it('não toca na imagem quando não há ajuste', () => {
    expect(isNeutralLook({ ...NEUTRAL })).toBe(true);
    // desfoque é aplicado no desenho, não aqui
    expect(isNeutralLook({ ...NEUTRAL, blur: 40 })).toBe(true);
    expect(isNeutralLook({ ...NEUTRAL, contrast: 101 })).toBe(false);
  });

  it('mantém o cinza neutro ao dessaturar', () => {
    const pixels = new Uint8ClampedArray([200, 120, 60, 255]);
    applyLook(pixels, 1, 1, { ...NEUTRAL, grayscale: 100 });
    expect(Math.abs(pixels[0] - pixels[1])).toBeLessThanOrEqual(2);
    expect(Math.abs(pixels[1] - pixels[2])).toBeLessThanOrEqual(2);
  });

  it('a matriz neutra é a identidade, a menos de arredondamento', () => {
    const m = colorMatrix({ ...NEUTRAL });
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    m.forEach((v, i) => expect(Math.abs(v - identity[i])).toBeLessThan(1e-6));
  });

  it('todo filtro pronto continua rodando sem estourar nem zerar a imagem', () => {
    for (const preset of FILTER_PRESETS) {
      const pixels = sky();
      applyLook(pixels, W, H, { ...NEUTRAL, ...preset.values });
      const middle = pixels[((H >> 1) * W + (W >> 1)) * 4];
      expect(middle).toBeGreaterThan(0);
      expect(middle).toBeLessThan(255);
    }
  });
});
