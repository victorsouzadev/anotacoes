import { describe, expect, it } from 'vitest';
import { buildDxf, cubicToPolyline, pageFrame } from './dxf';

describe('DXF pra Silhouette', () => {
  it('achata a curva perto do círculo de verdade', () => {
    // quarto de círculo de raio 50 mm em Bézier
    const k = 0.5522847498 * 50;
    const pts = cubicToPolyline({ start: [50, 0], segments: [{ c1: [50, k], c2: [k, 50], to: [0, 50] }] });
    expect(pts.length).toBeGreaterThan(8);
    for (const [x, y] of pts) expect(Math.abs(Math.hypot(x, y) - 50)).toBeLessThan(0.1);
  });

  it('escreve camadas, polilinha fechada e inverte o Y pela altura da página', () => {
    const dxf = buildDxf([pageFrame(210, 297), { layer: 'CORTE', closed: true, points: [[10, 20], [30, 20], [30, 40], [10, 20]] }],
      [{ name: 'CORTE', color: 1 }, { name: 'PAGINA', color: 8 }], 297);
    const lines = dxf.split('\r\n');
    expect(lines[0]).toBe('0');
    expect(lines[1]).toBe('SECTION');
    expect(lines).toContain('AC1009');
    expect(dxf).toContain('CORTE\r\n70\r\n0\r\n62\r\n1');
    // y = 20 mm do topo vira 277 no DXF
    expect(dxf).toContain('10\r\n10\r\n20\r\n277\r\n');
    // o ponto repetido no fim de uma fechada sai
    expect((dxf.match(/VERTEX/g) ?? []).length).toBe(4 + 3);
    expect(lines[lines.length - 2]).toBe('EOF');
  });
});
