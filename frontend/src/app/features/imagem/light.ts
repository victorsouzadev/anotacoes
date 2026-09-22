/** Sombras e luzes: o ajuste de iluminação que brilho e contraste não fazem.
 *
 * Brilho move a foto inteira e contraste a estica em torno do meio — os dois
 * tratam um pixel escuro no produto e um pixel escuro no fundo como a mesma
 * coisa. Quando a queixa é "a luz estava ruim", o que se quer é outra coisa:
 * clarear o que ficou na sombra SEM tocar no que já está bem iluminado.
 *
 * Para isso é preciso saber, para cada pixel, se a região em volta dele é
 * escura ou clara — uma estimativa da iluminação local. Ela sai de uma versão
 * bem borrada e reduzida da própria luminância: a luz varia devagar pela cena,
 * então uma imagem pequena e suave a descreve bem, e ainda sai barata.
 *
 * O preço dessa técnica é o halo: perto de uma borda de alto contraste, a
 * estimativa erra, e a correção deixa um contorno claro. O que segura o halo é
 * o raio ser grande em relação ao detalhe (a luz muda mais devagar que a
 * textura) e a correção ser proporcional — nunca um degrau. */

/** Lado máximo do mapa de iluminação. Acima disso ele começa a enxergar
 * textura, que é justamente o que não deve influenciar. */
const MAPA_MAX = 160;

function boxBlur(plano: Float32Array, tmp: Float32Array, w: number, h: number, raio: number): void {
  if (raio < 1) return;
  const span = raio * 2 + 1;
  const limite = (v: number, n: number) => (v < 0 ? 0 : v >= n ? n - 1 : v);

  for (let y = 0; y < h; y++) {
    const linha = y * w;
    let soma = 0;
    for (let k = -raio; k <= raio; k++) soma += plano[linha + limite(k, w)];
    for (let x = 0; x < w; x++) {
      tmp[linha + x] = soma / span;
      soma += plano[linha + limite(x + raio + 1, w)] - plano[linha + limite(x - raio, w)];
    }
  }
  for (let x = 0; x < w; x++) {
    let soma = 0;
    for (let k = -raio; k <= raio; k++) soma += tmp[limite(k, h) * w + x];
    for (let y = 0; y < h; y++) {
      plano[y * w + x] = soma / span;
      soma += tmp[limite(y + raio + 1, h) * w + x] - tmp[limite(y - raio, h) * w + x];
    }
  }
}

/** Mapa reduzido e suave da iluminação da cena, em 0..1. */
export function mapaDeLuz(
  pixels: Uint8ClampedArray, w: number, h: number,
): { dados: Float32Array; largura: number; altura: number } {
  const fator = Math.max(1, Math.ceil(Math.max(w, h) / MAPA_MAX));
  const mw = Math.max(1, Math.floor(w / fator));
  const mh = Math.max(1, Math.floor(h / fator));
  const dados = new Float32Array(mw * mh);

  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      // Média do bloco correspondente: reduzir com média já é meio caminho
      // para o borrão, e sem ela o mapa ficaria com o ruído da foto dentro.
      let soma = 0;
      let contagem = 0;
      for (let dy = 0; dy < fator; dy++) {
        const sy = y * fator + dy;
        if (sy >= h) break;
        for (let dx = 0; dx < fator; dx++) {
          const sx = x * fator + dx;
          if (sx >= w) break;
          const p = (sy * w + sx) * 4;
          soma += 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
          contagem++;
        }
      }
      dados[y * mw + x] = contagem ? soma / contagem / 255 : 0;
    }
  }

  // Raio proporcional ao mapa: o que importa é a escala da CENA, não a
  // resolução da foto — a mesma cena em 12 MP ou em 2 MP tem a mesma luz.
  boxBlur(dados, new Float32Array(mw * mh), mw, mh, Math.max(2, Math.round(Math.max(mw, mh) / 12)));
  return { dados, largura: mw, altura: mh };
}

/**
 * Clareia o que está na sombra e segura o que está estourando, in loco.
 * `sombras` e `luzes` vão de 0 a 100.
 */
export function aplicarLuz(
  pixels: Uint8ClampedArray, w: number, h: number, sombras: number, luzes: number,
): void {
  if (!(sombras > 0) && !(luzes > 0)) return;
  if (w < 8 || h < 8) return;

  const mapa = mapaDeLuz(pixels, w, h);
  const forcaSombra = Math.min(100, Math.max(0, sombras)) / 100;
  const forcaLuz = Math.min(100, Math.max(0, luzes)) / 100;
  const escalaX = mapa.largura / w;
  const escalaY = mapa.altura / h;

  for (let y = 0; y < h; y++) {
    // Amostragem bilinear do mapa: ele é muito menor que a foto, e pegar o
    // vizinho mais próximo deixaria degraus visíveis nas áreas lisas.
    const my = Math.min(mapa.altura - 1.001, y * escalaY);
    const my0 = Math.floor(my);
    const ty = my - my0;
    const linha0 = my0 * mapa.largura;
    const linha1 = Math.min(mapa.altura - 1, my0 + 1) * mapa.largura;

    for (let x = 0; x < w; x++) {
      const mx = Math.min(mapa.largura - 1.001, x * escalaX);
      const mx0 = Math.floor(mx);
      const tx = mx - mx0;
      const mx1 = Math.min(mapa.largura - 1, mx0 + 1);

      const cima = mapa.dados[linha0 + mx0] * (1 - tx) + mapa.dados[linha0 + mx1] * tx;
      const baixo = mapa.dados[linha1 + mx0] * (1 - tx) + mapa.dados[linha1 + mx1] * tx;
      const luz = cima * (1 - ty) + baixo * ty;

      // Peso da sombra: vale 1 no preto e cai a zero um pouco acima do
      // meio-tom. A fronteira em 0,6 e não em 0,5 porque a sombra que incomoda
      // numa foto de produto raramente é preta — é aquele lado que "caiu" e
      // ficou abaixo do resto. Ao quadrado para a transição ser suave: um corte
      // seco desenharia a fronteira na imagem.
      const pesoSombra = luz < 0.6 ? ((0.6 - luz) / 0.6) ** 2 : 0;
      // Peso da luz alta, do outro lado da escala.
      const pesoLuz = luz > 0.45 ? ((luz - 0.45) / 0.55) ** 2 : 0;

      // Ganho multiplicativo: preserva a cor, ao contrário de somar um valor
      // fixo, que desbota o escuro na direção do cinza.
      const ganho = 1 + forcaSombra * 1.4 * pesoSombra - forcaLuz * 0.5 * pesoLuz;
      if (ganho === 1) continue;

      const p = (y * w + x) * 4;
      pixels[p] *= ganho;
      pixels[p + 1] *= ganho;
      pixels[p + 2] *= ganho;
    }
  }
}


/** Lado maior do mapa de razão. Pequeno porque só a luz interessa: é neste
 * tamanho que o detalhe inventado pela IA deixa de existir. */
const RAZAO_LADO = 96;

/**
 * Razão de luz entre a foto reiluminada pela IA e a original, as duas já
 * reduzidas ao mesmo tamanho pequeno.
 *
 * É o coração do método: a IA redesenha o produto — copo transparente vira
 * copo opaco, arte muda de cor —, mas a RAZÃO entre as duas luminâncias,
 * borrada, guarda só onde a luz bate mais e onde bate menos. Multiplicando a
 * foto original por essa razão, a iluminação vem da IA e cada pixel de produto,
 * texto e arte continua sendo o original.
 *
 * A normalização pela mediana tira o clareamento geral que a IA aplicou por
 * conta própria — o que se quer dela é o desenho da luz, não a exposição.
 */
export function razaoDeLuz(
  original: Uint8ClampedArray, iaPixels: Uint8ClampedArray, largura: number, altura: number,
): Float32Array {
  const total = largura * altura;
  const razao = new Float32Array(total);

  for (let i = 0; i < total; i++) {
    const p = i * 4;
    const lo = 0.299 * original[p] + 0.587 * original[p + 1] + 0.114 * original[p + 2];
    const li = 0.299 * iaPixels[p] + 0.587 * iaPixels[p + 1] + 0.114 * iaPixels[p + 2];
    // O `+ 4` evita que sombra fechada vire divisão por quase zero.
    razao[i] = (li + 4) / (lo + 4);
  }

  boxBlur(razao, new Float32Array(total), largura, altura, Math.max(2, Math.round(Math.max(largura, altura) / 14)));

  const ordenado = Float32Array.from(razao).sort();
  const mediana = ordenado[ordenado.length >> 1] || 1;
  for (let i = 0; i < total; i++) {
    // Teto e piso: o que passa disso é a IA tendo inventado outra cena, não luz.
    razao[i] = Math.min(1.8, Math.max(0.65, razao[i] / mediana));
  }
  return razao;
}

/**
 * Aplica a razão de luz sobre os pixels, in loco. `forca` vai de 0 a 100 e
 * entra como expoente: 0 não muda nada, 100 aplica a luz inteira da IA, e o
 * meio do caminho é de fato o meio — multiplicar a razão por um fator, em vez
 * de elevá-la, deslocaria o neutro e clarearia a foto toda.
 */
export function aplicarRazaoDeLuz(
  pixels: Uint8ClampedArray, w: number, h: number,
  razao: Float32Array, mw: number, mh: number, forca: number,
): void {
  const expoente = Math.min(100, Math.max(0, forca)) / 100;
  if (expoente <= 0 || mw < 2 || mh < 2) return;

  const escalaX = mw / w;
  const escalaY = mh / h;

  for (let y = 0; y < h; y++) {
    const my = Math.min(mh - 1.001, y * escalaY);
    const my0 = Math.floor(my);
    const ty = my - my0;
    const linha0 = my0 * mw;
    const linha1 = Math.min(mh - 1, my0 + 1) * mw;

    for (let x = 0; x < w; x++) {
      const mx = Math.min(mw - 1.001, x * escalaX);
      const mx0 = Math.floor(mx);
      const tx = mx - mx0;
      const mx1 = Math.min(mw - 1, mx0 + 1);

      const cima = razao[linha0 + mx0] * (1 - tx) + razao[linha0 + mx1] * tx;
      const baixo = razao[linha1 + mx0] * (1 - tx) + razao[linha1 + mx1] * tx;
      const ganho = (cima * (1 - ty) + baixo * ty) ** expoente;

      const p = (y * w + x) * 4;
      pixels[p] *= ganho;
      pixels[p + 1] *= ganho;
      pixels[p + 2] *= ganho;
    }
  }
}

/** Tamanho do mapa para uma foto: mesma proporção, lado maior fixo. */
export function tamanhoDaRazao(w: number, h: number): { largura: number; altura: number } {
  const escala = RAZAO_LADO / Math.max(w, h);
  return {
    largura: Math.max(2, Math.round(w * escala)),
    altura: Math.max(2, Math.round(h * escala)),
  };
}
