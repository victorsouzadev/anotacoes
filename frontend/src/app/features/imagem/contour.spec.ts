import { describe, expect, it } from 'vitest';
import {
  AlphaMask, CubicSegment, Point, Polygon, polygonArea, polygonToCubics, polygonsToPathData, traceMask,
} from './contour';

/** Máscara de alpha preenchida por uma função — o traçado só olha o canal
 * alpha, então os testes não precisam de canvas nenhum. */
function mask(w: number, h: number, alpha: (x: number, y: number) => number): AlphaMask {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data[y * w + x] = Math.max(0, Math.min(255, Math.round(alpha(x, y))));
  }
  return { data, w, h };
}

/** Virada (em graus) do contorno no vértice `i`, com os vizinhos imediatos. */
function turnAt(poly: Polygon, i: number): number {
  const n = poly.length;
  const a = poly[(i - 1 + n) % n];
  const b = poly[i];
  const c = poly[(i + 1) % n];
  const ax = b[0] - a[0], ay = b[1] - a[1];
  const bx = c[0] - b[0], by = c[1] - b[1];
  return (Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * 180) / Math.PI;
}

function sharpCount(poly: Polygon, graus: number): number {
  let total = 0;
  for (let i = 0; i < poly.length; i++) if (turnAt(poly, i) > graus) total++;
  return total;
}

function cubicAt(from: Point, s: CubicSegment, t: number): Point {
  if (!s.c1 || !s.c2) return [from[0] + (s.to[0] - from[0]) * t, from[1] + (s.to[1] - from[1]) * t];
  const u = 1 - t;
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  return [
    w0 * from[0] + w1 * s.c1[0] + w2 * s.c2[0] + w3 * s.to[0],
    w0 * from[1] + w1 * s.c1[1] + w2 * s.c2[1] + w3 * s.to[1],
  ];
}

const CENTER = 40;
const RAIO = 28;

/** Círculo com borda dura: o alpha salta de 0 pra 255, que é o caso que produz
 * a escada de pixel que a suavização precisa tirar. */
function circuloDuro(): AlphaMask {
  return mask(80, 80, (x, y) => (Math.hypot(x - CENTER, y - CENTER) <= RAIO ? 255 : 0));
}

function desvioRadial(poly: Polygon): number {
  let max = 0;
  for (const [x, y] of poly) max = Math.max(max, Math.abs(Math.hypot(x - CENTER, y - CENTER) - RAIO));
  return max;
}

describe('traceMask — interpolação subpixel', () => {
  it('põe o vértice onde o alpha cruza o limiar, não no meio da célula', () => {
    // coluna 2 em meio-tom: o cruzamento do limiar (128) entre 64 e 255 cai em
    // 2 + (128−64)/(255−64) ≈ 2,335 — o traçado binário cravaria 2,5
    const m = mask(10, 10, (x, y) => {
      if (y < 3 || y > 6) return 0;
      if (x === 2) return 64;
      return x >= 3 && x <= 6 ? 255 : 0;
    });
    const [poly] = traceMask(m, { smoothSigma: 0, simplifyEpsilon: 0, minArea: 0 });

    const menorX = Math.min(...poly.map((p) => p[0]));
    expect(menorX).toBeCloseTo(2 + (128 - 64) / (255 - 64), 3);
  });

  it('fecha o contorno de uma silhueta encostada na borda da máscara', () => {
    // 6×6 px preenchidos no canto: sem a borda virtual vazia em volta, o
    // contorno sairia aberto nos dois lados que encostam na borda
    const m = mask(12, 12, (x, y) => (x < 6 && y < 6 ? 255 : 0));
    const [poly] = traceMask(m, { smoothSigma: 0, simplifyEpsilon: 0, minArea: 0 });

    const xs = poly.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(-1 + 128 / 255, 3);
    expect(Math.max(...xs)).toBeCloseTo(5 + 127 / 255, 3);
    // 6² menos os quatro cantos que o marching squares corta em diagonal
    expect(Math.abs(polygonArea(poly))).toBeCloseTo(35.46, 1);
  });

  it('não devolve nada quando a máscara está vazia', () => {
    expect(traceMask(mask(8, 8, () => 0))).toEqual([]);
  });
});

describe('traceMask — suavização', () => {
  it('aproxima a linha do círculo real em vez de facetá-la', () => {
    const m = circuloDuro();
    const cru = traceMask(m, { smoothSigma: 0, simplifyEpsilon: 0 })[0];
    const suave = traceMask(m, { smoothSigma: 3, simplifyEpsilon: 0 })[0];

    expect(desvioRadial(suave)).toBeLessThan(desvioRadial(cru));
    expect(desvioRadial(suave)).toBeLessThan(0.25);
  });

  it('mantém a área ao suavizar — a linha não migra pra dentro da margem impressa', () => {
    const m = circuloDuro();
    const cru = Math.abs(polygonArea(traceMask(m, { smoothSigma: 0, simplifyEpsilon: 0 })[0]));

    for (const sigma of [2, 5, 9]) {
      const suave = Math.abs(polygonArea(traceMask(m, { smoothSigma: sigma, simplifyEpsilon: 0 })[0]));
      expect(Math.abs(suave - cru) / cru).toBeLessThan(0.01);
    }
  });

  it('preserva os cantos do quadrado quando "manter cantos" está ligado', () => {
    const m = mask(60, 60, (x, y) => (x >= 15 && x <= 44 && y >= 15 && y <= 44 ? 255 : 0));
    const comCantos = traceMask(m, { smoothSigma: 4, cornerAngle: 60, simplifyEpsilon: 0 })[0];
    const semCantos = traceMask(m, { smoothSigma: 4, cornerAngle: 0, simplifyEpsilon: 0 })[0];

    expect(sharpCount(comCantos, 45)).toBe(4);
    expect(sharpCount(semCantos, 45)).toBe(0);
  });

  it('não quebra em contorno minúsculo', () => {
    const m = mask(12, 12, (x, y) => (x >= 5 && x <= 7 && y >= 5 && y <= 7 ? 255 : 0));
    expect(() => traceMask(m, { smoothSigma: 6, minArea: 0 })).not.toThrow();
  });
});

describe('polygonToCubics', () => {
  /** Dendo como o contorno chega de verdade ao ajuste: reamostrado a ~1 px, e
   * não um polígono grosseiro. A flecha da corda aqui é ~0,001 px, então o que
   * o teste mede é o erro do ajuste, não o do polígono de entrada. */
  const circulo: Polygon = Array.from({ length: 360 }, (_, i) => {
    const t = (i / 360) * Math.PI * 2;
    return [CENTER + Math.cos(t) * RAIO, CENTER + Math.sin(t) * RAIO] as Point;
  });

  /** Maior distância entre a curva ajustada e o círculo real. */
  function desvioDaCurva(path: ReturnType<typeof polygonToCubics>): number {
    let pior = 0;
    let de = path.start;
    for (const s of path.segments) {
      for (let t = 0; t <= 1; t += 0.05) {
        const [x, y] = cubicAt(de, s, t);
        pior = Math.max(pior, Math.abs(Math.hypot(x - CENTER, y - CENTER) - RAIO));
      }
      de = s.to;
    }
    return pior;
  }

  it('honra a tolerância pedida', () => {
    for (const tolerance of [0.2, 0.05, 0.01]) {
      expect(desvioDaCurva(polygonToCubics(circulo, { tolerance }))).toBeLessThan(tolerance);
    }
  });

  it('gasta muito menos curvas do que pontos', () => {
    const { segments } = polygonToCubics(circulo, { tolerance: 0.05 });

    expect(segments.length).toBeLessThan(circulo.length / 10);
    expect(segments.length).toBeGreaterThan(0);
  });

  it('aperta a tolerância, gasta mais curvas', () => {
    const solto = polygonToCubics(circulo, { tolerance: 0.2 }).segments.length;
    const apertado = polygonToCubics(circulo, { tolerance: 0.001 }).segments.length;

    expect(apertado).toBeGreaterThan(solto);
  });

  it('fecha a volta: o último trecho volta ao ponto inicial', () => {
    const { start, segments } = polygonToCubics(circulo);

    expect(segments[segments.length - 1].to[0]).toBeCloseTo(start[0], 6);
    expect(segments[segments.length - 1].to[1]).toBeCloseTo(start[1], 6);
  });

  it('deixa o retângulo reto — os quatro cantos são quebras, não curvas', () => {
    const retangulo: Polygon = [[0, 0], [30, 0], [30, 20], [0, 20]];
    const { segments } = polygonToCubics(retangulo);

    expect(segments.every((s) => s.c1 === null && s.c2 === null)).toBe(true);
  });

  it('não estufa o lado reto que encosta num trecho curvo', () => {
    // meia-cana: um lado reto longo emendado num arco denso — é onde uma
    // parametrização uniforme criaria barriga no lado que devia ficar reto
    const arco: Polygon = Array.from({ length: 19 }, (_, i) => {
      const t = Math.PI + (i / 18) * Math.PI;
      return [50 + Math.cos(t) * 10, 20 + Math.sin(t) * 10] as Point;
    });
    const poly: Polygon = [[40, 20], ...arco.slice(1, -1), [60, 20]];
    const { start, segments } = polygonToCubics(poly);

    let de = start;
    let piorNoReto = 0;
    for (const s of segments) {
      // o trecho de volta, de (60,20) a (40,20), é o lado reto
      if (de[0] === 60 && s.to[0] === 40) {
        for (const t of [0.25, 0.5, 0.75]) piorNoReto = Math.max(piorNoReto, Math.abs(cubicAt(de, s, t)[1] - 20));
      }
      de = s.to;
    }
    expect(piorNoReto).toBeLessThan(0.5);
  });

  it('não estufa em trecho de escada — o ajuste degenerado fica no teto', () => {
    // Com a suavização desligada o contorno é a escada crua, e as tangentes das
    // pontas de cada trecho saem quase perpendiculares à corda. O mínimos
    // quadrados responde com tangentes de dezenas de vezes a corda e a curva
    // dispara pra longe; o erro medido nos pontos não pega, porque a barriga
    // fica entre eles. Aqui isso chegou a 82 px num círculo de raio 60.
    const m = mask(180, 180, (x, y) => (Math.hypot(x - 90, y - 90) <= 60 ? 255 : 0));
    const poly = traceMask(m, { smoothSigma: 0, simplifyEpsilon: 0.05 })[0];
    const { start, segments } = polygonToCubics(poly, { tolerance: 0.18 });

    let pior = 0;
    let de = start;
    for (const s of segments) {
      for (let t = 0; t <= 1; t += 0.05) {
        const [x, y] = cubicAt(de, s, t);
        pior = Math.max(pior, Math.abs(Math.hypot(x - 90, y - 90) - 60));
      }
      de = s.to;
    }
    // a própria escada já varia meio pixel de raio; o ajuste não pode somar muito
    expect(pior).toBeLessThan(1.5);
  });

  it('aguenta um polígono degenerado de três pontos', () => {
    expect(() => polygonToCubics([[0, 0], [1, 0], [0, 1]])).not.toThrow();
    expect(polygonToCubics([[0, 0], [1, 0]]).segments).toEqual([]);
  });
});

describe('polygonsToPathData', () => {
  it('emite curvas cúbicas pra a lâmina não desacelerar em cada vértice', () => {
    const circulo: Polygon = Array.from({ length: 24 }, (_, i) => {
      const t = (i / 24) * Math.PI * 2;
      return [10 + Math.cos(t) * 5, 10 + Math.sin(t) * 5] as Point;
    });
    const d = polygonsToPathData(circulo.length ? [circulo] : []);

    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain(' C ');
    expect(d).not.toContain(' L ');
    expect(d.endsWith(' Z')).toBe(true);
  });

  it('mantém o retângulo em linhas retas', () => {
    const d = polygonsToPathData([[[0, 0], [30, 0], [30, 20], [0, 20]]]);

    expect(d).toBe('M 0.00 0.00 L 30.00 0.00 L 30.00 20.00 L 0.00 20.00 Z');
  });

  it('junta vários contornos num só atributo', () => {
    const a: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const b: Polygon = [[20, 0], [30, 0], [30, 10], [20, 10]];

    expect(polygonsToPathData([a, b]).match(/M /g)).toHaveLength(2);
  });
});
