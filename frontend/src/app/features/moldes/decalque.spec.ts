import { describe, expect, it } from 'vitest';
import { flattenPath, pathsBounds } from '../imagem/illustration-model';
import { Cinza, aplicarH, decalcar, homografia, juntarTracos, otsu, retificar, OPCOES_PADRAO } from './decalque';
import { Point } from './geometria';

/** Folha branca com desenho em preto, à mão de pixel. */
function folha(w: number, h: number): Cinza & { pintar(x0: number, y0: number, x1: number, y1: number): void; anel(cx: number, cy: number, r: number, e: number): void } {
  const data = new Uint8Array(w * h).fill(255);
  return {
    data, w, h,
    pintar(x0, y0, x1, y1) {
      for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) data[y * w + x] = 20;
    },
    anel(cx, cy, r, e) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d >= r - e / 2 && d <= r + e / 2) data[y * w + x] = 20;
      }
    },
  };
}

describe('perspectiva', () => {
  it('homografia leva os quatro cantos onde devem ir', () => {
    const de: Point[] = [[10, 20], [300, 5], [320, 410], [0, 380]];
    const para: Point[] = [[0, 0], [210, 0], [210, 297], [0, 297]];
    const H = homografia(de, para);
    de.forEach((p, i) => {
      const q = aplicarH(H, p);
      expect(q[0]).toBeCloseTo(para[i][0], 6);
      expect(q[1]).toBeCloseTo(para[i][1], 6);
    });
  });

  it('retificar endireita um retângulo inclinado', () => {
    // um quadrado escuro no meio de uma foto "torta" volta pro meio da saída
    const src = folha(200, 200);
    src.pintar(90, 90, 110, 110);
    const out = retificar(src, [[20, 10], [190, 30], [180, 190], [10, 170]], 100, 100);
    expect(out.data[50 * 100 + 50]).toBeLessThan(100);
    expect(out.data[5 * 100 + 5]).toBe(255);
  });

  it('otsu separa tinta de papel', () => {
    const g = folha(50, 50);
    g.pintar(0, 0, 10, 50);
    const t = otsu(g);
    expect(t).toBeGreaterThanOrEqual(20);
    expect(t).toBeLessThan(255);
  });
});

describe('tracejado', () => {
  it('emenda traços alinhados e não emenda os de lado', () => {
    const tracos: Point[][] = [[[0, 0], [10, 0]], [[14, 0], [24, 0]], [[28, 0.3], [38, 0.3]], [[14, 20], [24, 20]]];
    const out = juntarTracos(tracos, 6, 20, 1);
    expect(out).toHaveLength(2);
    const longa = out.find((l) => l.length > 2)!;
    expect(longa[0]).toEqual([0, 0]);
    expect(longa[longa.length - 1]).toEqual([38, 0.3]);
  });
});

describe('decalque', () => {
  // 4 px por mm: 150 × 100 mm
  const k = 4;
  const g = folha(600, 400);
  // contorno do molde, traço de 3 px
  g.pintar(40, 40, 560, 43); g.pintar(40, 357, 560, 360); g.pintar(40, 40, 43, 360); g.pintar(557, 40, 560, 360);
  // dobra tracejada vertical (4 mm de traço, 2 mm de vão)
  for (let y = 52; y < 350; y += 24) g.pintar(299, y, 302, y + 16);
  // dobra contínua horizontal, encostando no contorno da direita
  g.pintar(320, 199, 557, 202);
  // furo da fita
  g.anel(150, 200, 12, 3);

  const r = decalcar(g, { ...OPCOES_PADRAO, pxPorMm: k, limiar: otsu(g) });

  it('acha o contorno no meio do traço, em mm', () => {
    const contorno = r.linhas.filter((l) => l.origem === 'contorno');
    expect(contorno).toHaveLength(1);
    const b = pathsBounds([contorno[0].path])!;
    expect(b.minX).toBeCloseTo(41.5 / k, 0);
    expect(b.maxX).toBeCloseTo(558.5 / k, 0);
    expect(b.maxY).toBeCloseTo(358.5 / k, 0);
    expect(r.traco).toBeGreaterThan(0.5);
    expect(r.traco).toBeLessThan(1.2);
  });

  it('o anel fechado pequeno vira furo de corte', () => {
    const furos = r.linhas.filter((l) => l.origem === 'furo');
    expect(furos).toHaveLength(1);
    expect(furos[0].tipo).toBe('corte');
    for (const [x, y] of flattenPath(furos[0].path, 0.2)) expect(Math.hypot(x - 150 / k, y - 200 / k)).toBeCloseTo(12 / k, 0);
  });

  it('tracejado vira uma dobra só, esticada até o contorno', () => {
    const dobras = r.linhas.filter((l) => l.origem === 'interna');
    expect(dobras).toHaveLength(2);
    const vertical = dobras.find((d) => { const b = pathsBounds([d.path])!; return b.maxY - b.minY > 50; })!;
    const b = pathsBounds([vertical.path])!;
    expect((b.minX + b.maxX) / 2).toBeCloseTo(300.5 / k, 0);
    expect(b.minY).toBeLessThan(43 / k + 0.6);
    expect(b.maxY).toBeGreaterThan(357 / k - 0.6);
    const horizontal = dobras.find((d) => d !== vertical)!;
    const bh = pathsBounds([horizontal.path])!;
    expect(bh.maxX).toBeGreaterThan(557 / k - 0.6);
    expect(bh.minX).toBeCloseTo(320 / k, 0);
  });

  it('imagem em branco avisa em vez de inventar linha', () => {
    const vazia = decalcar(folha(100, 100), { ...OPCOES_PADRAO, pxPorMm: k, limiar: 128 });
    expect(vazia.linhas).toHaveLength(0);
    expect(vazia.avisos.length).toBe(1);
  });
});
