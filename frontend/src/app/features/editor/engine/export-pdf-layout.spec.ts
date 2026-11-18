import { describe, expect, it } from 'vitest';
import { layoutPdf } from './export-pdf-layout';

describe('layoutPdf', () => {
  it('A4 em pé para conteúdo alto, encaixado na margem', () => {
    const l = layoutPdf({ minX: 0, minY: 0, maxX: 800, maxY: 3000 }, 'a4');
    expect(l.paisagem).toBe(false);
    expect([l.wMm, l.hMm]).toEqual([210, 297]);
    expect(l.pxW).toBe(1654);
    // a altura limita: 3000 * escala cabe na área útil
    expect(3000 * l.escala).toBeLessThanOrEqual(l.pxH);
    // o topo do conteúdo fica na margem de 12 mm
    expect((0 - l.offsetY) * l.escala).toBeCloseTo(12 * 200 / 25.4, 3);
  });

  it('paisagem quando o conteúdo é largo', () => {
    const l = layoutPdf({ minX: 100, minY: 100, maxX: 2100, maxY: 900 }, 'a4');
    expect(l.paisagem).toBe(true);
    expect([l.wMm, l.hMm]).toEqual([297, 210]);
    // centralizado na horizontal
    const esquerda = (100 - l.offsetX) * l.escala;
    const direita = l.pxW - (2100 - l.offsetX) * l.escala;
    expect(esquerda).toBeCloseTo(direita, 3);
  });

  it('uma linha de texto larga continua em pé', () => {
    expect(layoutPdf({ minX: 0, minY: 0, maxX: 800, maxY: 40 }, 'a4').paisagem).toBe(false);
  });

  it('não amplia além do tamanho real', () => {
    const l = layoutPdf({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 'a4');
    expect(l.escala).toBeCloseTo(200 / 96, 6);
  });

  it('página vazia sai A4 em branco', () => {
    const l = layoutPdf(null, 'conteudo');
    expect([l.wMm, l.hMm]).toEqual([210, 297]);
  });

  it('tamanho do conteúdo usa o conteúdo + borda em tamanho real', () => {
    const l = layoutPdf({ minX: 0, minY: 0, maxX: 960, maxY: 480 }, 'conteudo');
    expect(l.wMm).toBeCloseTo((960 + 80) * 25.4 / 96, 6);
    expect(l.hMm).toBeCloseTo((480 + 80) * 25.4 / 96, 6);
    expect(l.offsetX).toBe(-40);
  });
});
