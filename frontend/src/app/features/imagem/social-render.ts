/** O desenho do post. Fica fora do componente porque três lugares precisam do
 * mesmo resultado: a prévia grande, a exportação e as miniaturas dos filtros.
 * Enquanto for um caminho só, o que aparece na tela é o que sai no arquivo. */

import { Adjustments, BgMode, FitMode, PhotoSlot, frameRect, slotRect } from './social-model';
import { brandImage } from './brand-assets';
import { applyLook, isNeutralLook } from './color';
import { aplicarLuz } from './light';

export interface FrameOptions {
  adjust: Adjustments;
  fit: FitMode;
  scale: number;
  dx: number;
  dy: number;
  bgMode: BgMode;
  bgColor: string;
  /** Padrão da marca por cima da cor de fundo (id de `BRAND_ASSETS`). */
  bgPattern?: string;
  /** Espaço reservado pra foto; sem ele, a foto ocupa o quadro. */
  slot?: PhotoSlot | null;
  /** Prévia: o espaço vazio da foto ganha o aviso "sua foto aqui". Na
   * exportação ele sai só como um cartão branco. */
  placeholder?: boolean;
}

/** Fonte de imagem com tamanho declarado — serve tanto pra `HTMLImageElement`
 * quanto pro canvas do recorte que alimenta as miniaturas. */
export interface Source {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/** A foto de trabalho: o arquivo como veio, ou o canvas de uma redução. */
export type PhotoSource = HTMLImageElement | HTMLCanvasElement;

export function sourceOf(photo: PhotoSource): Source {
  return 'naturalWidth' in photo
    ? { image: photo, width: photo.naturalWidth || 1, height: photo.naturalHeight || 1 }
    : { image: photo, width: photo.width, height: photo.height };
}

/** Reduz pela metade, repetidamente, até o alvo.
 *
 * Um `drawImage` único de 4000 px para 1080 amostra a origem grosso: a
 * filtragem bilinear olha quatro pixels vizinhos e ignora os outros doze de
 * cada bloco, então trama fina e texto serrilham. Reduzir em etapas faz cada
 * passo ser uma média honesta do anterior, que é o mesmo raciocínio de um
 * mipmap. A última etapa vai direto ao alvo, com a filtragem boa do navegador. */
export function stepDownscale(src: Source, targetW: number, targetH: number): HTMLCanvasElement {
  let current = src.image;
  let w = src.width;
  let h = src.height;

  while (w / 2 > targetW && h / 2 > targetH) {
    w = Math.max(1, Math.round(w / 2));
    h = Math.max(1, Math.round(h / 2));
    current = drawInto(current, w, h);
  }
  return drawInto(current, Math.max(1, Math.round(targetW)), Math.max(1, Math.round(targetH)));
}

function drawInto(image: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, w, h);
  }
  return canvas;
}

/** Desenha fundo, foto com os ajustes de cor e as camadas de acabamento
 * (temperatura, desbotado, vinheta) no canvas, no tamanho que ele já tiver. */
export function paintFrame(canvas: HTMLCanvasElement, src: Source | null, o: FrameOptions): void {
  if (o.slot) {
    paintSlotted(canvas, src, o, o.slot);
    return;
  }
  // A leitura de volta dos pixels é parte do caminho agora (a cor é feita em
  // ponto flutuante), então o contexto já nasce avisado disso.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const size = Math.max(w, h);
  const a = o.adjust;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.clearRect(0, 0, w, h);

  paintBackground(ctx, w, h, src, o);
  // Modelo sem foto: o quadro é só o fundo, e as camadas vêm por cima.
  if (!src) return;

  const r = frameRect(src.width, src.height, w, h, o.fit, o.scale, o.dx, o.dy);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  // Só o desfoque continua sendo filtro do canvas: ele é espacial, olha os
  // vizinhos, e não cabe na conta por pixel que vem depois.
  ctx.filter = a.blur ? `blur(${(a.blur / 100) * size * 0.03}px)` : 'none';
  ctx.drawImage(src.image, r.x, r.y, r.w, r.h);
  ctx.restore();
  ctx.filter = 'none';

  // Cor, acabamento e quantização com dithering, tudo numa passada em ponto
  // flutuante. Sem ajuste nenhum não há o que fazer — e aí nem o ruído do
  // dithering entra, pra "Original" ser mesmo o arquivo original.
  if (!isNeutralLook(a)) {
    const data = ctx.getImageData(0, 0, w, h);
    // Sombras e luzes primeiro: elas consertam a iluminação da cena, e cor e
    // acabamento devem ser decididos sobre a foto já iluminada — é a ordem de
    // quem edita à mão, e a que evita esticar contraste em cima de uma sombra
    // que ia ser aberta em seguida.
    aplicarLuz(data.data, w, h, a.shadows, a.highlights);
    applyLook(data.data, w, h, a);
    ctx.putImageData(data, 0, 0);
  }
}

/** Fundo do quadro: a própria foto borrada, ou a cor com o padrão por cima. */
function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number, src: Source | null, o: FrameOptions): void {
  if (o.bgMode === 'desfoque' && src) {
    // Fundo borrado: a própria foto cobrindo o quadro, bem desfocada.
    const size = Math.max(w, h);
    const cover = frameRect(src.width, src.height, w, h, 'cover', 1.18, 0, 0);
    ctx.filter = `blur(${size * 0.04}px) brightness(0.92) saturate(120%)`;
    ctx.drawImage(src.image, cover.x, cover.y, cover.w, cover.h);
    ctx.filter = 'none';
    return;
  }
  ctx.fillStyle = o.bgColor;
  ctx.fillRect(0, 0, w, h);
  const tile = o.bgPattern ? brandImage(o.bgPattern) : null;
  const pattern = tile ? ctx.createPattern(tile, 'repeat') : null;
  if (tile && pattern) {
    // Quatro ladrilhos no lado menor: o desenho fica do mesmo tamanho na
    // prévia e no arquivo, e em qualquer formato.
    const k = Math.min(w, h) / 4 / (tile.naturalWidth || 200);
    pattern.setTransform(new DOMMatrix().scale(k));
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, w, h);
  }
}

/** Quadro de modelo com espaço pra foto: fundo no quadro inteiro e a foto
 * (com o enquadramento e a cor dela) recortada dentro do espaço, de cantos
 * arredondados. Cor e filtro valem só pra foto — o fundo é da marca. */
function paintSlotted(canvas: HTMLCanvasElement, src: Source | null, o: FrameOptions, slot: PhotoSlot): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.clearRect(0, 0, w, h);
  paintBackground(ctx, w, h, null, o);

  const r = slotRect(slot, w, h);
  const iw = Math.max(1, Math.round(r.w));
  const ih = Math.max(1, Math.round(r.h));
  ctx.save();
  ctx.beginPath();
  if (r.r > 0) ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(r.r, r.w / 2, r.h / 2));
  else ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  if (src) {
    const inner = document.createElement('canvas');
    inner.width = iw;
    inner.height = ih;
    paintFrame(inner, src, { ...o, slot: null, bgPattern: '' });
    ctx.drawImage(inner, r.x, r.y, r.w, r.h);
  } else {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  ctx.restore();

  if (!src && o.placeholder) {
    const base = Math.min(w, h);
    ctx.save();
    ctx.strokeStyle = '#F28BAE';
    ctx.lineWidth = Math.max(1.5, base * 0.004);
    ctx.setLineDash([base * 0.014, base * 0.012]);
    ctx.beginPath();
    const inset = ctx.lineWidth / 2;
    ctx.roundRect(r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2, Math.max(0, Math.min(r.r, r.w / 2, r.h / 2) - inset));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#E7548C';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fs = Math.max(10, Math.min(r.w, r.h) * 0.07, base * 0.022);
    ctx.font = `600 ${fs}px Montserrat, system-ui, sans-serif`;
    ctx.fillText('sua foto aqui', r.x + r.w / 2, r.y + r.h / 2 - fs * 0.7);
    ctx.font = `400 ${fs * 0.7}px Montserrat, system-ui, sans-serif`;
    ctx.fillStyle = '#4D4D4D';
    ctx.fillText('solte, cole ou abra uma foto', r.x + r.w / 2, r.y + r.h / 2 + fs * 0.6);
    ctx.restore();
  }
}
