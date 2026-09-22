import { describe, expect, it } from 'vitest';
import { AlphaMask } from './contour';
import { findElements, maskFromPixels, suggestGapPx } from './split';

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

describe('maskFromPixels', () => {
  /** Pixels crus de uma imagem opaca, pintada por retângulo sobre um fundo. */
  function foto(
    w: number, h: number, fundo: [number, number, number],
    blocos: [number, number, number, number, [number, number, number]][],
  ): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = fundo[0]; rgba[i * 4 + 1] = fundo[1]; rgba[i * 4 + 2] = fundo[2]; rgba[i * 4 + 3] = 255;
    }
    for (const [x0, y0, bw, bh, cor] of blocos) {
      for (let y = y0; y < y0 + bh; y++) {
        for (let x = x0; x < x0 + bw; x++) {
          const o = (y * w + x) * 4;
          rgba[o] = cor[0]; rgba[o + 1] = cor[1]; rgba[o + 2] = cor[2]; rgba[o + 3] = 255;
        }
      }
    }
    return rgba;
  }

  it('deduz o fundo pela borda quando a imagem é opaca — e aí a folha divide', () => {
    // dois desenhos escuros sobre fundo branco, sem alpha nenhum (caso do JPG)
    const rgba = foto(120, 60, [255, 255, 255], [
      [10, 20, 20, 20, [40, 40, 40]],
      [70, 20, 20, 20, [40, 40, 40]],
    ]);
    const { mask, fromAlpha } = maskFromPixels(rgba, 120, 60);
    expect(fromAlpha).toBe(false);
    expect(findElements(mask, { gapPx: 4 })).toHaveLength(2);
  });

  it('mantém buraco interno como desenho: só o fundo ligado à borda sai', () => {
    const rgba = foto(60, 60, [255, 255, 255], [
      [10, 10, 30, 30, [0, 0, 0]],
      [20, 20, 10, 10, [255, 255, 255]], // miolo branco, ilhado
    ]);
    const { mask } = maskFromPixels(rgba, 60, 60);
    expect(mask.data[25 * 60 + 25]).toBe(255);
    expect(mask.data[2 * 60 + 2]).toBe(0);
  });

  it('usa o alpha quando a arte já tem fundo removido', () => {
    const rgba = foto(60, 60, [255, 255, 255], []);
    for (let i = 0; i < 60 * 60; i++) rgba[i * 4 + 3] = 0;
    for (let y = 10; y < 30; y++) {
      for (let x = 10; x < 30; x++) rgba[(y * 60 + x) * 4 + 3] = 255;
    }
    const { mask, fromAlpha } = maskFromPixels(rgba, 60, 60);
    expect(fromAlpha).toBe(true);
    expect(findElements(mask, { gapPx: 2 })).toHaveLength(1);
  });

  it('tolerância maior engole um fundo sujo de JPG', () => {
    const rgba = foto(120, 60, [250, 250, 250], [[10, 20, 20, 20, [40, 40, 40]]]);
    // ruído do JPG: uma faixa do fundo um pouco fora da cor dominante
    for (let x = 0; x < 120; x++) {
      const o = (30 * 120 + x) * 4;
      if (x < 5 || x > 60) { rgba[o] = 235; rgba[o + 1] = 235; rgba[o + 2] = 238; }
    }
    expect(findElements(maskFromPixels(rgba, 120, 60, { bgTolerance: 40 }).mask, { gapPx: 4 })).toHaveLength(1);
  });
});

describe('folhas reais', () => {
  /** Pixels opacos: fundo, uma moldura opcional e blocos de desenho. */
  function folha(
    w: number, h: number, fundo: [number, number, number],
    blocos: [number, number, number, number][], moldura?: [number, number, number],
  ): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(w * h * 4);
    const pinta = (i: number, [r, g, b]: [number, number, number]): void => {
      rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255;
    };
    for (let i = 0; i < w * h; i++) pinta(i, fundo);
    if (moldura) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3) pinta(y * w + x, moldura);
        }
      }
    }
    for (const [x0, y0, bw, bh] of blocos) {
      for (let y = y0; y < y0 + bh; y++) {
        for (let x = x0; x < x0 + bw; x++) pinta(y * w + x, [40, 60, 90]);
      }
    }
    return rgba;
  }

  it('atravessa a moldura colorida encostada na borda da imagem', () => {
    // moldura vermelha em volta (o quadro que o Canva exporta em volta da arte)
    const rgba = folha(160, 90, [255, 255, 255], [[20, 20, 30, 40], [100, 20, 30, 40]], [200, 20, 30]);
    const { mask } = maskFromPixels(rgba, 160, 90);
    const elementos = findElements(mask, { gapPx: 4 });
    expect(elementos).toHaveLength(2);
    // a própria moldura não pode virar elemento
    expect(elementos.every((e) => e.w <= 40)).toBe(true);
  });

  it('separa uma folha cheia: 4 × 5 adesivos viram 20 elementos', () => {
    const blocos: [number, number, number, number][] = [];
    for (let linha = 0; linha < 4; linha++) {
      for (let coluna = 0; coluna < 5; coluna++) blocos.push([15 + coluna * 45, 15 + linha * 45, 30, 30]);
    }
    const rgba = folha(250, 200, [255, 255, 255], blocos);
    const elementos = findElements(maskFromPixels(rgba, 250, 200).mask, { gapPx: 6 });
    expect(elementos).toHaveLength(20);
    // ordem de leitura: o primeiro é o do canto superior esquerdo
    expect([elementos[0].x, elementos[0].y]).toEqual([15, 15]);
    expect([elementos[19].x, elementos[19].y]).toEqual([195, 150]);
  });
});

describe('agrupamento por distância', () => {
  /** Duas faixas largas, uma sobre a outra, cada uma com um "corpo" numa ponta:
   * as caixas se cruzam na horizontal, mas o desenho nunca se encosta. */
  function faixas(): AlphaMask {
    const w = 200, h = 120;
    const data = new Uint8Array(w * h);
    const pinta = (x0: number, y0: number, bw: number, bh: number): void => {
      for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) data[y * w + x] = 255;
    };
    pinta(10, 10, 180, 6);   // faixa de cima, atravessa a largura toda
    pinta(10, 16, 30, 24);   // corpo de cima
    pinta(10, 80, 180, 6);   // faixa de baixo
    pinta(150, 86, 30, 24);  // corpo de baixo
    return { data, w, h };
  }

  it('não cola dois desenhos só porque as caixas deles se cruzam', () => {
    // pela caixa os dois ocupam quase a mesma área; pelo desenho há 64 px entre eles
    expect(findElements(faixas(), { gapPx: 8, minAreaPx: 16 })).toHaveLength(2);
  });

  it('o vão continua juntando o que está perto de verdade', () => {
    const w = 120, h = 60;
    const data = new Uint8Array(w * h);
    for (let y = 20; y < 40; y++) for (let x = 10; x < 30; x++) data[y * w + x] = 255;
    for (let y = 14; y < 18; y++) for (let x = 14; x < 20; x++) data[y * w + x] = 255; // 2 px acima
    expect(findElements({ data, w, h }, { gapPx: 4, minAreaPx: 16 })).toHaveLength(1);
    expect(findElements({ data, w, h }, { gapPx: 0, minAreaPx: 16 })).toHaveLength(2);
  });
});

describe('suggestGapPx', () => {
  /** Grade de blocos com `vao` px entre eles. */
  function grade(colunas: number, linhas: number, bloco: number, vao: number): AlphaMask {
    const w = colunas * (bloco + vao) + vao;
    const h = linhas * (bloco + vao) + vao;
    const data = new Uint8Array(w * h);
    for (let l = 0; l < linhas; l++) {
      for (let c = 0; c < colunas; c++) {
        const x0 = vao + c * (bloco + vao);
        const y0 = vao + l * (bloco + vao);
        for (let y = y0; y < y0 + bloco; y++) for (let x = x0; x < x0 + bloco; x++) data[y * w + x] = 255;
      }
    }
    return { data, w, h };
  }

  const candidatos = { autoGapCandidatesPx: [0, 2, 4, 6, 10, 16, 24], minAreaPx: 16 };

  it('numa folha apertada escolhe um vão que não cola os vizinhos', () => {
    // 20 blocos com só 4 px entre eles: acima disso vira um bloco só
    const mask = grade(5, 4, 20, 4);
    const gap = suggestGapPx(mask, candidatos);
    expect(findElements(mask, { ...candidatos, gapPx: gap })).toHaveLength(20);
  });

  it('num desenho picado escolhe um vão que junta os cacos', () => {
    // pares de blocos separados por 2 px, com 30 px entre os pares
    const w = 260, h = 60;
    const data = new Uint8Array(w * h);
    const pinta = (x0: number, bw: number): void => {
      for (let y = 20; y < 40; y++) for (let x = x0; x < x0 + bw; x++) data[y * w + x] = 255;
    };
    for (const base of [10, 100, 190]) { pinta(base, 20); pinta(base + 22, 20); }
    const mask: AlphaMask = { data, w, h };
    const gap = suggestGapPx(mask, candidatos);
    expect(gap).toBeGreaterThanOrEqual(2);
    expect(findElements(mask, { ...candidatos, gapPx: gap })).toHaveLength(3);
  });
});
