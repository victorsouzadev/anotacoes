import { describe, expect, it } from 'vitest';
import { NestShape, nestShapes, rotateMask } from './sheet-nest';
import { buildPdf, pdfPathOps, registrationMarks } from './sheet';

function rect(id: string, w: number, h: number): NestShape {
  return { id, w, h, mask: new Uint8Array(w * h).fill(1) };
}

/** Um "L": coluna à esquerda e base embaixo. */
function ell(id: string, n: number, t: number): NestShape {
  const mask = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (x < t || y >= n - t) mask[y * n + x] = 1;
  return { id, w: n, h: n, mask };
}

describe('encaixe por silhueta', () => {
  it('gira a máscara 90° no sentido horário', () => {
    // 2×1: [a b] vira coluna [a; b]
    const r = rotateMask(new Uint8Array([1, 0]), 2, 1);
    expect([r.w, r.h]).toEqual([1, 2]);
    expect([...r.mask]).toEqual([1, 0]);
  });

  it('respeita margem e espaçamento entre peças', () => {
    const { placed } = nestShapes([rect('a', 10, 10), rect('b', 10, 10)], { sheetW: 40, sheetH: 20, margin: 2, spacing: 3, rotate: false });
    const [a, b] = [...placed].sort((p, q) => p.x - q.x);
    expect(a.x).toBe(2);
    expect(a.y).toBe(2);
    expect(b.x - (a.x + a.w)).toBeGreaterThanOrEqual(3);
  });

  it('dois L encaixam um no outro quando pode girar, e não cabem sem giro', () => {
    const shapes = [ell('a', 20, 6), ell('b', 20, 6)];
    const opts = { sheetW: 26, sheetH: 26, margin: 0, spacing: 0 };
    expect(nestShapes(shapes, { ...opts, rotate: true }).overflow).toEqual([]);
    expect(nestShapes(shapes, { ...opts, rotate: false }).overflow.length).toBe(1);
  });

  it('peça maior que a folha vai pro que sobrou', () => {
    const r = nestShapes([rect('grande', 50, 50)], { sheetW: 40, sheetH: 40, margin: 0, spacing: 0, rotate: true });
    expect(r.overflow).toEqual(['grande']);
  });
});

describe('PDF da folha', () => {
  it('escreve várias páginas com xref coerente', async () => {
    const pdf = buildPdf([
      { wMm: 210, hMm: 297, content: '' },
      { wMm: 210, hMm: 297, content: pdfPathOps([{ start: [0, 0], segments: [{ c1: null, c2: null, to: [10, 0] }] }], 297) },
    ]);
    const text = new TextDecoder('latin1').decode(new Uint8Array(await pdf.arrayBuffer()));
    expect(text).toContain('/Count 2');
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    // o ponto (0,0) do topo vira y = altura da página em pontos
    expect(text).toContain('0.00 841.89 m');
  });

  it('marcas de registro ficam dentro da faixa reservada', () => {
    for (const r of registrationMarks(210, 297)) {
      const nearEdge = r.x < 20 || r.y < 20 || r.x + r.w > 190 || r.y + r.h > 277;
      expect(nearEdge).toBe(true);
    }
  });
});
