import {
  aplicarLuz, aplicarRazaoDeLuz, mapaDeLuz, razaoDeLuz, tamanhoDaRazao,
} from './light';

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

describe('luz da IA sobre os pixels da foto', () => {
  const MW = 40;
  const MH = 60;

  /** Constrói um par de imagens pequenas: a "original" e a "reiluminada", que
   * além da luz também tem o produto REDESENHADO — é o caso real. */
  function par(): { original: Uint8ClampedArray; ia: Uint8ClampedArray } {
    const original = new Uint8ClampedArray(MW * MH * 4);
    const ia = new Uint8ClampedArray(MW * MH * 4);
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        const i = (y * MW + x) * 4;
        const dentroDoProduto = x > MW / 3 && x < (MW * 2) / 3;

        // original: produto roxo sobre fundo rosa, luz uniforme
        const base = dentroDoProduto ? [150, 130, 200] : [200, 90, 130];
        original[i] = base[0];
        original[i + 1] = base[1];
        original[i + 2] = base[2];
        original[i + 3] = 255;

        // IA: luz caindo da esquerda E o produto redesenhado em rosa
        const luz = 1.5 - (x / MW);
        const redesenhado = dentroDoProduto ? [230, 120, 160] : [205, 95, 135];
        ia[i] = redesenhado[0] * luz;
        ia[i + 1] = redesenhado[1] * luz;
        ia[i + 2] = redesenhado[2] * luz;
        ia[i + 3] = 255;
      }
    }
    return { original, ia };
  }

  it('a razão segue a luz da IA, não a cor que ela inventou', () => {
    const { original, ia } = par();
    const razao = razaoDeLuz(original, ia, MW, MH);

    const esquerda = razao[Math.floor(MH / 2) * MW + 3];
    const direita = razao[Math.floor(MH / 2) * MW + MW - 4];
    // a luz cai da esquerda para a direita, e a razão precisa refletir isso
    expect(esquerda).toBeGreaterThan(direita * 1.3);
    // e nada explode: a razão é normalizada e limitada (com folga de Float32,
    // onde 0,65 é guardado como 0,6499999)
    for (const v of razao) {
      expect(v).toBeGreaterThan(0.649);
      expect(v).toBeLessThan(1.801);
    }
  });

  it('aplicada na foto, muda a luz e preserva a cor do produto', () => {
    const { original, ia } = par();
    const razao = razaoDeLuz(original, ia, MW, MH);

    const foto = new Uint8ClampedArray(original);
    aplicarRazaoDeLuz(foto, MW, MH, razao, MW, MH, 60);

    const meio = Math.floor(MH / 2) * MW + Math.floor(MW / 2);
    const p = meio * 4;
    // o produto continua roxo (azul > vermelho), e NÃO virou rosa como na IA
    expect(foto[p + 2]).toBeGreaterThan(foto[p]);
    // a proporção entre os canais do produto sobrevive: mudou a luz, não a cor
    expect(foto[p] / foto[p + 2]).toBeCloseTo(original[p] / original[p + 2], 1);
  });

  it('a intensidade é um expoente: 0 não muda nada e o meio é o meio', () => {
    const { original, ia } = par();
    const razao = razaoDeLuz(original, ia, MW, MH);
    const ponto = (Math.floor(MH / 2) * MW + 3) * 4;

    const zero = new Uint8ClampedArray(original);
    aplicarRazaoDeLuz(zero, MW, MH, razao, MW, MH, 0);
    expect(Array.from(zero)).toEqual(Array.from(original));

    const meia = new Uint8ClampedArray(original);
    aplicarRazaoDeLuz(meia, MW, MH, razao, MW, MH, 50);
    const cheia = new Uint8ClampedArray(original);
    aplicarRazaoDeLuz(cheia, MW, MH, razao, MW, MH, 100);

    // metade da força fica entre não fazer nada e fazer tudo
    expect(meia[ponto]).toBeGreaterThan(original[ponto]);
    expect(meia[ponto]).toBeLessThan(cheia[ponto]);
  });

  it('o mapa é minúsculo, que é o que apaga o produto inventado', () => {
    const { largura, altura } = tamanhoDaRazao(1848, 4000);
    expect(Math.max(largura, altura)).toBeLessThanOrEqual(96);
    expect(largura / altura).toBeCloseTo(1848 / 4000, 2);
  });
});
