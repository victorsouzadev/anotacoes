import { getStroke } from 'perfect-freehand';
import { ArrowElement, CanvasElement, ChecklistElement, ImageElement, PaperStyle, Point, ShapeElement, StickyElement, StrokeElement, TextElement, TEXT_FONT_STACKS } from '../../../data/models';
import { arrowBendPoint, arrowControlPoint, arrowEndAngle } from './arrow-geometry';
import { checklistItemLayouts } from './checklist-layout';
import { elementBBox, HANDLE_SIZE, unionBBox } from './hit-test';
import { STICKY_PADDING, stickyLineHeight } from './sticky-layout';
import { Viewport } from './viewport';

const CORNER_RADIUS = 10;
const ACCENT = '#6d5ef8';

const DPR_CAP = 2;
const RULED_LINE_SPACING = 28;
const GRID_SPACING = 20;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
  /** Cache de HTMLImageElement por data URL — decodificar de novo a cada frame seria
   * caro; carregamento é assíncrono, então o primeiro render de uma imagem nova sai em
   * branco e re-renderiza via onImageLoad assim que ela termina de decodificar. */
  private imageCache = new Map<string, HTMLImageElement>();

  constructor(private canvas: HTMLCanvasElement, private viewport: Viewport, private onImageLoad?: () => void) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D não suportado');
    this.ctx = ctx;
  }

  resize(cssW: number, cssH: number): void {
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
  }

  get width(): number {
    return this.canvas.width / this.dpr;
  }

  get height(): number {
    return this.canvas.height / this.dpr;
  }

  render(elements: CanvasElement[], selectedIds: Set<string>, preview: CanvasElement | null, marquee: { x: number; y: number; w: number; h: number } | null, paperStyle: PaperStyle = 'blank'): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.scale(this.viewport.scale, this.viewport.scale);
    ctx.translate(-this.viewport.offsetX, -this.viewport.offsetY);

    this.drawPaper(paperStyle);

    const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
    for (const el of sorted) {
      this.drawElement(el);
      if (selectedIds.has(el.id)) this.drawSelectionOutline(el);
    }
    if (preview) this.drawElement(preview);
    if (selectedIds.size) this.drawSelectionHandles(elements, selectedIds);

    ctx.restore();

    if (marquee) {
      ctx.save();
      ctx.strokeStyle = '#2f6fed';
      ctx.fillStyle = 'rgba(47,111,237,0.1)';
      ctx.lineWidth = 1;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillRect(marquee.x, marquee.y, marquee.w, marquee.h);
      ctx.strokeRect(marquee.x, marquee.y, marquee.w, marquee.h);
      ctx.restore();
    }
  }

  /** Fundo tipo folha de caderno (pautado/quadriculado), desenhado em coordenadas de
   * mundo para acompanhar naturalmente o zoom/pan — só cobre a área atualmente visível. */
  private drawPaper(style: PaperStyle): void {
    if (style === 'blank') return;
    const ctx = this.ctx;
    const topLeft = this.viewport.screenToWorld({ x: 0, y: 0 });
    const bottomRight = this.viewport.screenToWorld({ x: this.width, y: this.height });

    ctx.save();
    ctx.strokeStyle = 'rgba(47, 111, 237, 0.18)';
    ctx.lineWidth = 1 / this.viewport.scale;

    if (style === 'ruled') {
      const start = Math.floor(topLeft.y / RULED_LINE_SPACING) * RULED_LINE_SPACING;
      for (let y = start; y <= bottomRight.y; y += RULED_LINE_SPACING) {
        ctx.beginPath();
        ctx.moveTo(topLeft.x, y);
        ctx.lineTo(bottomRight.x, y);
        ctx.stroke();
      }
    } else {
      const startX = Math.floor(topLeft.x / GRID_SPACING) * GRID_SPACING;
      for (let x = startX; x <= bottomRight.x; x += GRID_SPACING) {
        ctx.beginPath();
        ctx.moveTo(x, topLeft.y);
        ctx.lineTo(x, bottomRight.y);
        ctx.stroke();
      }
      const startY = Math.floor(topLeft.y / GRID_SPACING) * GRID_SPACING;
      for (let y = startY; y <= bottomRight.y; y += GRID_SPACING) {
        ctx.beginPath();
        ctx.moveTo(topLeft.x, y);
        ctx.lineTo(bottomRight.x, y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawElement(el: CanvasElement): void {
    const ctx = this.ctx;
    ctx.save();
    this.applyRotation(el);

    switch (el.type) {
      case 'stroke':
        this.drawStroke(el);
        break;
      case 'shape':
        this.drawShape(el);
        break;
      case 'arrow':
        this.drawArrow(el);
        break;
      case 'text':
        this.drawText(el);
        break;
      case 'sticky':
        this.drawSticky(el);
        break;
      case 'checklist':
        this.drawChecklist(el);
        break;
      case 'image':
        this.drawImage(el);
        break;
    }
    ctx.restore();
  }

  private drawImage(el: ImageElement): void {
    const img = this.getImage(el.src);
    if (img.complete && img.naturalWidth > 0) {
      this.ctx.drawImage(img, el.x, el.y, el.w, el.h);
    } else {
      this.ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      this.ctx.strokeRect(el.x, el.y, el.w, el.h);
    }
  }

  private getImage(src: string): HTMLImageElement {
    let img = this.imageCache.get(src);
    if (!img) {
      img = new Image();
      img.onload = () => this.onImageLoad?.();
      img.src = src;
      this.imageCache.set(src, img);
    }
    return img;
  }

  private drawText(el: TextElement): void {
    const ctx = this.ctx;
    ctx.fillStyle = el.color;
    ctx.font = `${el.italic ? 'italic ' : ''}${el.bold ? 'bold ' : ''}${el.fontSize}px ${TEXT_FONT_STACKS[el.fontFamily ?? 'sans']}`;
    ctx.textBaseline = 'top';
    const lineHeight = el.fontSize * 1.3;
    const lines = wrapLines(ctx, el.content, el.w);
    let y = el.y;
    for (const line of lines) {
      const width = ctx.measureText(line).width;
      let x = el.x;
      if (el.align === 'center') x = el.x + (el.w - width) / 2;
      else if (el.align === 'right') x = el.x + el.w - width;
      ctx.fillText(line, x, y);
      if (el.underline && line) {
        const underlineY = y + el.fontSize * 1.05;
        ctx.strokeStyle = el.color;
        ctx.lineWidth = Math.max(1, el.fontSize / 16);
        ctx.beginPath();
        ctx.moveTo(x, underlineY);
        ctx.lineTo(x + width, underlineY);
        ctx.stroke();
      }
      y += lineHeight;
    }
  }

  /** Sombra suave + cantos arredondados no estilo de um post-it "flutuando" sobre o
   * papel, em vez do retângulo sólido/anguloso anterior. */
  private drawSticky(el: StickyElement): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(20, 20, 43, 0.18)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = el.color;
    ctx.beginPath();
    ctx.roundRect(el.x, el.y, el.w, el.h, CORNER_RADIUS);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(el.x, el.y, el.w, el.h, CORNER_RADIUS);
    ctx.stroke();

    ctx.fillStyle = '#1d1d1d';
    ctx.font = `${el.fontSize}px sans-serif`;
    ctx.textBaseline = 'top';
    wrapText(ctx, el.content, el.x + STICKY_PADDING, el.y + STICKY_PADDING, el.w - STICKY_PADDING * 2, stickyLineHeight(el.fontSize));
  }

  /** Fundo transparente (só um contorno leve) pra não competir visualmente com o papel
   * — combina melhor com um item de lista do que um cartão sólido como o sticky. */
  private drawChecklist(el: ChecklistElement): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(el.x, el.y, el.w, el.h, CORNER_RADIUS);
    ctx.stroke();

    ctx.font = `${el.fontSize}px sans-serif`;
    ctx.textBaseline = 'top';
    for (const { item, checkbox, textX, textY } of checklistItemLayouts(el)) {
      ctx.beginPath();
      ctx.roundRect(checkbox.x, checkbox.y, checkbox.w, checkbox.h, Math.max(3, checkbox.w * 0.3));
      if (item.checked) {
        ctx.fillStyle = ACCENT;
        ctx.fill();
        ctx.strokeStyle = ACCENT;
      } else {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      }
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (item.checked) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1.2, checkbox.w * 0.12);
        ctx.beginPath();
        ctx.moveTo(checkbox.x + checkbox.w * 0.22, checkbox.y + checkbox.h * 0.55);
        ctx.lineTo(checkbox.x + checkbox.w * 0.42, checkbox.y + checkbox.h * 0.75);
        ctx.lineTo(checkbox.x + checkbox.w * 0.78, checkbox.y + checkbox.h * 0.28);
        ctx.stroke();
      }

      ctx.fillStyle = item.checked ? 'rgba(29,29,29,0.45)' : '#1d1d1d';
      const text = item.text || (item.checked ? '' : '');
      ctx.fillText(text, textX, textY);
      if (item.checked && text) {
        const width = ctx.measureText(text).width;
        ctx.strokeStyle = 'rgba(29,29,29,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(textX, textY + el.fontSize / 2);
        ctx.lineTo(textX + width, textY + el.fontSize / 2);
        ctx.stroke();
      }
    }
  }

  private applyRotation(el: CanvasElement): void {
    if (!el.rotation) return;
    const box = elementBBox(el);
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    this.ctx.translate(cx, cy);
    this.ctx.rotate(el.rotation);
    this.ctx.translate(-cx, -cy);
  }

  private drawStroke(el: StrokeElement): void {
    const ctx = this.ctx;
    if (el.points.length === 0) return;
    if (el.points.length === 1) {
      ctx.fillStyle = el.color;
      ctx.beginPath();
      ctx.arc(el.points[0].x, el.points[0].y, el.thickness / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const input = el.points.map((p, i) => [p.x, p.y, el.pressures[i] ?? 0.5] as [number, number, number]);
    const outline = getStroke(input, {
      size: el.thickness * 2.2,
      thinning: 0.6,
      smoothing: 0.5,
      streamline: 0.5,
    });
    if (outline.length === 0) return;
    ctx.fillStyle = el.color;
    ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (const [x, y] of outline.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
  }

  private drawShape(el: ShapeElement): void {
    const ctx = this.ctx;
    ctx.strokeStyle = el.color;
    ctx.fillStyle = el.color;
    ctx.lineWidth = el.thickness;
    ctx.lineJoin = 'round';
    const { x, y, w, h } = el;
    if (el.shape === 'rect') {
      el.fill ? ctx.fillRect(x, y, w, h) : ctx.strokeRect(x, y, w, h);
    } else if (el.shape === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
      el.fill ? ctx.fill() : ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h);
      ctx.stroke();
    }
  }

  private drawArrow(el: ArrowElement): void {
    const ctx = this.ctx;
    ctx.strokeStyle = el.color;
    ctx.fillStyle = el.color;
    ctx.lineWidth = el.thickness;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(el.from.x, el.from.y);
    const ctrl = arrowControlPoint(el);
    if (ctrl) {
      ctx.quadraticCurveTo(ctrl.x, ctrl.y, el.to.x, el.to.y);
    } else {
      ctx.lineTo(el.to.x, el.to.y);
    }
    ctx.stroke();

    const angle = arrowEndAngle(el);
    const headLen = 8 + el.thickness * 2;
    ctx.beginPath();
    ctx.moveTo(el.to.x, el.to.y);
    ctx.lineTo(
      el.to.x - headLen * Math.cos(angle - Math.PI / 7),
      el.to.y - headLen * Math.sin(angle - Math.PI / 7),
    );
    ctx.lineTo(
      el.to.x - headLen * Math.cos(angle + Math.PI / 7),
      el.to.y - headLen * Math.sin(angle + Math.PI / 7),
    );
    ctx.closePath();
    ctx.fill();
  }

  private drawSelectionOutline(el: CanvasElement): void {
    const box = elementBBox(el);
    const ctx = this.ctx;
    ctx.save();
    this.applyRotation(el);
    ctx.strokeStyle = '#2f6fed';
    ctx.lineWidth = 1 / this.viewport.scale;
    ctx.setLineDash([4 / this.viewport.scale, 4 / this.viewport.scale]);
    ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
    ctx.restore();
  }

  /** Alças visíveis da seleção — sem isso, o usuário só descobre onde arrastar pra
   * redimensionar/rotacionar/curvar por tentativa e erro. Setas ganham alças próprias
   * (pontas + "vergalho" de curva) em vez dos cantos genéricos, que não fazem sentido
   * pra uma linha. */
  private drawSelectionHandles(elements: CanvasElement[], selectedIds: Set<string>): void {
    const selected = elements.filter((e) => selectedIds.has(e.id));
    if (selected.length === 0) return;
    const s = HANDLE_SIZE / this.viewport.scale;

    if (selected.length === 1 && selected[0].type === 'arrow') {
      const arrow = selected[0];
      this.drawHandleDot(arrow.from, s);
      this.drawHandleDot(arrow.to, s);
      this.drawHandleDiamond(arrowBendPoint(arrow), s);
      return;
    }

    const boxes = selected.map(elementBBox);
    const box = boxes.reduce((acc, b) => ({
      minX: Math.min(acc.minX, b.minX), minY: Math.min(acc.minY, b.minY),
      maxX: Math.max(acc.maxX, b.maxX), maxY: Math.max(acc.maxY, b.maxY),
    }));
    const corners: Point[] = [
      { x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY },
      { x: box.minX, y: box.maxY }, { x: box.maxX, y: box.maxY },
    ];
    for (const c of corners) this.drawHandleSquare(c, s);

    const topMid = { x: (box.minX + box.maxX) / 2, y: box.minY };
    const rotatePos = { x: topMid.x, y: box.minY - 24 / this.viewport.scale };
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(109, 94, 248, 0.5)';
    ctx.lineWidth = 1 / this.viewport.scale;
    ctx.beginPath();
    ctx.moveTo(topMid.x, topMid.y);
    ctx.lineTo(rotatePos.x, rotatePos.y);
    ctx.stroke();
    ctx.restore();
    this.drawHandleCircle(rotatePos, s);
  }

  private drawHandleSquare(p: Point, s: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5 / this.viewport.scale;
    ctx.beginPath();
    ctx.roundRect(p.x - s, p.y - s, s * 2, s * 2, s * 0.35);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawHandleCircle(p: Point, s: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5 / this.viewport.scale;
    ctx.beginPath();
    ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawHandleDot(p: Point, s: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = ACCENT;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 / this.viewport.scale;
    ctx.beginPath();
    ctx.arc(p.x, p.y, s * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawHandleDiamond(p: Point, s: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5 / this.viewport.scale;
    ctx.beginPath();
    ctx.rect(-s * 0.7, -s * 0.7, s * 1.4, s * 1.4);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  static contentBBox(elements: CanvasElement[]) {
    if (elements.length === 0) return { minX: 0, minY: 0, maxX: 800, maxY: 600 };
    return unionBBox(elements.map(elementBBox));
  }
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
  const paragraphs = text.split('\n');
  let cy = y;
  for (const paragraph of paragraphs) {
    const words = paragraph.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, cy);
        line = word;
        cy += lineHeight;
      } else {
        line = test;
      }
    }
    ctx.fillText(line, x, cy);
    cy += lineHeight;
  }
}
