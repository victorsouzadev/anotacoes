/** Separação de uma arte em elementos independentes: uma folha com seis
 * adesivos iguais chega aqui como um PNG só e sai como seis artes, cada uma
 * com seu próprio recorte — e, no editor, com seus próprios ajustes de corte.
 *
 * O agrupamento é por vizinhança: pedaços que se tocam viram um elemento, e
 * pedaços separados por um vão menor que a folga (uma estrela solta na cabeça,
 * a ponta de um tentáculo cortada pelo anti-aliasing) entram no mesmo elemento.
 * O que decide é o vão em pixels, não o desenho — por isso a folga é parâmetro. */

import { AlphaMask } from './contour';
import { squaredDistanceToArt } from './raster';

export interface SplitOptions {
  /** Alpha mínimo (0–255) pra um pixel contar como desenho. */
  alphaThreshold?: number;
  /** Distância de cor (0–255) aceita como "ainda é o fundo", quando a arte é
   * opaca e o fundo precisa ser deduzido pela cor das bordas. */
  bgTolerance?: number;
  /** Vão máximo, em px, entre dois pedaços do MESMO elemento. */
  gapPx?: number;
  /** Vãos (px) a testar quando o vão deve ser escolhido sozinho. */
  autoGapCandidatesPx?: number[];
  /** Área mínima, em px², pra um grupo virar elemento (descarta sujeira). */
  minAreaPx?: number;
  /** Folga, em px, deixada em volta do recorte. */
  padPx?: number;
}

export interface SplitElement {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Quantos pixels de desenho o elemento tem (área, não a caixa). */
  area: number;
  /** Rótulos dos componentes que formam o elemento, pra recortar só eles. */
  labels: number[];
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
  labels: number[];
  /** Um pixel qualquer do componente, pra consultar a que grupo ele pertence. */
  seed: number;
}

/** Componentes conexos (8-vizinhos) da máscara, rotulados a partir de 1. */
function labelComponents(mask: AlphaMask, threshold: number): { labels: Int32Array; boxes: Box[] } {
  const { data, w, h } = mask;
  const labels = new Int32Array(w * h);
  const boxes: Box[] = [];
  const fila = new Int32Array(w * h);

  for (let i = 0; i < labels.length; i++) {
    if (labels[i] || data[i] < threshold) continue;
    const label = boxes.length + 1;
    let cabeca = 0;
    let cauda = 0;
    fila[cauda++] = i;
    labels[i] = label;
    const box: Box = {
      x0: i % w, y0: (i / w) | 0, x1: i % w, y1: (i / w) | 0, area: 0, labels: [label], seed: i,
    };
    while (cabeca < cauda) {
      const p = fila[cabeca++];
      const x = p % w;
      const y = (p / w) | 0;
      box.area++;
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (labels[q] || data[q] < threshold) continue;
          labels[q] = label;
          fila[cauda++] = q;
        }
      }
    }
    boxes.push(box);
  }
  return { labels, boxes };
}

function merge(a: Box, b: Box): Box {
  return {
    x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
    area: a.area + b.area, labels: [...a.labels, ...b.labels], seed: a.seed,
  };
}

/** Junta componentes que estão a menos de `gap` px UM DO OUTRO — medindo o
 * desenho, não a caixa em volta dele. Pela caixa não dá: numa folha de adesivos
 * a faixa com o nome atravessa a largura toda, e a caixa de um encosta na do
 * vizinho mesmo com dois centímetros de branco entre os desenhos — aí a folha
 * inteira virava um elemento só.
 *
 * O jeito exato é dilatar a máscara por meio vão e ver o que se encosta: a
 * distância euclidiana já existe no editor (é o que engorda o contorno), e sai
 * em O(pixels) em vez de comparar todo mundo com todo mundo. */
function groupByProximity(mask: AlphaMask, threshold: number, boxes: Box[], gap: number): Box[] {
  if (gap <= 0 || boxes.length < 2) return boxes;
  const { w, h } = mask;
  const cov = new Float32Array(w * h);
  for (let i = 0; i < cov.length; i++) cov[i] = mask.data[i] >= threshold ? 1 : 0;
  const dist2 = squaredDistanceToArt(cov, w, h);

  const raio = gap / 2;
  const dilatada = new Uint8Array(w * h);
  for (let i = 0; i < dilatada.length; i++) dilatada[i] = dist2[i] <= raio * raio ? 255 : 0;
  const { labels: grupos } = labelComponents({ data: dilatada, w, h }, 128);

  const porGrupo = new Map<number, Box>();
  for (const box of boxes) {
    const grupo = grupos[box.seed];
    const atual = porGrupo.get(grupo);
    porGrupo.set(grupo, atual ? merge(atual, box) : box);
  }
  return [...porGrupo.values()];
}

/** Escolhe sozinho o vão que separa a folha.
 *
 * Não existe um valor bom pra todo mundo, e é o que quebrava na prática: numa
 * folha de estrelinhas as pontas de duas vizinhas passam a meio milímetro uma
 * da outra, e 2 mm cola a folha inteira num elemento só; num desenho com faixa
 * de nome, estrela solta e tentáculo picotado, meio milímetro estoura em trinta
 * cacos. O que distingue os dois não é o número de elementos, é a ESTABILIDADE:
 * a contagem certa é a que aguenta a maior faixa de vãos sem mudar — abaixo
 * dela o desenho se despedaça, acima os vizinhos se fundem. Então varre os
 * candidatos e fica com o platô mais largo, preferindo o vão menor quando
 * empata (unir demais some com elemento, separar demais só dá trabalho). */
export function suggestGapPx(mask: AlphaMask, options: SplitOptions = {}): number {
  const candidatos = (options.autoGapCandidatesPx ?? [options.gapPx ?? 0]).slice().sort((a, b) => a - b);
  if (candidatos.length < 2) return candidatos[0] ?? 0;
  const contagens = candidatos.map((gapPx) => findElements(mask, { ...options, gapPx }).length);

  let melhorGap = candidatos[0];
  let melhorLargura = 0;
  let i = 0;
  while (i < contagens.length) {
    let j = i;
    while (j + 1 < contagens.length && contagens[j + 1] === contagens[i]) j++;
    const largura = j - i + 1;
    // um platô de contagem 1 não é resposta: é a folha inteira colada
    if (contagens[i] > 1 && largura > melhorLargura) {
      melhorLargura = largura;
      melhorGap = candidatos[i];
    }
    i = j + 1;
  }
  return melhorGap;
}

/** Elementos da máscara, em ordem de leitura (de cima pra baixo, da esquerda
 * pra direita), com a caixa já folgada e presa aos limites da imagem. */
export function findElements(mask: AlphaMask, options: SplitOptions = {}): SplitElement[] {
  const { alphaThreshold = 128, gapPx = 0, minAreaPx = 64, padPx = 0 } = options;
  const { boxes } = labelComponents(mask, alphaThreshold);
  const grupos = groupByProximity(mask, alphaThreshold, boxes, gapPx).filter((g) => g.area >= minAreaPx);

  const elementos = grupos.map((g) => {
    const x0 = Math.max(0, Math.floor(g.x0 - padPx));
    const y0 = Math.max(0, Math.floor(g.y0 - padPx));
    const x1 = Math.min(mask.w - 1, Math.ceil(g.x1 + padPx));
    const y1 = Math.min(mask.h - 1, Math.ceil(g.y1 + padPx));
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area: g.area, labels: g.labels };
  });

  // Ordem de leitura: linhas são definidas pela altura do próprio elemento, pra
  // uma fileira levemente desalinhada não embaralhar a numeração.
  const alturaMedia = elementos.reduce((s, e) => s + e.h, 0) / (elementos.length || 1);
  return elementos.sort((a, b) => {
    const linha = Math.round((a.y - b.y) / Math.max(1, alturaMedia * 0.6));
    return linha !== 0 ? linha : a.x - b.x;
  });
}

// ---------- máscara: por transparência ou pela cor do fundo ----------

/** Fração mínima de pixels transparentes pra considerar que a arte já tem
 * fundo removido — abaixo disso é só franja de anti-aliasing ou canto de PNG. */
const TRANSPARENT_SHARE = 0.02;
/** Fração da imagem a partir da qual a leitura do fundo é claramente boa e
 * não vale a pena recuar mais o anel. Abaixo disso todos os recuos são
 * testados e vence o que achar mais fundo — é o que atravessa uma moldura
 * colorida, que inunda só a si mesma e pararia numa fração pequena. */
const MIN_BG_SHARE = 0.5;
/** Recuos testados pra achar a moldura, como fração do lado menor: arte
 * exportada com uma borda colorida em volta (ou a régua de um print) encosta
 * na borda da imagem e faria a inundação morrer no primeiro pixel. */
const FRAME_INSETS = [0, 0.004, 0.01, 0.02, 0.04, 0.08];

/** Cor dominante de um conjunto de pixels, quantizada em faixas de 16 pra o
 * ruído do JPG não virar dezenas de cores distintas. */
function dominantColor(rgba: ArrayLike<number>, indices: number[]): [number, number, number] {
  const contagem = new Map<number, number>();
  for (const i of indices) {
    const o = i * 4;
    const chave = ((rgba[o] >> 4) << 8) | ((rgba[o + 1] >> 4) << 4) | (rgba[o + 2] >> 4);
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  }
  let dominante = 0;
  let melhor = -1;
  for (const [chave, n] of contagem) {
    if (n > melhor) { melhor = n; dominante = chave; }
  }
  return [((dominante >> 8) & 15) * 16 + 8, ((dominante >> 4) & 15) * 16 + 8, (dominante & 15) * 16 + 8];
}

/** Inunda o fundo a partir do anel de 1 px recuado `inset` da borda, tratando
 * como fundo tudo que estiver fora dele. Devolve a máscara e quanto da imagem
 * ela ocupa — é por essa fração que se escolhe o melhor anel. */
function floodFromRing(
  rgba: ArrayLike<number>, w: number, h: number, inset: number,
  alphaThreshold: number, tolerance: number,
): { fundo: Uint8Array; share: number } {
  const total = w * h;
  const x0 = inset;
  const y0 = inset;
  const x1 = w - 1 - inset;
  const y1 = h - 1 - inset;
  const anel: number[] = [];
  for (let x = x0; x <= x1; x++) { anel.push(y0 * w + x, y1 * w + x); }
  for (let y = y0; y <= y1; y++) { anel.push(y * w + x0, y * w + x1); }

  const [r0, g0, b0] = dominantColor(rgba, anel);
  const tol2 = tolerance * tolerance;
  const ehFundo = (i: number): boolean => {
    const o = i * 4;
    if (rgba[o + 3] < alphaThreshold) return true;
    const dr = rgba[o] - r0, dg = rgba[o + 1] - g0, db = rgba[o + 2] - b0;
    return dr * dr + dg * dg + db * db <= tol2;
  };

  const fundo = new Uint8Array(total);
  // fora do anel já entra como fundo: é a moldura, não é desenho
  for (let y = 0; y < h; y++) {
    if (y >= y0 && y <= y1) {
      for (let x = 0; x < x0; x++) fundo[y * w + x] = 1;
      for (let x = x1 + 1; x < w; x++) fundo[y * w + x] = 1;
    } else {
      for (let x = 0; x < w; x++) fundo[y * w + x] = 1;
    }
  }

  const fila = new Int32Array(total);
  let cabeca = 0;
  let cauda = 0;
  let pintados = 0;
  // marca 1 = fora do anel (moldura), 2 = fundo alcançado pela inundação
  const semear = (i: number): void => {
    if (fundo[i] === 2 || !ehFundo(i)) return;
    fundo[i] = 2;
    pintados++;
    fila[cauda++] = i;
  };
  for (const i of anel) semear(i);
  while (cabeca < cauda) {
    const i = fila[cabeca++];
    const x = i % w;
    const y = (i / w) | 0;
    if (x > x0) semear(i - 1);
    if (x < x1) semear(i + 1);
    if (y > y0) semear(i - w);
    if (y < y1) semear(i + w);
  }

  for (let i = 0; i < total; i++) if (fundo[i] === 2) fundo[i] = 1;
  return { fundo, share: pintados / total };
}

/** Máscara do desenho a partir dos pixels crus.
 *
 * Numa arte com fundo removido a transparência já responde tudo. Numa foto ou
 * JPG — o caso comum de uma folha pronta de adesivos — não existe alpha nenhum,
 * e exigir "remova o fundo primeiro" fazia a divisão simplesmente não achar
 * nada: a imagem inteira era um bloco só. Aqui o fundo é deduzido pela cor:
 * inunda a partir das bordas, e o que a inundação não alcança é desenho. Buraco
 * interno (o branco dentro de uma letra) continua sendo desenho, que é o certo
 * pra decidir onde a folha se divide. Se a arte vier com moldura encostada na
 * borda, o anel de leitura recua até achar o fundo de verdade. */
export function maskFromPixels(
  rgba: ArrayLike<number>, w: number, h: number, options: SplitOptions = {},
): { mask: AlphaMask; fromAlpha: boolean } {
  const { alphaThreshold = 128, bgTolerance = 32 } = options;
  const total = w * h;
  const alpha = new Uint8Array(total);
  let transparentes = 0;
  for (let i = 0; i < total; i++) {
    alpha[i] = rgba[i * 4 + 3];
    if (alpha[i] < alphaThreshold) transparentes++;
  }
  if (transparentes >= total * TRANSPARENT_SHARE) return { mask: { data: alpha, w, h }, fromAlpha: true };

  // O fundo é lido a partir de um anel de 1 px: normalmente a borda da própria
  // imagem, mas se ela for uma moldura (borda colorida, tarja de print) a
  // inundação morre ali — então o anel vai recuando até encontrar fundo de
  // verdade. O que fica FORA do anel escolhido conta como fundo também, senão
  // a moldura viraria mais um "elemento".
  const lado = Math.min(w, h);
  let melhorFundo: Uint8Array | null = null;
  let melhorShare = -1;
  for (const fracao of FRAME_INSETS) {
    const inset = Math.min(Math.floor((lado - 1) / 2), Math.round(fracao * lado));
    const { fundo, share } = floodFromRing(rgba, w, h, inset, alphaThreshold, bgTolerance);
    if (share > melhorShare) {
      melhorShare = share;
      melhorFundo = fundo;
    }
    // Uma vez que o fundo já é a maior parte da imagem, recuar mais só tiraria
    // desenho — pode parar. Sem isso, o anel na moldura vermelha (que inunda a
    // própria moldura e para ali) passaria por leitura boa.
    if (share >= MIN_BG_SHARE) break;
  }
  const fundo = melhorFundo!;

  const data = new Uint8Array(total);
  for (let i = 0; i < total; i++) data[i] = fundo[i] ? 0 : 255;
  return { mask: { data, w, h }, fromAlpha: false };
}

/** Elementos encontrados no canvas, junto com o recorte de cada um — os dois
 * saem da MESMA passada, então o que a prévia marca na tela é exatamente o que
 * a divisão vai gerar. */
export interface SplitPlan {
  elements: SplitElement[];
  /** Vão usado de fato — o pedido, ou o que a escolha automática achou. */
  gapPx: number;
  /** true quando a separação veio da transparência; false quando o fundo teve
   * de ser deduzido pela cor das bordas. */
  fromAlpha: boolean;
  crop(element: SplitElement): HTMLCanvasElement;
}

export function planSplit(source: HTMLCanvasElement, options: SplitOptions = {}): SplitPlan {
  const { alphaThreshold = 128 } = options;
  const w = source.width;
  const h = source.height;
  const rgba = source.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const { mask, fromAlpha } = maskFromPixels(rgba, w, h, options);
  const { labels } = labelComponents(mask, alphaThreshold);
  const gapPx = options.autoGapCandidatesPx?.length ? suggestGapPx(mask, options) : options.gapPx ?? 0;
  const elements = findElements(mask, { ...options, gapPx });

  const crop = (el: SplitElement): HTMLCanvasElement => {
    const doGrupo = new Set(el.labels);
    const canvas = document.createElement('canvas');
    canvas.width = el.w;
    canvas.height = el.h;
    const ctx = canvas.getContext('2d')!;
    const out = ctx.createImageData(el.w, el.h);
    for (let y = 0; y < el.h; y++) {
      for (let x = 0; x < el.w; x++) {
        const origem = (el.y + y) * w + (el.x + x);
        const label = labels[origem];
        // Só entram os pixels DESTE elemento: o braço do vizinho que caia
        // dentro da caixa fica de fora, e o fundo sai transparente — inclusive
        // quando ele veio de uma foto, que é o que faz o contorno seguir o
        // desenho em vez de um retângulo.
        // Pixel sem rótulo é fundo: sai fora quando o fundo veio da cor (é o
        // que faz o contorno seguir o desenho, e não um retângulo) e fica
        // quando veio do alpha, que é franja de anti-aliasing da própria arte.
        if (label ? !doGrupo.has(label) : !fromAlpha) continue;
        const destino = (y * el.w + x) * 4;
        const fonte = origem * 4;
        out.data[destino] = rgba[fonte];
        out.data[destino + 1] = rgba[fonte + 1];
        out.data[destino + 2] = rgba[fonte + 2];
        out.data[destino + 3] = rgba[fonte + 3];
      }
    }
    ctx.putImageData(out, 0, 0);
    return canvas;
  };

  return { elements, gapPx, fromAlpha, crop };
}
