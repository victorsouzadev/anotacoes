import { describe, expect, it } from 'vitest';
import { polygonArea } from './contour';
import { flattenPath, pathsBounds } from './illustration-model';
import {
  DEFAULT_PARAMS, RgbaImage, analyzeImage, catmullRom, kmeans, otsuThreshold, presetParams, suggestPreset, thin,
  traceSkeleton, vectorize,
} from './vectorize';

type Rgba = [number, number, number, number];

function image(w: number, h: number, px: (x: number, y: number) => Rgba): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4);
  }
  return { data, w, h };
}

const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [20, 20, 20, 255];
const RED: Rgba = [220, 40, 40, 255];
const BLUE: Rgba = [30, 60, 200, 255];

/** Logo: um quadrado vermelho e um círculo azul em fundo branco. */
const logo = image(120, 80, (x, y) => {
  if (x >= 10 && x < 50 && y >= 20 && y < 60) return RED;
  if (Math.hypot(x - 85, y - 40) < 20) return BLUE;
  return WHITE;
});

/** Desenho a traço: um anel preto de 6 px em fundo branco. */
const ring = image(100, 100, (x, y) => {
  const r = Math.hypot(x - 50, y - 50);
  return r > 30 && r < 36 ? BLACK : WHITE;
});

function area(paths: { segments: unknown[] }[]): number {
  return paths.reduce((s, p) => s + Math.abs(polygonArea(flattenPath(p as never, 0.5))), 0);
}

describe('análise e sugestão', () => {
  it('limiar de Otsu cai entre os dois picos', () => {
    const hist = new Array(256).fill(0);
    hist[30] = 500;
    hist[220] = 800;
    const t = otsuThreshold(hist);
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThan(220);
  });

  it('k-means acha as cores de um logo', () => {
    const centers = kmeans([...Array(300)].map((_, i) => (i % 3 === 0 ? [255, 0, 0] : i % 3 === 1 ? [0, 0, 255] : [255, 255, 255]) as [number, number, number]), 3);
    const hex = centers.map((c) => c.map(Math.round).join(',')).sort();
    expect(hex).toEqual(['0,0,255', '255,0,0', '255,255,255']);
  });

  it('logo de poucas cores chapadas vira preset de logo, com fundo removível', () => {
    const stats = analyzeImage(logo);
    expect(stats.effectiveColors).toBeLessThanOrEqual(4);
    expect(stats.flatness).toBeGreaterThan(0.9);
    expect(stats.plainBackground).toBe(true);
    const s = suggestPreset(stats);
    expect(s.preset).toBe('logo');
    expect(s.params.removeBackground).toBe(true);
  });

  it('preto e branco vira desenho a traço', () => {
    expect(suggestPreset(analyzeImage(ring)).preset).toBe('traco');
  });

  it('foto com degradê contínuo vira foto', () => {
    const photo = image(90, 90, (x, y) => [(x * 2.8) | 0, (y * 2.8) | 0, ((x + y) * 1.4) | 0, 255]);
    expect(suggestPreset(analyzeImage(photo)).preset).toBe('foto');
  });
});

describe('vetorização em cores', () => {
  it('uma camada por cor, sem a do fundo, na cor certa', () => {
    const out = vectorize(logo, { ...presetParams('logo', analyzeImage(logo)), colors: 3 });
    expect(out.layers).toHaveLength(2);
    const colors = out.layers.map((l) => l.color);
    expect(colors.some((c) => parseInt(c.slice(1, 3), 16) > 180)).toBe(true);
    expect(colors.some((c) => parseInt(c.slice(5, 7), 16) > 160)).toBe(true);
  });

  it('camadas empilhadas: a de trás cobre também a área das de cima', () => {
    // alvo: círculo vermelho dentro de quadrado azul, sem fundo
    const target = image(80, 80, (x, y) => {
      if (Math.hypot(x - 40, y - 40) < 12) return RED;
      if (x >= 10 && x < 70 && y >= 10 && y < 70) return BLUE;
      return WHITE;
    });
    const out = vectorize(target, { ...DEFAULT_PARAMS, colors: 3, removeBackground: true });
    expect(out.layers).toHaveLength(2);
    // a de trás (maior) não tem furo: cobre o círculo também
    expect(out.layers[0].paths).toHaveLength(1);
    expect(area(out.layers[0].paths)).toBeGreaterThan(60 * 60 * 0.97);
    // círculo de raio 12 amostrado no centro do pixel: ~3% de folga
    expect(Math.abs(area(out.layers[1].paths) / (Math.PI * 144) - 1)).toBeLessThan(0.06);
  });
});

describe('traço e silhueta', () => {
  it('anel vira contorno de fora e furo', () => {
    const out = vectorize(ring, { ...presetParams('traco', null) });
    expect(out.layers).toHaveLength(1);
    const paths = out.layers[0].paths;
    expect(paths).toHaveLength(2);
    const [a, b] = paths.map((p) => Math.abs(polygonArea(flattenPath(p, 0.5)))).sort((x, y) => y - x);
    expect(Math.sqrt(a / Math.PI)).toBeCloseTo(36, -0.5);
    expect(Math.sqrt(b / Math.PI)).toBeCloseTo(30, -0.5);
  });

  it('silhueta pelo alpha, fechando os vãos', () => {
    const donut = image(80, 80, (x, y) => {
      const r = Math.hypot(x - 40, y - 40);
      return r < 30 && r > 10 ? [200, 100, 0, 255] : [0, 0, 0, 0];
    });
    const out = vectorize(donut, { ...presetParams('silhueta', null) });
    expect(out.layers[0].paths).toHaveLength(1);
    const b = pathsBounds(out.layers[0].paths)!;
    expect(b.maxX - b.minX).toBeCloseTo(60, -0.5);
    const holes = vectorize(donut, { ...presetParams('silhueta', null), keepHoles: true });
    expect(holes.layers[0].paths).toHaveLength(2);
  });

  it('silhueta sem alpha usa a diferença do fundo', () => {
    const out = vectorize(logo, { ...presetParams('silhueta', null) });
    expect(out.layers[0].paths).toHaveLength(2);
  });
});

describe('linha central', () => {
  it('afinamento deixa 1 px de largura', () => {
    const w = 40, h = 20;
    const bin = new Uint8Array(w * h);
    for (let y = 7; y < 13; y++) for (let x = 5; x < 35; x++) bin[y * w + x] = 1;
    const skel = thin(bin, w, h);
    for (let x = 10; x < 30; x++) {
      let col = 0;
      for (let y = 0; y < h; y++) col += skel[y * w + x];
      expect(col).toBe(1);
    }
    const { lines } = traceSkeleton(skel, w, h);
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it('traço grosso vira uma linha só, com a espessura medida', () => {
    const img = image(120, 40, (x, y) => (x >= 10 && x < 110 && y >= 16 && y < 24 ? BLACK : WHITE));
    const out = vectorize(img, { ...presetParams('centro', null) });
    expect(out.layers).toHaveLength(1);
    const layer = out.layers[0];
    expect(layer.stroke).toBe(true);
    expect(layer.paths).toHaveLength(1);
    expect(layer.paths[0].closed).toBe(false);
    const b = pathsBounds(layer.paths)!;
    expect(b.maxX - b.minX).toBeGreaterThan(85);
    expect(b.maxY - b.minY).toBeLessThan(3);
    expect(layer.strokeWidthPx).toBeGreaterThan(5);
    expect(layer.strokeWidthPx).toBeLessThan(11);
  });

  it('anel vira laço fechado', () => {
    const out = vectorize(ring, { ...presetParams('centro', null) });
    const closed = out.layers[0].paths.filter((p) => p.closed);
    expect(closed).toHaveLength(1);
    const b = pathsBounds(closed)!;
    expect((b.maxX - b.minX) / 2).toBeCloseTo(33, -0.5);
  });

  it('Catmull-Rom passa pelos pontos', () => {
    const p = catmullRom([[0, 0], [10, 5], [20, 0]], false);
    expect(p.segments).toHaveLength(2);
    expect(p.segments[0].to).toEqual([10, 5]);
  });
});
