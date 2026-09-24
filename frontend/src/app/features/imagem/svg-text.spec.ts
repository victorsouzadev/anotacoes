import { describe, expect, it } from 'vitest';
import { flattenPath, pathsBounds } from './illustration-model';
import { FontLike, GlyphCommand, GlyphLike, TextSpec, commandsToPaths, layoutText } from './svg-text';

/** Fonte de mentira: todo glifo é uma caixa de 500 × 700 unidades (em = 1000)
 * encostada na linha de base, e o par "AV" tem kerning de -100. */
function fakeFont(): FontLike {
  const glyph = (ch: string): GlyphLike => ({
    advanceWidth: ch === ' ' ? 250 : 500,
    unicode: ch.codePointAt(0),
    getPath(x: number, y: number, size: number) {
      if (ch === ' ') return { commands: [] };
      const s = size / 1000;
      const cmds: GlyphCommand[] = [
        { type: 'M', x: x, y: y },
        { type: 'L', x: x + 500 * s, y: y },
        { type: 'L', x: x + 500 * s, y: y - 700 * s },
        { type: 'L', x: x, y: y - 700 * s },
        { type: 'Z' },
      ];
      return { commands: cmds };
    },
  });
  return {
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    stringToGlyphs: (text: string) => [...text].map(glyph),
    getKerningValue: (a: GlyphLike, b: GlyphLike) => (a.unicode === 65 && b.unicode === 86 ? -100 : 0),
  };
}

const base: TextSpec = { text: 'AB', sizeMm: 10, tracking: 0, lineHeight: 1.2, align: 'center', curve: 'reta', bend: 0, guide: null, guideOffset: 0 };

describe('commandsToPaths', () => {
  it('quadrática vira cúbica com o mesmo fim e fecha o contorno', () => {
    const paths = commandsToPaths(
      [{ type: 'M', x: 0, y: 0 }, { type: 'Q', x1: 5, y1: 10, x: 10, y: 0 }, { type: 'Z' }],
      (p) => p,
    );
    expect(paths).toHaveLength(1);
    const seg = paths[0].segments[0];
    expect(seg.to).toEqual([10, 0]);
    expect(seg.c1![0]).toBeCloseTo(10 / 3);
    expect(seg.c1![1]).toBeCloseTo(20 / 3);
    // trecho de volta até o começo
    expect(paths[0].segments[1].to).toEqual([0, 0]);
    expect(paths[0].closed).toBe(true);
  });
});

describe('layoutText', () => {
  it('diagrama na largura certa e centra na caixa de métricas', () => {
    const l = layoutText(fakeFont(), base);
    expect(l.glyphs).toHaveLength(2);
    const b = pathsBounds(l.paths)!;
    expect(b.maxX - b.minX).toBeCloseTo(10, 6);
    expect(b.minX).toBeCloseTo(-5, 6);
    // caixa de métricas: de -8 (ascendente) a +2 (descendente) → centro em -3
    expect(b.maxY).toBeCloseTo(3, 6);
    expect(l.chars).toEqual(['A', 'B']);
  });

  it('aplica kerning e espaçamento entre letras', () => {
    const kern = pathsBounds(layoutText(fakeFont(), { ...base, text: 'AV' }).paths)!;
    expect(kern.maxX - kern.minX).toBeCloseTo(9, 6);
    const tracked = pathsBounds(layoutText(fakeFont(), { ...base, tracking: 200 }).paths)!;
    expect(tracked.maxX - tracked.minX).toBeCloseTo(12, 6);
  });

  it('empilha linhas pela entrelinha e alinha cada uma', () => {
    const l = layoutText(fakeFont(), { ...base, text: 'AAAA\nA', align: 'left' });
    const first = pathsBounds(l.glyphs[0])!;
    const last = pathsBounds(l.glyphs[4])!;
    expect(last.minY - first.minY).toBeCloseTo(12, 6);
    expect(last.minX).toBeCloseTo(first.minX, 6);
    const right = layoutText(fakeFont(), { ...base, text: 'AAAA\nA', align: 'right' });
    expect(pathsBounds(right.glyphs[4])!.maxX).toBeCloseTo(pathsBounds(right.glyphs[3])!.maxX, 6);
  });

  it('espaço conta na largura mas não gera contorno', () => {
    const l = layoutText(fakeFont(), { ...base, text: 'A B' });
    expect(l.glyphs[1]).toHaveLength(0);
    const b = pathsBounds(l.paths)!;
    expect(b.maxX - b.minX).toBeCloseTo(12.5, 6);
  });

  it('no arco, a base de cada letra fica no círculo', () => {
    const spec: TextSpec = { ...base, text: 'ABCDEF', curve: 'arco', bend: 50 };
    const l = layoutText(fakeFont(), spec);
    // largura 30 mm abraçando meio círculo → R = 30/π; o centro fica abaixo
    const R = 30 / Math.PI;
    const b = pathsBounds(l.paths)!;
    expect(b.maxX - b.minX).toBeGreaterThan(R * 1.5);
    // o topo da linha (letras do meio) fica acima das pontas: curva pra cima
    const mid = pathsBounds(l.glyphs[2])!;
    const end = pathsBounds(l.glyphs[5])!;
    expect(mid.minY).toBeLessThan(end.minY);
    const downward = layoutText(fakeFont(), { ...spec, bend: -50 });
    expect(pathsBounds(downward.glyphs[2])!.minY).toBeGreaterThan(pathsBounds(downward.glyphs[5])!.minY);
  });

  it('segue o caminho-guia a partir do ponto de início', () => {
    const guide = { start: [0, 0] as [number, number], closed: false, segments: [{ c1: null, c2: null, to: [100, 0] as [number, number] }] };
    const l = layoutText(fakeFont(), { ...base, curve: 'caminho', align: 'left', guide, guideOffset: 0.5 });
    const first = pathsBounds(l.glyphs[0])!;
    expect(first.minX).toBeCloseTo(50, 1);
    expect(first.maxY).toBeCloseTo(0, 6);
    // glifo que cai fora do caminho aberto some
    const off = layoutText(fakeFont(), { ...base, text: 'AAAAAAAAAAAAAAAAAAAAAAAAAA', curve: 'caminho', align: 'left', guide, guideOffset: 0.9 });
    expect(off.glyphs.filter((g) => g.length).length).toBeLessThan(26);
    expect(flattenPath(l.paths[0]).length).toBeGreaterThan(3);
  });
});
