import { aplicarLuz, mapaDeLuz } from './light';

const W = 200;
const H = 120;

/** Cena com luz caindo da esquerda para a direita, como uma janela lateral. */
function luzLateral(queda = 0.6): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const fator = 1 - queda * (x / W);
      // cor fixa, iluminação variável: é a luz que muda, não o assunto
      pixels[i] = 200 * fator;
      pixels[i + 1] = 140 * fator;
      pixels[i + 2] = 90 * fator;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

function luma(pixels: Uint8ClampedArray, x: number, y: number): number {
  const p = (y * W + x) * 4;
  return 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
}

describe('sombras e luzes', () => {
  it('não mexe em nada com os dois em zero', () => {
    const pixels = luzLateral();
    const copia = new Uint8ClampedArray(pixels);
    aplicarLuz(copia, W, H, 0, 0);
    expect(Array.from(copia)).toEqual(Array.from(pixels));
  });

  it('clareia o lado na sombra muito mais que o lado iluminado', () => {
    const pixels = luzLateral(0.7);
    const antesClaro = luma(pixels, 10, H / 2);
    const antesEscuro = luma(pixels, W - 10, H / 2);

    aplicarLuz(pixels, W, H, 60, 0);

    const ganhoClaro = luma(pixels, 10, H / 2) / antesClaro;
    const ganhoEscuro = luma(pixels, W - 10, H / 2) / antesEscuro;
    // é isto que brilho e contraste não sabem fazer: tratar as duas regiões
    // de formas diferentes
    expect(ganhoEscuro).toBeGreaterThan(1.2);
    expect(ganhoEscuro).toBeGreaterThan(ganhoClaro * 1.15);
    // e o lado que já estava bem iluminado quase não se mexe
    expect(ganhoClaro).toBeLessThan(1.12);
  });

  it('segura o lado claro quando se pede recuperação de luzes', () => {
    const pixels = luzLateral(0.25);
    const antes = luma(pixels, 10, H / 2);
    aplicarLuz(pixels, W, H, 0, 70);
    expect(luma(pixels, 10, H / 2)).toBeLessThan(antes);
  });

  it('não muda a cor, só a quantidade de luz', () => {
    const pixels = luzLateral();
    const p = ((H / 2) * W + (W - 10)) * 4;
    const antes = [pixels[p], pixels[p + 1], pixels[p + 2]];
    aplicarLuz(pixels, W, H, 70, 0);
    const depois = [pixels[p], pixels[p + 1], pixels[p + 2]];

    // ganho multiplicativo preserva a proporção entre os canais — é o que
    // diferencia "mais luz" de "mais cinza"
    expect(depois[0] / depois[1]).toBeCloseTo(antes[0] / antes[1], 1);
    expect(depois[1] / depois[2]).toBeCloseTo(antes[1] / antes[2], 1);
    expect(depois[0]).toBeGreaterThan(antes[0]);
  });

  it('o mapa de luz é pequeno e suave, e segue a cena', () => {
    const mapa = mapaDeLuz(luzLateral(), W, H);
    // pequeno: ele descreve a luz, não a textura
    expect(Math.max(mapa.largura, mapa.altura)).toBeLessThanOrEqual(160);
    // e segue a queda da esquerda para a direita
    const meio = Math.floor(mapa.altura / 2) * mapa.largura;
    expect(mapa.dados[meio]).toBeGreaterThan(mapa.dados[meio + mapa.largura - 1]);
    // suave: sem degraus bruscos entre vizinhos
    for (let x = 1; x < mapa.largura; x++) {
      expect(Math.abs(mapa.dados[meio + x] - mapa.dados[meio + x - 1])).toBeLessThan(0.05);
    }
  });

  it('não quebra com imagem minúscula', () => {
    const tiny = new Uint8ClampedArray(4 * 4 * 4).fill(120);
    const copia = new Uint8ClampedArray(tiny);
    aplicarLuz(copia, 4, 4, 80, 40);
    expect(Array.from(copia)).toEqual(Array.from(tiny));
  });
});
