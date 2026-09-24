import { describe, expect, it } from 'vitest';
import { polygonArea } from './contour';
import { VPath, ellipsePaths, flattenPath, polygonToVPath, rectPaths, translatePaths } from './illustration-model';
import {
  AreaSource, addNodeAfter, booleanPaths, cornerNode, deleteNode, fitPolygon, moveNode, nodeCount, nodeInfo,
  offsetOutline, smoothNode, splitIslands,
} from './vector-ops';

function fill(paths: VPath[]): AreaSource {
  return { paths, pad: 0, strokeOnly: false };
}

/** Área pintada com par-ímpar: soma com sinal relativo ao maior contorno. */
function area(paths: VPath[]): number {
  const polys = paths.map((p) => flattenPath(p, 0.02));
  const areas = polys.map((p) => polygonArea(p));
  const outer = Math.sign(areas.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0));
  return areas.reduce((s, a) => s + (Math.sign(a) === outer ? Math.abs(a) : -Math.abs(a)), 0);
}

const square = (x: number, y: number, s: number): VPath[] => translatePaths(rectPaths(s, s, 0), x, y);

describe('soldar e combinar', () => {
  it('solda dois quadrados sobrepostos numa peça só', () => {
    const out = booleanPaths('unir', [fill(square(0, 0, 10)), fill(square(5, 0, 10))]);
    expect(out).toHaveLength(1);
    expect(area(out)).toBeCloseTo(150, 0);
  });

  it('camadas sobrepostas não se anulam (cada uma é normalizada antes)', () => {
    const out = booleanPaths('unir', [fill(square(0, 0, 10)), fill(square(0, 0, 10))]);
    expect(area(out)).toBeCloseTo(100, 0);
  });

  it('subtrai o de cima do de baixo, deixando o furo', () => {
    const out = booleanPaths('subtrair', [fill(square(0, 0, 20)), fill(square(0, 0, 10))]);
    expect(out).toHaveLength(2);
    expect(area(out)).toBeCloseTo(300, 0);
  });

  it('interseção e exclusão', () => {
    const a = fill(square(0, 0, 10));
    const b = fill(square(5, 5, 10));
    expect(area(booleanPaths('intersecao', [a, b]))).toBeCloseTo(25, 0);
    expect(area(booleanPaths('excluir', [a, b]))).toBeCloseTo(150, 0);
  });

  it('respeita o furo par-ímpar da própria camada', () => {
    const ring = fill([...square(0, 0, 20), ...square(0, 0, 10)]);
    expect(area(booleanPaths('unir', [ring]))).toBeCloseTo(300, 0);
  });

  it('traço sem preenchimento conta pela faixa do traço', () => {
    const line: VPath = { start: [0, 0], closed: false, segments: [{ c1: null, c2: null, to: [10, 0] }] };
    const out = booleanPaths('unir', [{ paths: [line], pad: 1, strokeOnly: true }]);
    // faixa de 10 × 2 mais duas meias-luas de raio 1
    expect(area(out)).toBeCloseTo(20 + Math.PI, 0);
  });
});

describe('contorno com margem', () => {
  it('quadrado de 10 com 2 mm de margem tem cantos redondos', () => {
    const out = offsetOutline([fill(square(0, 0, 10))], 2, { outerOnly: true });
    expect(out).toHaveLength(1);
    expect(area(out)).toBeCloseTo(100 + 80 + Math.PI * 4, 0);
  });

  it('"só de fora" fecha o miolo; sem ele o furo continua', () => {
    const ring = [...ellipsePaths(40, 40), ...ellipsePaths(20, 20)];
    expect(offsetOutline([fill(ring)], 1, { outerOnly: true })).toHaveLength(1);
    expect(offsetOutline([fill(ring)], 1, { outerOnly: false })).toHaveLength(2);
  });

  it('junta peças que a margem encosta', () => {
    const out = offsetOutline([fill(square(0, 0, 10)), fill(square(13, 0, 10))], 2, { outerOnly: true });
    expect(out).toHaveLength(1);
  });
});

describe('ajuste de curvas', () => {
  it('quadrado continua com quinas (trechos retos entre elas)', () => {
    const p = fitPolygon([[0, 0], [10, 0], [10, 10], [0, 10]]);
    const b = flattenPath(p, 0.05);
    expect(Math.abs(polygonArea(b))).toBeCloseTo(100, 1);
    expect(p.segments.length).toBeLessThanOrEqual(8);
  });

  it('círculo vira poucas curvas e fica dentro da tolerância', () => {
    const poly = flattenPath(ellipsePaths(30, 30)[0], 0.05);
    const p = fitPolygon(poly);
    expect(p.segments.length).toBeLessThan(20);
    for (const [x, y] of flattenPath(p, 0.1)) expect(Math.abs(Math.hypot(x, y) - 15)).toBeLessThan(0.05);
  });
});

describe('separar formas', () => {
  it('cada ilha leva o próprio furo', () => {
    const paths = [...square(0, 0, 20), ...square(0, 0, 8), ...square(40, 0, 10)];
    const islands = splitIslands(paths);
    expect(islands).toHaveLength(2);
    expect(islands.map((i) => i.length).sort()).toEqual([1, 2]);
  });

  it('ilha dentro do furo vira peça própria', () => {
    const paths = [...square(0, 0, 30), ...square(0, 0, 20), ...square(0, 0, 6)];
    const islands = splitIslands(paths);
    expect(islands).toHaveLength(2);
  });
});

describe('edição de nós', () => {
  const sq = polygonToVPath([[0, 0], [10, 0], [10, 10], [0, 10]]);

  it('conta os nós de caminho fechado sem repetir o começo', () => {
    expect(nodeCount(sq)).toBe(4);
  });

  it('apaga um nó juntando os trechos vizinhos', () => {
    const tri = deleteNode(sq, 2)!;
    expect(nodeCount(tri)).toBe(3);
    expect(Math.abs(polygonArea(flattenPath(tri)))).toBeCloseTo(50);
    expect(deleteNode(deleteNode(tri, 0)!, 0)).toBeNull();
  });

  it('apagar o começo de caminho fechado mantém o resto', () => {
    const p = deleteNode(sq, 0)!;
    expect(nodeCount(p)).toBe(3);
    const nodes = [0, 1, 2].map((i) => nodeInfo(p, i).point);
    expect(nodes).not.toContainEqual([0, 0]);
    expect(nodes).toContainEqual([10, 0]);
    expect(Math.abs(polygonArea(flattenPath(p)))).toBeCloseTo(50);
  });

  it('mover o nó leva as alças junto', () => {
    const curvy = smoothNode(sq, 1);
    const before = nodeInfo(curvy, 1);
    const moved = nodeInfo(moveNode(curvy, 1, [12, 3]), 1);
    expect(moved.point).toEqual([12, 3]);
    expect(moved.handleIn![0] - before.handleIn![0]).toBeCloseTo(2);
    expect(moved.handleOut![1] - before.handleOut![1]).toBeCloseTo(3);
  });

  it('suavizar deixa as alças alinhadas; canto recolhe', () => {
    const s = nodeInfo(smoothNode(sq, 2), 2);
    const a = Math.atan2(s.point[1] - s.handleIn![1], s.point[0] - s.handleIn![0]);
    const b = Math.atan2(s.handleOut![1] - s.point[1], s.handleOut![0] - s.point[0]);
    expect(a).toBeCloseTo(b, 6);
    const c = cornerNode(smoothNode(sq, 2), 2);
    const info = nodeInfo(c, 2);
    expect(info.handleIn ?? info.point).toEqual(info.point);
  });

  it('acrescentar nó não muda a forma', () => {
    const circle = ellipsePaths(10, 10)[0];
    const more = addNodeAfter(circle, 1);
    expect(nodeCount(more)).toBe(5);
    expect(Math.abs(polygonArea(flattenPath(more, 0.01)))).toBeCloseTo(Math.abs(polygonArea(flattenPath(circle, 0.01))), 3);
  });
});
