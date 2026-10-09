import { describe, expect, it } from 'vitest';
import { flattenPath, pathsBounds } from '../imagem/illustration-model';
import { Point } from './geometria';
import { comoCapsula, comoCirculo, endireitarDobra, regularizarContorno, regularizarFuro, REGULARIZAR_PADRAO } from './regularizar';
import { linha, poligono } from './geometria';

/** Ruído determinístico, como o serrilhado de um traço copiado de pixel. */
const ruido = (i: number, amp: number): number => amp * Math.sin(i * 12.9898) * Math.cos(i * 4.1414);

describe('regularizar', () => {
  it('círculo ondulado vira círculo exato com o raio médio', () => {
    const pts: Point[] = Array.from({ length: 60 }, (_, i) => {
      const a = (i / 60) * Math.PI * 2;
      const r = 3 + ruido(i, 0.15);
      return [10 + r * Math.cos(a), 20 + r * Math.sin(a)];
    });
    const c = comoCirculo(pts)!;
    for (const [x, y] of flattenPath(c, 0.1)) expect(Math.hypot(x - 10, y - 20)).toBeCloseTo(3, 1);
    // quadrado não é círculo
    expect(comoCirculo([[0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [5, 10], [0, 10], [0, 5], [0, 0.1]])).toBeNull();
  });

  it('fenda em cápsula vira cápsula exata, alinhada', () => {
    const pts: Point[] = [];
    for (let i = 0; i <= 40; i++) pts.push([i * 0.5, -1 + ruido(i, 0.05)]);
    for (let i = 0; i <= 20; i++) { const a = -Math.PI / 2 + (i / 20) * Math.PI; pts.push([20 + Math.cos(a), Math.sin(a)]); }
    for (let i = 40; i >= 0; i--) pts.push([i * 0.5, 1 + ruido(i + 7, 0.05)]);
    for (let i = 0; i <= 20; i++) { const a = Math.PI / 2 + (i / 20) * Math.PI; pts.push([Math.cos(a), Math.sin(a)]); }
    const c = comoCapsula(pts, REGULARIZAR_PADRAO)!;
    const b = pathsBounds([c])!;
    expect(b.minX).toBeCloseTo(-1, 1);
    expect(b.maxX).toBeCloseTo(21, 1);
    expect(b.maxY - b.minY).toBeCloseTo(2, 1);
  });

  it('retângulo serrilhado com cantos arredondados: retas exatas e arcos nos cantos', () => {
    // 40 × 20 com cantos de raio 3, borda tremida de ±0,1 mm e um degrau de 0,3 mm
    const pts: Point[] = [];
    const r = 3;
    const arco = (cx: number, cy: number, a0: number) => {
      for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * (Math.PI / 2); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    };
    for (let x = r; x <= 40 - r; x += 0.5) pts.push([x, ruido(x * 10, 0.1) + (x > 20 ? 0.3 : 0)]);
    arco(40 - r, r, -Math.PI / 2);
    for (let y = r; y <= 20 - r; y += 0.5) pts.push([40 + ruido(y * 10, 0.1), y]);
    arco(40 - r, 20 - r, 0);
    for (let x = 40 - r; x >= r; x -= 0.5) pts.push([x, 20 + ruido(x * 7, 0.1)]);
    arco(r, 20 - r, Math.PI / 2);
    for (let y = 20 - r; y >= r; y -= 0.5) pts.push([ruido(y * 3, 0.1), y]);
    arco(r, r, Math.PI);
    const out = regularizarContorno(poligono(pts));
    const retas = out.segments.filter((s) => !s.c1);
    // quatro retas, horizontais e verticais exatas
    expect(retas.length).toBe(4);
    let de = out.start;
    for (const s of out.segments) {
      if (!s.c1) {
        const dx = Math.abs(s.to[0] - de[0]), dy = Math.abs(s.to[1] - de[1]);
        expect(Math.min(dx, dy)).toBeLessThan(1e-9);
      }
      de = s.to;
    }
    // os cantos são arcos de raio ~3 (o ponto do meio do arco fica a r·(√2−1) da quina)
    const flat = flattenPath(out, 0.05);
    const perto = Math.min(...flat.map(([x, y]) => Math.hypot(x - 40, y - 20)));
    expect(perto).toBeGreaterThan(0.9);
    expect(perto).toBeLessThan(1.6);
    // e fecha onde começa
    expect(Math.hypot(out.segments[out.segments.length - 1].to[0] - out.start[0], out.segments[out.segments.length - 1].to[1] - out.start[1])).toBeLessThan(1e-6);
  });

  it('furo genérico cai no contorno regularizado; dobra quase vertical fica vertical', () => {
    const tri = regularizarFuro(poligono([[0, 0], [10, 0], [5, 8]]));
    expect(tri.segments.length).toBeGreaterThanOrEqual(3);
    const d = endireitarDobra(linha([5, 0], [5.2, 50]));
    expect(d.start[0]).toBeCloseTo(d.segments[0].to[0], 9);
    const diag = endireitarDobra(linha([0, 0], [10, 10]));
    expect(diag.segments[0].to).toEqual([10, 10]);
  });
});
