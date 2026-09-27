/** Textos e figurinhas por cima do post. Desenhados no canvas depois da foto
 * (e da nitidez), pelo mesmo caminho na prévia, na exportação e no lote. As
 * medidas são frações do quadro, pra valerem em qualquer tamanho de saída. */

import { FontLibrary, nearestWeight } from './fonts';
import { brandAssetDef, brandImage, ensureBrandAssets } from './brand-assets';

export type TextStyle = 'simples' | 'fundo' | 'contorno' | 'sombra';

interface OverlayBase {
  id: string;
  /** Centro, de 0 a 1 do quadro. */
  x: number;
  y: number;
  /** Altura da letra (ou da figurinha) em fração do lado menor do quadro. */
  size: number;
  rotation: number;
  /** Travada: não é pega por clique no palco (só pela lista de camadas). É o
   * caso das molduras e fundos dos modelos, que cobrem o quadro e senão
   * roubariam o arraste da foto. */
  locked?: boolean;
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
  /** Espaço extra entre as letras, em fração do tamanho da letra. */
  tracking?: number;
  /** Alinhamento. À esquerda (ou à direita), `x` marca a borda esquerda (ou
   * direita) do texto, e não o centro — é o que deixa uma lista alinhada. */
  align?: 'center' | 'left' | 'right';
}

export interface StickerOverlay extends OverlayBase {
  kind: 'figurinha';
  sticker: string;
}

export type ShapeKind = 'retangulo' | 'circulo';

/** Forma simples: retângulo (com ou sem cantos arredondados) ou círculo. É o
 * que os modelos usam pra moldura, cartão e bolinha de número. */
export interface ShapeOverlay extends OverlayBase {
  kind: 'forma';
  shape: ShapeKind;
  /** Largura ÷ altura. A altura é `size`, como nas outras camadas. */
  aspect: number;
  /** Cor de preenchimento; vazio = sem preenchimento. */
  fill: string;
  /** Cor do contorno; vazio = sem contorno. */
  stroke: string;
  /** Espessura do contorno, em fração do lado menor do quadro. */
  strokeWidth: number;
  /** Raio dos cantos, em fração do lado menor do quadro. */
  radius: number;
  dashed?: boolean;
}

/** Arquivo da marca (logo, laço, ícone), por id de `BRAND_ASSETS`. */
export interface ImageOverlay extends OverlayBase {
  kind: 'imagem';
  asset: string;
  aspect: number;
}

export type Overlay = TextOverlay | StickerOverlay | ShapeOverlay | ImageOverlay;

/** Nome curto de uma camada, pra lista do painel. */
export function overlayLabel(o: Overlay): string {
  switch (o.kind) {
    case 'texto': return o.text.split('\n')[0] || 'Texto';
    case 'figurinha': return o.sticker;
    case 'forma': return o.shape === 'circulo' ? 'Círculo' : 'Retângulo';
    case 'imagem': return brandAssetDef(o.asset)?.label ?? o.asset;
  }
}

export function overlayKindLabel(o: Overlay): string {
  return { texto: 'texto', figurinha: 'figurinha', forma: 'forma', imagem: 'marca' }[o.kind];
}

/** Carrega os arquivos da marca usados pelas camadas. */
export function ensureOverlayAssets(overlays: Overlay[]): Promise<void> {
  return ensureBrandAssets(overlays.filter((o): o is ImageOverlay => o.kind === 'imagem').map((o) => o.asset));
}

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
  locked?: boolean;
}

export function hitOverlay(boxes: OverlayBox[], x: number, y: number): string | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (b.locked) continue;
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

/** Desenha uma forma centrada na origem; devolve a caixa (w, h). */
function drawShape(ctx: CanvasRenderingContext2D, o: ShapeOverlay, s: number, base: number): [number, number] {
  const h = s;
  const w = s * o.aspect;
  const lw = o.strokeWidth * base;
  ctx.beginPath();
  if (o.shape === 'circulo') {
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    const r = Math.min(o.radius * base, w / 2, h / 2);
    if (r > 0) roundRect(ctx, -w / 2, -h / 2, w, h, r);
    else ctx.rect(-w / 2, -h / 2, w, h);
  }
  if (o.fill) {
    ctx.fillStyle = o.fill;
    ctx.fill();
  }
  if (o.stroke && lw > 0) {
    ctx.strokeStyle = o.stroke;
    ctx.lineWidth = lw;
    if (o.dashed) {
      ctx.lineCap = 'round';
      ctx.setLineDash([lw * 3, lw * 3.5]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  return [w, h];
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
    let shift = 0;
    if (o.kind === 'figurinha') {
      [bw, bh] = drawSticker(ctx, o.sticker, s);
    } else if (o.kind === 'forma') {
      [bw, bh] = drawShape(ctx, o, s, base);
    } else if (o.kind === 'imagem') {
      bh = s;
      bw = s * o.aspect;
      const img = brandImage(o.asset);
      if (img) ctx.drawImage(img, -bw / 2, -bh / 2, bw, bh);
    } else {
      const fam = fonts.family(o.fontId);
      const weight = nearestWeight(fam.weights, o.bold ? 700 : 400);
      ctx.font = `${weight} ${s}px "${fam.name}", system-ui, sans-serif`;
      const left = o.align === 'left';
      const right = o.align === 'right';
      ctx.textAlign = left ? 'left' : right ? 'right' : 'center';
      ctx.textBaseline = 'middle';
      // `letterSpacing` já entra na medida, então a caixa de seleção acompanha.
      // Navegador sem suporte só desenha as letras juntas.
      const spacing = o.tracking ? `${o.tracking * s}px` : '0px';
      if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = spacing;
      const lines = o.text.split('\n');
      const lh = s * 1.15;
      const widths = lines.map((l) => ctx.measureText(l).width);
      bw = Math.max(...widths, s * 0.5) + s * 0.5;
      bh = lh * lines.length + s * 0.3;
      if (left || right) {
        // A caixa começa (ou termina) meia margem além da borda: o centro dela
        // anda pro lado do texto, no eixo já girado da camada.
        shift = (left ? 1 : -1) * (bw / 2 - s * 0.25);
        ctx.translate(shift, 0);
      }
      // Centrado, o espaçamento sobra depois da última letra: meio espaço pra
      // direita devolve o texto ao meio.
      const tx = left ? -bw / 2 + s * 0.25 : right ? bw / 2 - s * 0.25 : ((o.tracking ?? 0) * s) / 2;
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
          ctx.strokeText(line, tx, y);
        }
        if (o.style === 'sombra') {
          ctx.shadowColor = 'rgba(0,0,0,0.55)';
          ctx.shadowBlur = s * 0.18;
          ctx.shadowOffsetY = s * 0.06;
        }
        ctx.fillStyle = o.color;
        ctx.fillText(line, tx, y);
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
    const rad = (o.rotation * Math.PI) / 180;
    boxes.push({ id: o.id, cx: cx + shift * Math.cos(rad), cy: cy + shift * Math.sin(rad), w: bw, h: bh, rotation: o.rotation, locked: o.locked });
  }
  return boxes;
}
