/** Textos e figurinhas por cima do post. Desenhados no canvas depois da foto
 * (e da nitidez), pelo mesmo caminho na prévia, na exportação e no lote. As
 * medidas são frações do quadro, pra valerem em qualquer tamanho de saída. */

import { FontLibrary, nearestWeight } from './fonts';

export type TextStyle = 'simples' | 'fundo' | 'contorno' | 'sombra';

interface OverlayBase {
  id: string;
  /** Centro, de 0 a 1 do quadro. */
  x: number;
  y: number;
  /** Altura da letra (ou da figurinha) em fração do lado menor do quadro. */
  size: number;
  rotation: number;
}

export interface TextOverlay extends OverlayBase {
  kind: 'texto';
  text: string;
  fontId: string;
  bold: boolean;
  color: string;
  style: TextStyle;
  /** Cor do fundo (estilo "fundo") ou do contorno (estilo "contorno"). */
  accent: string;
}

export interface StickerOverlay extends OverlayBase {
  kind: 'figurinha';
  sticker: string;
}

export type Overlay = TextOverlay | StickerOverlay;

export interface StickerDef {
  id: string;
  label: string;
  /** Emoji desenhado com a fonte do sistema, ou selo vetorial desenhado aqui. */
  emoji?: string;
}

export const STICKERS: StickerDef[] = [
  { id: 'novo', label: 'NOVO' },
  { id: 'promo', label: 'PROMO' },
  { id: 'oferta', label: '-50%' },
  { id: 'coracao', label: 'Coração' },
  { id: 'estrela', label: 'Estrela' },
  { id: 'brilho', label: 'Brilho' },
  { id: 'seta', label: 'Seta' },
  ...['😍', '🎉', '❤️', '🔥', '✨', '🎂', '🌸', '👍', '😂', '🥳', '💖', '📍'].map((e) => ({ id: e, label: e, emoji: e })),
];

export const TEXT_FONTS = ['poppins', 'montserrat', 'bebas-neue', 'fredoka', 'luckiest-guy', 'pacifico', 'great-vibes', 'dancing-script', 'caveat', 'playfair-display', 'permanent-marker'];

/** Caixa (girada) de cada camada no canvas, pra clicar e arrastar. */
export interface OverlayBox {
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

export function hitOverlay(boxes: OverlayBox[], x: number, y: number): string | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    const a = (-b.rotation * Math.PI) / 180;
    const dx = x - b.cx, dy = y - b.cy;
    const u = dx * Math.cos(a) - dy * Math.sin(a);
    const v = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(u) <= b.w / 2 && Math.abs(v) <= b.h / 2) return b.id;
  }
  return null;
}

/** Carrega as fontes usadas (FontFace) antes de desenhar. */
export async function ensureOverlayFonts(overlays: Overlay[], fonts: FontLibrary): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  for (const o of overlays) {
    if (o.kind !== 'texto') continue;
    const fam = fonts.family(o.fontId);
    const weight = nearestWeight(fam.weights, o.bold ? 700 : 400);
    const key = `${fam.name}@${weight}`;
    if (loaded.has(key)) continue;
    loaded.add(key);
    const face = new FontFace(fam.name, `url(${new URL(`fonts/${o.fontId}-${weight}.woff`, document.baseURI).href})`, { weight: String(weight) });
    jobs.push(face.load().then((f) => document.fonts.add(f)).catch(() => loaded.delete(key)));
  }
  await Promise.all(jobs);
}
const loaded = new Set<string>();

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function starPath(ctx: CanvasRenderingContext2D, r: number, points: number, inner: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? r * inner : r;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    ctx.lineTo(rr * Math.cos(a), rr * Math.sin(a));
  }
  ctx.closePath();
}

function heartPath(ctx: CanvasRenderingContext2D, s: number): void {
  // coração numa caixa de lado s, centrado
  const k = s / 100;
  ctx.beginPath();
  ctx.moveTo(0, 42 * k);
  ctx.bezierCurveTo(-32 * k, 20 * k, -50 * k, 0, -50 * k, -20 * k);
  ctx.bezierCurveTo(-50 * k, -38 * k, -36 * k, -48 * k, -22 * k, -48 * k);
  ctx.bezierCurveTo(-12 * k, -48 * k, -4 * k, -42 * k, 0, -34 * k);
  ctx.bezierCurveTo(4 * k, -42 * k, 12 * k, -48 * k, 22 * k, -48 * k);
  ctx.bezierCurveTo(36 * k, -48 * k, 50 * k, -38 * k, 50 * k, -20 * k);
  ctx.bezierCurveTo(50 * k, 0, 32 * k, 20 * k, 0, 42 * k);
  ctx.closePath();
}

/** Desenha um selo vetorial centrado na origem; devolve a caixa (w, h). */
function drawSticker(ctx: CanvasRenderingContext2D, id: string, s: number): [number, number] {
  const pill = (text: string, bg: string, fg: string): [number, number] => {
    ctx.font = `800 ${s * 0.5}px Poppins, system-ui, sans-serif`;
    const w = ctx.measureText(text).width + s * 0.6;
    const h = s * 0.8;
    ctx.fillStyle = bg;
    roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, s * 0.02);
    return [w, h];
  };
  switch (id) {
    case 'novo': return pill('NOVO', '#e63946', '#ffffff');
    case 'promo': {
      ctx.fillStyle = '#ffd60a';
      starPath(ctx, s * 0.62, 14, 0.8);
      ctx.fill();
      ctx.fillStyle = '#1d1d1d';
      ctx.font = `900 ${s * 0.26}px Poppins, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PROMO', 0, s * 0.02);
      return [s * 1.24, s * 1.24];
    }
    case 'oferta': {
      ctx.fillStyle = '#2a9d8f';
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${s * 0.36}px Poppins, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('-50%', 0, s * 0.02);
      return [s * 1.1, s * 1.1];
    }
    case 'coracao':
      ctx.fillStyle = '#ff4d6d';
      heartPath(ctx, s);
      ctx.fill();
      return [s, s * 0.92];
    case 'estrela':
      ctx.fillStyle = '#ffc300';
      starPath(ctx, s * 0.55, 5, 0.45);
      ctx.fill();
      return [s * 1.1, s * 1.1];
    case 'brilho':
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(255,215,0,0.9)';
      ctx.shadowBlur = s * 0.2;
      starPath(ctx, s * 0.5, 4, 0.2);
      ctx.fill();
      return [s, s];
    case 'seta': {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = s * 0.12;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = s * 0.08;
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, s * 0.25);
      ctx.quadraticCurveTo(-s * 0.1, -s * 0.35, s * 0.45, -s * 0.15);
      ctx.moveTo(s * 0.2, -s * 0.38);
      ctx.lineTo(s * 0.45, -s * 0.15);
      ctx.lineTo(s * 0.18, s * 0.05);
      ctx.stroke();
      return [s * 1.1, s * 0.8];
    }
    default: {
      // emoji: a fonte colorida do sistema
      ctx.font = `${s}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(id, 0, s * 0.06);
      return [s * 1.15, s * 1.15];
    }
  }
}

/** Desenha as camadas no canvas (tamanho que ele já tiver). `selected`
 * ganha a moldura tracejada — só na prévia. */
export function drawOverlays(ctx: CanvasRenderingContext2D, w: number, h: number, overlays: Overlay[], fonts: FontLibrary, selected: string | null = null): OverlayBox[] {
  const base = Math.min(w, h);
  const boxes: OverlayBox[] = [];
  for (const o of overlays) {
    const s = o.size * base;
    const cx = o.x * w, cy = o.y * h;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((o.rotation * Math.PI) / 180);
    let bw: number, bh: number;
    if (o.kind === 'figurinha') {
      [bw, bh] = drawSticker(ctx, o.sticker, s);
    } else {
      const fam = fonts.family(o.fontId);
      const weight = nearestWeight(fam.weights, o.bold ? 700 : 400);
      ctx.font = `${weight} ${s}px "${fam.name}", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = o.text.split('\n');
      const lh = s * 1.15;
      const widths = lines.map((l) => ctx.measureText(l).width);
      bw = Math.max(...widths, s * 0.5) + s * 0.5;
      bh = lh * lines.length + s * 0.3;
      if (o.style === 'fundo') {
        ctx.fillStyle = o.accent;
        roundRect(ctx, -bw / 2, -bh / 2, bw, bh, s * 0.3);
        ctx.fill();
      }
      lines.forEach((line, i) => {
        const y = (i - (lines.length - 1) / 2) * lh;
        if (o.style === 'contorno') {
          ctx.lineJoin = 'round';
          ctx.lineWidth = s * 0.16;
          ctx.strokeStyle = o.accent;
          ctx.strokeText(line, 0, y);
        }
        if (o.style === 'sombra') {
          ctx.shadowColor = 'rgba(0,0,0,0.55)';
          ctx.shadowBlur = s * 0.18;
          ctx.shadowOffsetY = s * 0.06;
        }
        ctx.fillStyle = o.color;
        ctx.fillText(line, 0, y);
        ctx.shadowColor = 'transparent';
      });
    }
    if (o.id === selected) {
      ctx.shadowColor = 'transparent';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = Math.max(1.5, base / 400);
      ctx.strokeStyle = '#2d7ff9';
      ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
    }
    ctx.restore();
    boxes.push({ id: o.id, cx, cy, w: bw, h: bh, rotation: o.rotation });
  }
  return boxes;
}
