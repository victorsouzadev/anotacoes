import { describe, expect, it } from 'vitest';
import { AlphaMask } from './contour';
import { findElements } from './split';

/** Máscara vazia com blocos opacos pintados por retângulo. */
function comBlocos(w: number, h: number, blocos: [number, number, number, number][]): AlphaMask {
  const data = new Uint8Array(w * h);
  for (const [x0, y0, bw, bh] of blocos) {
    for (let y = y0; y < y0 + bh; y++) {
      for (let x = x0; x < x0 + bw; x++) data[y * w + x] = 255;
    }
  }
  return { data, w, h };
}

describe('findElements', () => {
  it('separa uma folha de 6 desenhos em 6 elementos', () => {
    const blocos: [number, number, number, number][] = [];
    for (let linha = 0; linha < 2; linha++) {
      for (let coluna = 0; coluna < 3; coluna++) {
        blocos.push([10 + coluna * 40, 10 + linha * 40, 20, 20]);
      }
    }
    const elementos = findElements(comBlocos(140, 100, blocos), { gapPx: 4 });
    expect(elementos).toHaveLength(6);
    for (const el of elementos) {
      expect(el.w).toBe(20);
      expect(el.h).toBe(20);
      expect(el.area).toBe(400);
    }
  });

  it('entrega os elementos em ordem de leitura', () => {
    const elementos = findElements(
      comBlocos(140, 100, [[50, 10, 20, 20], [10, 12, 20, 20], [10, 60, 20, 20]]),
      { gapPx: 4 },
    );
    expect(elementos.map((e) => [e.x, e.y])).toEqual([[10, 12], [50, 10], [10, 60]]);
  });

  it('junta pedaços soltos do mesmo desenho quando o vão cabe na folga', () => {
    // corpo e "estrela" solta 3 px acima; o outro desenho fica a 30 px
    const mask = comBlocos(120, 60, [[10, 20, 20, 20], [14, 13, 6, 4], [70, 20, 20, 20]]);
    expect(findElements(mask, { gapPx: 6, minAreaPx: 16 })).toHaveLength(2);
    expect(findElements(mask, { gapPx: 0, minAreaPx: 16 })).toHaveLength(3);
  });

  it('descarta sujeira menor que a área mínima', () => {
    const mask = comBlocos(120, 60, [[10, 10, 20, 20], [80, 40, 2, 2]]);
    expect(findElements(mask, { gapPx: 2, minAreaPx: 64 })).toHaveLength(1);
  });

  it('folga o recorte sem passar dos limites da imagem', () => {
    const [el] = findElements(comBlocos(60, 60, [[0, 0, 20, 20]]), { padPx: 5 });
    expect([el.x, el.y, el.w, el.h]).toEqual([0, 0, 25, 25]);
  });
});
