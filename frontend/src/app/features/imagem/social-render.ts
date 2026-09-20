/** O desenho do post. Fica fora do componente porque três lugares precisam do
 * mesmo resultado: a prévia grande, a exportação e as miniaturas dos filtros.
 * Enquanto for um caminho só, o que aparece na tela é o que sai no arquivo. */

import { Adjustments, BgMode, FitMode, filterString, frameRect } from './social-model';

export interface FrameOptions {
  adjust: Adjustments;
  fit: FitMode;
  scale: number;
  dx: number;
  dy: number;
  bgMode: BgMode;
  bgColor: string;
}

/** Fonte de imagem com tamanho declarado — serve tanto pra `HTMLImageElement`
 * quanto pro canvas do recorte que alimenta as miniaturas. */
export interface Source {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export function sourceOf(img: HTMLImageElement): Source {
  return { image: img, width: img.naturalWidth || 1, height: img.naturalHeight || 1 };
}

/** Desenha fundo, foto com os ajustes de cor e as camadas de acabamento
 * (temperatura, desbotado, vinheta) no canvas, no tamanho que ele já tiver. */
export function paintFrame(canvas: HTMLCanvasElement, src: Source, o: FrameOptions): void {
  const ctx = canvas.getContext('2d');
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

  if (o.bgMode === 'desfoque') {
    // Fundo borrado: a própria foto cobrindo o quadro, bem desfocada.
    const cover = frameRect(src.width, src.height, w, h, 'cover', 1.18, 0, 0);
    ctx.filter = `blur(${size * 0.04}px) brightness(0.92) saturate(120%)`;
    ctx.drawImage(src.image, cover.x, cover.y, cover.w, cover.h);
    ctx.filter = 'none';
  } else {
    ctx.fillStyle = o.bgColor;
    ctx.fillRect(0, 0, w, h);
  }

  const r = frameRect(src.width, src.height, w, h, o.fit, o.scale, o.dx, o.dy);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.filter = filterString(a, size);
  ctx.drawImage(src.image, r.x, r.y, r.w, r.h);
  ctx.restore();
  ctx.filter = 'none';

  if (a.temperature) {
    // Quente puxa pro laranja, frio pro azul. `overlay` mexe na cor sem lavar
    // as altas luzes, que é o que um ajuste de temperatura deve fazer.
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = Math.min(0.45, Math.abs(a.temperature) / 100 * 0.45);
    ctx.fillStyle = a.temperature > 0 ? '#ff8a2b' : '#2b7dff';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  if (a.fade) {
    ctx.globalAlpha = (a.fade / 100) * 0.4;
    ctx.fillStyle = '#f5f2ee';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  if (a.vignette) {
    const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.72);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${(a.vignette / 100) * 0.75})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
}
