import { melhorarAutomaticamente } from './auto';

const W = 160;
const H = 160;

interface Cena {
  /** Nível mais escuro da cena. */
  base?: number;
  /** Quanto a cena se estende acima da base. */
  faixa?: number;
  /** Desloca vermelho para cima e azul para baixo (luz amarela). */
  quente?: number;
  ruido?: number;
}

function cena({ base = 0, faixa = 255, quente = 0, ruido = 0 }: Cena): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(W * H * 4);
  let estado = 7;
  const random = () => {
    estado = (estado * 1664525 + 1013904223) % 4294967296;
    return estado / 4294967296;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = base + (x / W) * faixa + (Math.floor(y / 6) % 2) * 6;
      const n = ruido ? (random() + random() + random() - 1.5) * ruido : 0;
      pixels[i] = v + quente + n;
      pixels[i + 1] = v + n;
      pixels[i + 2] = v - quente + n;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

/** Aplica os ajustes decididos e conta quanto foi parar nas pontas da escala.
 * É a mesma conta do desenho — o ponto é provar que a decisão foi conferida. */
function extremos(pixels: Uint8ClampedArray, brightness: number, contrast: number): { altas: number; baixas: number } {
  let altas = 0;
  let baixas = 0;
  const total = W * H;
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    const l = (0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2]) / 255;
    const saida = (l * (brightness / 100) - 0.5) * (contrast / 100) + 0.5;
    if (saida >= 0.995) altas++;
    else if (saida <= 0.005) baixas++;
  }
  return { altas: altas / total, baixas: baixas / total };
}

describe('melhorar automaticamente', () => {
  it('quase não mexe numa foto que já está boa', () => {
    const r = melhorarAutomaticamente(cena({ faixa: 250 }), W, H);
    expect(Math.abs(r.adjust.contrast - 100)).toBeLessThanOrEqual(6);
    expect(Math.abs(r.adjust.brightness - 100)).toBeLessThanOrEqual(6);
    expect(r.denoise).toBe(0);
  });

  it('abre a faixa tonal de uma foto lavada', () => {
    const r = melhorarAutomaticamente(cena({ base: 70, faixa: 90 }), W, H);
    expect(r.adjust.contrast).toBeGreaterThan(115);
    expect(r.diagnostico.faixaUsada).toBeLessThan(0.6);
  });

  it('clareia foto escura sem chapar a sombra', () => {
    const pixels = cena({ base: 5, faixa: 110 });
    const r = melhorarAutomaticamente(pixels, W, H);
    expect(r.adjust.brightness).toBeGreaterThan(105);
    // o que importa: clarear não pode custar a sombra
    expect(extremos(pixels, r.adjust.brightness, r.adjust.contrast).baixas).toBeLessThan(0.01);
  });

  it('não acrescenta estouro, por mais lavada que seja a foto', () => {
    for (const c of [{ base: 150, faixa: 100 }, { base: 200, faixa: 55 }, { base: 0, faixa: 255 }]) {
      const pixels = cena(c);
      const r = melhorarAutomaticamente(pixels, W, H);
      // Uma foto pode CHEGAR com branco estourado; o que não pode é a melhoria
      // acrescentar estouro. A comparação é com a própria foto, sem ajuste.
      const antes = extremos(pixels, 100, 100);
      const depois = extremos(pixels, r.adjust.brightness, r.adjust.contrast);
      expect(depois.altas - antes.altas).toBeLessThan(0.01);
      expect(depois.baixas - antes.baixas).toBeLessThan(0.01);
    }
  });

  it('limpa o grão quando existe e não inventa quando não existe', () => {
    expect(melhorarAutomaticamente(cena({ ruido: 12 }), W, H).denoise).toBeGreaterThan(15);
    expect(melhorarAutomaticamente(cena({ ruido: 0 }), W, H).denoise).toBe(0);
  });

  it('devolve mais nitidez quanto mais a foto encolhe até o post', () => {
    const pouco = melhorarAutomaticamente(cena({}), W, H, 1);
    const muito = melhorarAutomaticamente(cena({}), W, H, 4);
    expect(muito.sharpen).toBeGreaterThan(pouco.sharpen);
  });

  it('mexe pouco na cor, e só quando há evidência de dominante', () => {
    const neutra = melhorarAutomaticamente(cena({ faixa: 240 }), W, H);
    expect(neutra.adjust.temperature).toBe(0);
    expect(neutra.diagnostico.dominante).toBe('neutra');

    const amarelada = melhorarAutomaticamente(cena({ faixa: 200, quente: 26 }), W, H);
    expect(amarelada.diagnostico.dominante).toBe('quente');
    // esfria, mas pouco: a foto de produto não pode trocar de cor
    expect(amarelada.adjust.temperature).toBeLessThan(0);
    expect(amarelada.adjust.temperature).toBeGreaterThanOrEqual(-16);

    const azulada = melhorarAutomaticamente(cena({ faixa: 200, quente: -26 }), W, H);
    expect(azulada.adjust.temperature).toBeGreaterThan(0);
    expect(azulada.diagnostico.dominante).toBe('fria');
  });

  it('não quebra com imagem vazia', () => {
    const r = melhorarAutomaticamente(new Uint8ClampedArray(0), 0, 0);
    expect(r.adjust.brightness).toBe(100);
    expect(r.denoise).toBe(0);
  });
});
