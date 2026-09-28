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
  /** Espaço de foto: marca onde uma foto entra (modelo de entregas). As fotos
   * escolhidas preenchem esses espaços em ordem, recortadas pro tamanho dele,
   * e ficam por cima — o espaço continua embaixo, pra voltar se a foto sair. */
  placeholder?: boolean;
}

/** Arquivo da marca (logo, laço, ícone), por id de `BRAND_ASSETS`. */
export interface ImageOverlay extends OverlayBase {
  kind: 'imagem';
  asset: string;
  aspect: number;
}

/** Foto como camada: várias por post, cada uma do seu tamanho — é o que monta
 * um carrossel de fotos, ou um post com duas ou três fotos lado a lado. A
 * foto vai embutida (data URL já reduzida), como a foto de fundo. */
export interface PhotoOverlay extends OverlayBase {
  kind: 'foto';
  src: string;
  /** Largura ÷ altura da foto. */
  aspect: number;
  /** Raio dos cantos, em fração do lado menor da foto (0 a 0,5). */
  radius: number;
  /** Borda; vazio = sem borda. */
  border: string;
  /** Espessura da borda, em fração do lado menor da foto. */
  borderWidth: number;
  shadow?: boolean;
  /** Largura ÷ altura da foto em si, quando a caixa (`aspect`) tem outra
   * proporção: a foto preenche a caixa e o que sobra é cortado, pelo centro.
   * É o caso da foto que entra num espaço de foto. */
  natural?: number;
  /** Espaço de foto que esta foto preenche. */
  slotId?: string;
}

export type Overlay = TextOverlay | StickerOverlay | ShapeOverlay | ImageOverlay | PhotoOverlay;

/** Nome curto de uma camada, pra lista do painel. */
export function overlayLabel(o: Overlay): string {
  switch (o.kind) {
    case 'texto': return o.text.split('\n')[0] || 'Texto';
    case 'figurinha': return o.sticker;
    case 'forma': return o.placeholder ? 'Espaço de foto' : o.shape === 'circulo' ? 'Círculo' : 'Retângulo';
    case 'imagem': return brandAssetDef(o.asset)?.label ?? o.asset;
    case 'foto': return 'Foto';
  }
}

export function overlayKindLabel(o: Overlay): string {
  return { texto: 'texto', figurinha: 'figurinha', forma: 'forma', imagem: 'marca', foto: 'foto' }[o.kind];
}

/** Fotos das camadas já decodificadas, pela data URL (a mesma foto
 * duplicada não carrega duas vezes). */
const photoCache = new Map<string, HTMLImageElement>();
const photoPending = new Map<string, Promise<void>>();

function loadPhoto(src: string): Promise<void> {
  if (photoCache.has(src)) return Promise.resolve();
  let job = photoPending.get(src);
  if (!job) {
    job = new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => { photoCache.set(src, img); photoPending.delete(src); resolve(); };
      img.onerror = () => { photoPending.delete(src); resolve(); };
      img.src = src;
    });
    photoPending.set(src, job);
  }
  return job;
}

/** Decodifica fotos antes de elas virarem camada, pra entrarem já desenhadas. */
export function preloadPhotos(srcs: string[]): Promise<void> {
  return Promise.all(srcs.map(loadPhoto)).then(() => undefined);
}

/** Carrega os arquivos da marca e as fotos usados pelas camadas. */
export function ensureOverlayAssets(overlays: Overlay[]): Promise<void> {
  const fotos = overlays.filter((o): o is PhotoOverlay => o.kind === 'foto').map((o) => loadPhoto(o.src));
  return Promise.all([
    ensureBrandAssets(overlays.filter((o): o is ImageOverlay => o.kind === 'imagem').map((o) => o.asset)),
    ...fotos,
  ]).then(() => undefined);
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

/** Foto centrada na origem, com cantos, borda e sombra. */
function drawPhoto(ctx: CanvasRenderingContext2D, o: PhotoOverlay, w: number, h: number): void {
  const img = photoCache.get(o.src);
  const side = Math.min(w, h);
  const r = Math.min(Math.max(0, o.radius), 0.5) * side;
  const path = () => {
    ctx.beginPath();
    if (r > 0) roundRect(ctx, -w / 2, -h / 2, w, h, r);
    else ctx.rect(-w / 2, -h / 2, w, h);
  };
  if (o.shadow) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
    ctx.shadowBlur = side * 0.06;
    ctx.shadowOffsetY = side * 0.02;
    path();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  path();
  ctx.clip();
  if (img) {
    ctx.imageSmoothingQuality = 'high';
    const [sx, sy, sw, sh] = photoCrop(img.naturalWidth || img.width, img.naturalHeight || img.height, o);
    ctx.drawImage(img, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
  } else {
    ctx.fillStyle = '#eeeeee';
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  ctx.restore();
  const bwid = o.border ? o.borderWidth * side : 0;
  if (bwid > 0) {
    ctx.save();
    ctx.strokeStyle = o.border;
    ctx.lineWidth = bwid;
    // A borda fica pra dentro, pra a foto não crescer ao ganhar moldura.
    ctx.beginPath();
    const i = bwid / 2;
    if (r > 0) roundRect(ctx, -w / 2 + i, -h / 2 + i, w - bwid, h - bwid, Math.max(0, r - i));
    else ctx.rect(-w / 2 + i, -h / 2 + i, w - bwid, h - bwid);
    ctx.stroke();
    ctx.restore();
  }
}

/** Pedaço da foto (em px dela) que vai pra caixa da camada: a foto inteira,
 * ou, com `natural`, o recorte central que preenche a caixa sem deformar. */
export function photoCrop(iw: number, ih: number, o: Pick<PhotoOverlay, 'aspect' | 'natural'>): [number, number, number, number] {
  if (!o.natural || Math.abs(o.natural - o.aspect) < 1e-3) return [0, 0, iw, ih];
  if (iw / ih > o.aspect) {
    const sw = ih * o.aspect;
    return [(iw - sw) / 2, 0, sw, ih];
  }
  const sh = iw / o.aspect;
  return [0, (ih - sh) / 2, iw, sh];
}

/** Sinal de "+" no meio do espaço de foto vazio (a foto, quando entra, cobre). */
function drawPlaceholderMark(ctx: CanvasRenderingContext2D, o: ShapeOverlay, w: number, h: number): void {
  const r = Math.min(w, h) * 0.09;
  ctx.save();
  ctx.fillStyle = o.stroke || '#E7548C';
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = r * 0.18;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.45, 0);
  ctx.lineTo(r * 0.45, 0);
  ctx.moveTo(0, -r * 0.45);
  ctx.lineTo(0, r * 0.45);
  ctx.stroke();
  ctx.restore();
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
  if (o.placeholder) drawPlaceholderMark(ctx, o, w, h);
  return [w, h];
}

/** Desenha as camadas no canvas (tamanho que ele já tiver). `selected`
 * ganha a moldura tracejada — só na prévia. */
export function drawOverlays(
  ctx: CanvasRenderingContext2D, w: number, h: number, overlays: Overlay[], fonts: FontLibrary,
  selected: string | readonly string[] | null = null,
): OverlayBox[] {
  const base = Math.min(w, h);
  const sel = new Set(selected === null ? [] : typeof selected === 'string' ? [selected] : selected);
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
    } else if (o.kind === 'foto') {
      bh = s;
      bw = s * o.aspect;
      drawPhoto(ctx, o, bw, bh);
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
    if (sel.has(o.id)) {
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
