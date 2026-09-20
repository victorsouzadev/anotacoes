/** Os ajustes de cor, em ponto flutuante e numa passada só.
 *
 * Antes isto era uma pilha de filtros CSS no canvas. Cada filtro da pilha
 * escreve o resultado em 8 bits antes do próximo ler, então um céu — que varia
 * um nível a cada dezenas de pixels — era arredondado cinco ou seis vezes
 * seguidas. É daí que vêm as faixas: valores vizinhos que deviam diferir por
 * uma fração de nível caem no mesmo inteiro, e a transição suave vira degrau.
 *
 * Duas mudanças resolvem:
 *
 * 1. **Uma conta só.** Brilho, contraste, saturação, matiz, sépia e dessaturar
 *    são todos transformações lineares — dá pra multiplicar as matrizes de
 *    antemão e aplicar a composição de uma vez. Nenhum arredondamento no meio,
 *    e de quebra sai mais rápido que a pilha.
 * 2. **Dithering na saída.** Voltar pra 8 bits arredondando é o que cria o
 *    degrau. Somando um ruído de menos de um nível antes de arredondar, a
 *    fronteira entre dois valores deixa de ser uma linha reta e vira uma
 *    mistura — o olho integra e vê o meio-termo que os 8 bits não têm.
 *
 * O ruído vem de uma tabela fixa, e não de Math.random, porque a prévia é
 * redesenhada a cada movimento de controle: ruído novo a cada quadro cintila. */

import { Adjustments, NEUTRAL } from './social-model';

type Matrix = [number, number, number, number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const SEPIA: Matrix = [
  0.393, 0.769, 0.189,
  0.349, 0.686, 0.168,
  0.272, 0.534, 0.131,
];

function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array(9) as Matrix;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] = a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
    }
  }
  return out;
}

function mix(a: Matrix, b: Matrix, t: number): Matrix {
  return a.map((v, i) => v * (1 - t) + b[i] * t) as Matrix;
}

/** Matriz de saturação da especificação de filtros — a mesma que o navegador
 * usa, pra um projeto salvo continuar com a cara que tinha. */
function saturation(s: number): Matrix {
  return [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
}

function hueRotate(deg: number): Matrix {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
}

/** Cor e luz numa matriz só: as transformações aplicadas na mesma ordem da
 * pilha de filtros que existia antes. */
export function colorMatrix(a: Adjustments): Matrix {
  let m = saturation(a.saturation / 100);
  if (a.hue) m = multiply(hueRotate(a.hue), m);
  if (a.sepia) m = multiply(mix(IDENTITY, SEPIA, a.sepia / 100), m);
  if (a.grayscale) m = multiply(saturation(1 - a.grayscale / 100), m);
  return m;
}

/** Ruído triangular de ±1 nível, fixo, indexado pela posição. Triangular e não
 * uniforme porque é o que deixa o erro de arredondamento independente do valor
 * original — a diferença entre um degradê limpo e um degradê chiado. */
const NOISE_SIZE = 64;
const NOISE = (() => {
  const table = new Float32Array(NOISE_SIZE * NOISE_SIZE);
  let state = 0x9e3779b9;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
  for (let i = 0; i < table.length; i++) table[i] = next() - next();
  return table;
})();

/** Nada a fazer? O desfoque não conta: ele já foi aplicado no desenho. */
export function isNeutralLook(a: Adjustments): boolean {
  return (Object.keys(NEUTRAL) as (keyof Adjustments)[])
    .every((k) => k === 'blur' || a[k] === NEUTRAL[k]);
}

/** Aplica cor, acabamento (temperatura, desbotado, vinheta) e quantização com
 * dithering sobre os pixels já desenhados. Substitui a pilha de filtros e as
 * camadas pintadas por cima — inclusive a vinheta, que sendo um degradê enorme
 * e suave era justamente o pior caso de faixa. */
export function applyLook(pixels: Uint8ClampedArray, w: number, h: number, a: Adjustments): void {
  const m = colorMatrix(a);
  // Brilho e contraste são afins por canal, então entram como escala e
  // deslocamento antes da matriz, sem passada própria.
  const scale = (a.brightness / 100) * (a.contrast / 100);
  const shift = 0.5 - 0.5 * (a.contrast / 100);
  const rowSum = [
    (m[0] + m[1] + m[2]) * shift,
    (m[3] + m[4] + m[5]) * shift,
    (m[6] + m[7] + m[8]) * shift,
  ];

  const temp = a.temperature / 100;
  const tempAlpha = Math.min(0.45, Math.abs(temp) * 0.45);
  // As mesmas cores do acabamento anterior: quente puxa pro laranja, frio pro azul.
  const tempColor = temp > 0 ? [1, 0.541, 0.169] : [0.169, 0.490, 1];
  const fadeAlpha = (a.fade / 100) * 0.4;
  const fadeColor = [0.961, 0.949, 0.933];
  const vignette = (a.vignette / 100) * 0.75;
  const cx = w / 2;
  const cy = h / 2;
  const inner = Math.min(w, h) * 0.32;
  const outer = Math.max(w, h) * 0.72;
  const span = Math.max(1, outer - inner);

  for (let y = 0; y < h; y++) {
    const dy = y - cy;
    const noiseRow = (y % NOISE_SIZE) * NOISE_SIZE;
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      // O ruído entra também na leitura: a foto chega em 8 bits, e esticar o
      // contraste de um céu já quantizado alarga os degraus que o arquivo
      // trouxe. Meio nível de ruído aqui devolve a eles a largura de antes.
      const noise = NOISE[noiseRow + (x % NOISE_SIZE)];
      const jitter = noise * 0.5;
      const r0 = (pixels[p] + jitter) / 255;
      const g0 = (pixels[p + 1] + jitter) / 255;
      const b0 = (pixels[p + 2] + jitter) / 255;

      let r = (m[0] * r0 + m[1] * g0 + m[2] * b0) * scale + rowSum[0];
      let g = (m[3] * r0 + m[4] * g0 + m[5] * b0) * scale + rowSum[1];
      let b = (m[6] * r0 + m[7] * g0 + m[8] * b0) * scale + rowSum[2];

      if (tempAlpha) {
        // Mistura "overlay": mexe na cor sem lavar as altas luzes.
        r = r * (1 - tempAlpha) + overlay(r, tempColor[0]) * tempAlpha;
        g = g * (1 - tempAlpha) + overlay(g, tempColor[1]) * tempAlpha;
        b = b * (1 - tempAlpha) + overlay(b, tempColor[2]) * tempAlpha;
      }
      if (fadeAlpha) {
        r = r * (1 - fadeAlpha) + fadeColor[0] * fadeAlpha;
        g = g * (1 - fadeAlpha) + fadeColor[1] * fadeAlpha;
        b = b * (1 - fadeAlpha) + fadeColor[2] * fadeAlpha;
      }
      if (vignette) {
        const dx = x - cx;
        const t = (Math.sqrt(dx * dx + dy * dy) - inner) / span;
        const dark = 1 - vignette * (t <= 0 ? 0 : t >= 1 ? 1 : t);
        r *= dark;
        g *= dark;
        b *= dark;
      }

      // E de novo na escrita: é isto que troca o degrau por uma transição que
      // o olho lê como contínua.
      pixels[p] = r * 255 + noise;
      pixels[p + 1] = g * 255 + noise;
      pixels[p + 2] = b * 255 + noise;
    }
  }
}

function overlay(base: number, src: number): number {
  return base < 0.5 ? 2 * base * src : 1 - 2 * (1 - base) * (1 - src);
}
