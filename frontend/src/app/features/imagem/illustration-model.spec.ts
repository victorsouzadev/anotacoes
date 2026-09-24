import { describe, expect, it } from 'vitest';
import {
  VPath, applyMatrix, centerPaths, ellipsePaths, flattenPath, invertMatrix, layerMatrix, normalizeHex,
  pathsBounds, pathsToD, rectPaths, reversePath, shapePaths, topFraction,
} from './illustration-model';
import { polygonArea } from './contour';

describe('pathsToD', () => {
  it('fecha com Z sem repetir o último trecho reto', () => {
    const d = pathsToD(rectPaths(10, 4, 0));
    expect(d).toBe('M-5 -2L5 -2L5 2L-5 2Z');
  });

  it('mantém o último trecho quando é curva e não fecha caminho aberto', () => {
    const open: VPath = { start: [0, 0], closed: false, segments: [{ c1: null, c2: null, to: [1, 1] }, { c1: [2, 0], c2: [3, 0], to: [4, 1] }] };
    expect(pathsToD([open])).toBe('M0 0L1 1C2 0 3 0 4 1');
    expect(pathsToD(ellipsePaths(2, 2)).endsWith('Z')).toBe(true);
    expect(pathsToD(ellipsePaths(2, 2)).match(/C/g)?.length).toBe(4);
  });
});

describe('matriz da camada', () => {
  it('ida e volta devolve o ponto', () => {
    const m = layerMatrix({ x: 12, y: -4, rotation: 33, scaleX: 1.7, scaleY: -0.6 });
    const p = applyMatrix(m, [3.2, -7.1]);
    const back = applyMatrix(invertMatrix(m), p);
    expect(back[0]).toBeCloseTo(3.2, 9);
    expect(back[1]).toBeCloseTo(-7.1, 9);
  });

  it('gira em sentido horário com y pra baixo', () => {
    const m = layerMatrix({ x: 0, y: 0, rotation: 90, scaleX: 1, scaleY: 1 });
    const p = applyMatrix(m, [1, 0]);
    expect(p[0]).toBeCloseTo(0, 9);
    expect(p[1]).toBeCloseTo(1, 9);
  });
});

describe('formas', () => {
  it('estrela e polígono ocupam exatamente a caixa pedida', () => {
    for (const shape of ['estrela', 'poligono'] as const) {
      const b = pathsBounds(shapePaths({ shape, w: 40, h: 30, radius: 0, points: 5, innerRatio: 0.4 }))!;
      expect(b.maxX - b.minX).toBeCloseTo(40, 6);
      expect(b.maxY - b.minY).toBeCloseTo(30, 6);
    }
  });

  it('elipse de Bézier fica a menos de 0,03% do círculo', () => {
    const pts = flattenPath(ellipsePaths(20, 20)[0], 0.05);
    for (const [x, y] of pts) expect(Math.abs(Math.hypot(x, y) - 10)).toBeLessThan(0.003);
    expect(Math.abs(polygonArea(pts))).toBeCloseTo(Math.PI * 100, 0);
  });

  it('retângulo arredondado tem a área do retângulo menos os cantos', () => {
    const pts = flattenPath(rectPaths(20, 10, 3)[0], 0.02);
    const esperado = 200 - (4 - Math.PI) * 9;
    expect(Math.abs(polygonArea(pts))).toBeCloseTo(esperado, 1);
  });
});

describe('utilidades', () => {
  it('recentra devolvendo o deslocamento', () => {
    const c = centerPaths(rectPaths(10, 10, 0).map((p) => ({ ...p, start: [p.start[0] + 20, p.start[1] + 5] as [number, number], segments: p.segments.map((s) => ({ ...s, to: [s.to[0] + 20, s.to[1] + 5] as [number, number] })) })));
    expect(c.cx).toBeCloseTo(20);
    expect(c.cy).toBeCloseTo(5);
    const b = pathsBounds(c.paths)!;
    expect(b.minX).toBeCloseTo(-5);
    expect(b.maxY).toBeCloseTo(5);
  });

  it('normaliza cor hex', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('#12aB9f')).toBe('#12ab9f');
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe('caminho-guia', () => {
  it('inverter percorre ao contrário sem mudar a forma', () => {
    const e = ellipsePaths(20, 10)[0];
    const r = reversePath(e);
    expect(r.start).toEqual(e.start);
    expect(r.segments[0].to).toEqual(e.segments[e.segments.length - 2].to);
    expect(polygonArea(flattenPath(r, 0.05))).toBeCloseTo(-polygonArea(flattenPath(e, 0.05)), 6);
    expect(reversePath(r)).toEqual(e);
  });

  it('acha o ponto mais alto da elipse a 3/4 da volta', () => {
    // começa na direita e desce (y pra baixo): o topo vem depois de 3/4
    expect(topFraction(ellipsePaths(20, 10)[0])).toBeCloseTo(0.75, 2);
  });
});
