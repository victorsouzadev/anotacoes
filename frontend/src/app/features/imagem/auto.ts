/** "Melhorar automaticamente": olha a foto e decide os ajustes.
 *
 * A ideia não é inventar nada — é fazer, medindo, o que alguém faria à mão:
 * abrir a faixa tonal que a foto não usa, tirar a dominante de cor, limpar o
 * grão que existir e devolver a nitidez que a redução para o tamanho do post
 * vai comer. Tudo sai de número medido na própria imagem, então foto boa quase
 * não é tocada e foto ruim é tocada onde precisa.
 *
 * O resultado são os MESMOS controles da seção de cor. Quem não gostar mexe em
 * cima, desfaz, ou compara com o original segurando "Antes" — o automático é um
 * ponto de partida, não uma caixa-preta. */

import { Adjustments, NEUTRAL } from './social-model';

export interface AutoResultado {
  adjust: Adjustments;
  denoise: number;
  sharpen: number;
  /** O que foi medido, para a tela poder contar o que fez. */
  diagnostico: {
    faixaUsada: number;
    dominante: 'quente' | 'fria' | 'neutra';
    ruido: number;
  };
}

/** Percentil de um histograma acumulado de 256 caixas. */
function percentil(hist: Uint32Array, total: number, fracao: number): number {
  const alvo = total * fracao;
  let soma = 0;
  for (let i = 0; i < 256; i++) {
    soma += hist[i];
    if (soma >= alvo) return i;
  }
  return 255;
}

/** Converte o fator em por cento inteiro, nunca se afastando mais do neutro. */
function paraNeutro(fator: number): number {
  return fator >= 1 ? Math.floor(fator * 100) : Math.ceil(fator * 100);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Ruído estimado por diferença entre vizinhos na horizontal, com mediana em vez
 * de média: a mediana ignora as bordas (poucas e grandes) e enxerga o grão
 * (muito e pequeno), que é exatamente a separação que interessa.
 */
function estimarRuido(pixels: Uint8ClampedArray, w: number, h: number): number {
  const amostras: number[] = [];
  const passoY = Math.max(1, Math.floor(h / 120));
  const passoX = Math.max(1, Math.floor(w / 120));
  for (let y = 1; y < h - 1; y += passoY) {
    for (let x = 1; x < w - 1; x += passoX) {
      const i = (y * w + x) * 4;
      const j = (y * w + x + 1) * 4;
      const a = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      const b = 0.299 * pixels[j] + 0.587 * pixels[j + 1] + 0.114 * pixels[j + 2];
      amostras.push(Math.abs(a - b));
    }
  }
  if (!amostras.length) return 0;
  amostras.sort((a, b) => a - b);
  // Mediana da diferença entre vizinhos, convertida em desvio-padrão.
  return (amostras[amostras.length >> 1] / 0.6745) * 0.5;
}

/**
 * Mede a foto e devolve os ajustes. `reducaoParaSaida` é o quanto a foto vai
 * encolher até o tamanho do post (1 = nada): quanto mais encolhe, mais nitidez
 * a redução come, e mais faz sentido devolver.
 */
export function melhorarAutomaticamente(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  reducaoParaSaida = 1,
): AutoResultado {
  const luma = new Uint32Array(256);
  let n = 0;
  // A dominante sai da MEDIANA da razão vermelho/azul entre os pixels
  // candidatos a neutro. Medir pela média da foto inteira é a armadilha do
  // "mundo cinza": num bolo marrom sobre fundo marrom a foto é quente de
  // verdade, e "corrigir" isso tira a cor do produto em vez da cor da lâmpada.
  // A mediana resolve as duas pontas — ela segue a superfície mais comum da
  // cena, e ignora o assunto colorido que ocupa parte dela.
  const razoes: number[] = [];

  // Amostra em grade: uma foto de 8 MP não precisa ser lida inteira pra ter o
  // histograma certo, e a conta roda no clique, não em segundo plano.
  const passo = Math.max(1, Math.floor(Math.sqrt((w * h) / 200_000)));
  for (let y = 0; y < h; y += passo) {
    for (let x = 0; x < w; x += passo) {
      const i = (y * w + x) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      luma[Math.round(l)]++;
      n++;

      // Candidato a neutro: longe do preto e do estouro, e com os canais
      // razoavelmente próximos. A folga é generosa de propósito — sob luz
      // amarela um cinza JÁ chega aqui com os canais separados, e um critério
      // apertado rejeitaria exatamente o pixel que denuncia a lâmpada. Quem
      // separa luz de assunto é a mediana logo abaixo, não este filtro.
      const espalhamento = Math.max(r, g, b) - Math.min(r, g, b);
      if (l > 45 && l < 225 && espalhamento < l * 0.45) {
        razoes.push(r / Math.max(1, b));
      }
    }
  }
  if (!n) {
    return {
      adjust: { ...NEUTRAL }, denoise: 0, sharpen: 0,
      diagnostico: { faixaUsada: 1, dominante: 'neutra', ruido: 0 },
    };
  }

  // --- faixa tonal: 0,5% de cada ponta é sujeira, não informação ---
  const preto = percentil(luma, n, 0.005);
  const branco = percentil(luma, n, 0.995);
  const faixa = Math.max(1, branco - preto);
  const faixaUsada = faixa / 255;
  const mediana = Math.max(16, percentil(luma, n, 0.5));

  // Contraste e brilho pretendidos: abrir a faixa que a foto não usa e levar o
  // centro tonal na direção do meio da escala.
  //
  // "Na direção", e não "até": foto de produto costuma ter fundo colorido
  // escuro ou claro de propósito, e mirar um alvo fixo de exposição desfaz a
  // intenção de quem fotografou. Numa foto real de fundo magenta, mirar o meio
  // clareou 23% e estourou 11% do branco.
  let contraste = clamp((255 / faixa), 1, 1.28);
  let brilho = clamp((0.5 + (0.48 - 0.5) / contraste) / (mediana / 255), 0.94, 1.12);

  // E aí a decisão é CONFERIDA no próprio histograma antes de sair daqui: o
  // mesmo cálculo do desenho é aplicado a cada caixa, e enquanto estourar
  // branco ou chapar preto além de meio por cento, o ajuste recua. Assim
  // nenhuma foto — nem a de fundo claro, nem a de fundo escuro — perde detalhe
  // nas pontas, sem depender de eu ter escolhido bem os limites acima.
  const LIMITE_ESTOURO = 0.005;

  /** Fração de pixels que cai nas pontas da escala com um dado ajuste. */
  const nasPontas = (b: number, c: number): { altas: number; baixas: number } => {
    let altas = 0;
    let baixas = 0;
    for (let v = 0; v < 256; v++) {
      if (!luma[v]) continue;
      const saida = ((v / 255) * b - 0.5) * c + 0.5;
      if (saida >= 0.995) altas += luma[v];
      else if (saida <= 0.005) baixas += luma[v];
    }
    return { altas: altas / n, baixas: baixas / n };
  };

  // O que se mede é o estouro ACRESCENTADO. Uma foto pode chegar com o branco
  // já estourado — uma janela ao fundo, um reflexo —, e contar isso como culpa
  // do ajuste faria o recuo perseguir um limite inalcançável e parar no meio do
  // caminho, deixando passar justamente o pouco que ele deveria cortar.
  const original = nasPontas(1, 1);

  let cabe = false;
  for (let tentativa = 0; tentativa < 24; tentativa++) {
    const { altas, baixas } = nasPontas(brilho, contraste);
    if (altas - original.altas <= LIMITE_ESTOURO && baixas - original.baixas <= LIMITE_ESTOURO) {
      cabe = true;
      break;
    }

    // Quem recua depende de qual ponta está sofrendo. O contraste gira a imagem
    // em torno do meio da escala, então é ele que chapa a sombra de uma foto
    // escura — e recuar o brilho junto seria tirar dela justamente o que ela
    // precisa. Já no estouro do branco os dois contribuem.
    contraste = 1 + (contraste - 1) * 0.85;
    if (altas - original.altas > LIMITE_ESTOURO) brilho = 1 + (brilho - 1) * 0.85;
  }

  // Há foto que não aceita ajuste nenhum: quando boa parte dela já está no
  // branco puro, qualquer contraste empurra o resto junto, e recuar aos poucos
  // nunca chega a zero. Nesse caso a resposta honesta é não mexer no tom — o
  // que ainda deixa a limpeza de ruído e a nitidez fazerem o seu trabalho.
  if (!cabe) {
    contraste = 1;
    brilho = 1;
  }

  // --- dominante de cor ---
  // Sem candidatos suficientes não dá pra saber se a cor vem da luz ou do
  // assunto — e, na dúvida, mexer na cor de uma foto de produto é o pior erro.
  let desvio = 0;
  if (razoes.length > n * 0.05) {
    razoes.sort((a, b) => a - b);
    const razao = razoes[razoes.length >> 1];
    // Razão 1 = neutro. Acima, mais vermelho que azul (quente).
    desvio = (razao - 1) / ((razao + 1) / 2);
  }
  // Corrige cerca de metade da dominante, com teto baixo.
  //
  // Baixo de propósito, porque esta medida tem um limite que nenhum ajuste de
  // fórmula resolve: não dá para distinguir "luz amarela sobre assunto neutro"
  // de "assunto realmente marrom" sem saber o que está na foto. Num bolo de
  // chocolate as duas coisas são idênticas para o histograma. Com teto baixo, o
  // pior caso é uma correção pequena e visível — que o resumo na tela anuncia,
  // o "Antes" deixa comparar e o Ctrl+Z desfaz.
  // O `|| 0` troca -0 por 0: sem ele, foto neutra mostraria "-0" no controle.
  const temperatura = clamp(Math.round(-desvio * 50), -16, 16) || 0;
  const dominante = desvio > 0.08 ? 'quente' : desvio < -0.08 ? 'fria' : 'neutra';

  // --- ruído e nitidez ---
  const ruido = estimarRuido(pixels, w, h);
  // Abaixo de 2 níveis não há grão que justifique limpar.
  const denoise = ruido < 2 ? 0 : clamp(Math.round((ruido - 2) * 14), 10, 70);
  // A redução até o tamanho do post é o que mais come micro-contraste; a
  // limpeza de ruído come um pouco mais.
  const base = 24 + (reducaoParaSaida > 1 ? Math.min(26, (reducaoParaSaida - 1) * 18) : 0);
  const sharpen = clamp(Math.round(base + denoise * 0.15), 20, 55);

  return {
    adjust: {
      ...NEUTRAL,
      // Arredondado SEMPRE na direção do neutro. Os controles são inteiros em
      // por cento, e arredondar para cima entregaria um ajuste mais forte do
      // que o que o laço acima conferiu — foi assim que um contraste de 1,0057,
      // aprovado, virou 1,01 na aplicação e voltou a estourar branco.
      brightness: paraNeutro(brilho),
      contrast: paraNeutro(contraste),
      // Saturação sobe pouco, e só quando a foto está lavada.
      saturation: clamp(Math.round(100 + (1 - faixaUsada) * 25), 100, 118),
      temperature: temperatura,
    },
    denoise,
    sharpen,
    diagnostico: { faixaUsada, dominante, ruido },
  };
}
