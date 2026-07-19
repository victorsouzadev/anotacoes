import { getStroke } from 'perfect-freehand';
import { ArrowElement, CanvasElement, ChecklistElement, ImageElement, PaperStyle, Point, PomodoroElement, ShapeElement, StickyElement, StrokeElement, TextElement, TEXT_FONT_STACKS } from '../../../data/models';
import { arrowBendPoint, arrowControlPoint, arrowEndAngle, arrowStartAngle } from './arrow-geometry';
import { checklistItemLayouts } from './checklist-layout';
import { elementBBox, HANDLE_SIZE, unionBBox } from './hit-test';
import { formatPomodoroTime, pomodoroButtonLayouts, pomodoroDisplaySec } from './pomodoro-layout';
import { STICKY_PADDING, stickyLineHeight } from './sticky-layout';
import { textListLayout } from './text-list-layout';
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
      case 'pomodoro':
        this.drawPomodoro(el);
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
    ctx.font = `${el.italic ? 'italic ' : ''}${el.bold ? 'bold ' : ''}${el.fontSize}px ${TEXT_FONT_STACKS[el.fontFamily ?? 'sans']}`;
    ctx.textBaseline = 'top';
    const lines = textListLayout(el.content, el.x, el.y, el.w, el.fontSize, el.fontFamily ?? 'sans', el.bold, el.italic);
    for (const line of lines) {
      if (line.isMarkerLine) {
        ctx.fillStyle = el.color;
        if (line.marker === 'bullet' && line.bulletGlyph != null) {
          ctx.fillText(line.bulletGlyph, line.markerX!, line.y);
        } else if (line.marker === 'number' && line.numberLabel != null) {
          ctx.fillText(line.numberLabel, line.markerX!, line.y);
        } else if (line.marker === 'checklist' && line.checkbox) {
          this.drawCheckboxGlyph(line.checkbox, !!line.checked);
        }
      }

      // Linhas de lista sempre ficam à esquerda — combinar recuo pendurado com
      // centralização/direita não compensa a complexidade pra um caso raro.
      let x = line.x;
      let width = 0;
      if (line.marker === 'none') {
        width = ctx.measureText(line.text).width;
        if (el.align === 'center') x = el.x + (el.w - width) / 2;
        else if (el.align === 'right') x = el.x + el.w - width;
      }

      ctx.fillStyle = line.checked ? 'rgba(29,29,29,0.45)' : el.color;
      ctx.fillText(line.text, x, line.y);

      if (line.checked && line.text) {
        if (width === 0) width = ctx.measureText(line.text).width;
        ctx.strokeStyle = 'rgba(29,29,29,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, line.y + el.fontSize / 2);
        ctx.lineTo(x + width, line.y + el.fontSize / 2);
        ctx.stroke();
      } else if (el.underline && line.marker === 'none' && line.text) {
        if (width === 0) width = ctx.measureText(line.text).width;
        const underlineY = line.y + el.fontSize * 1.05;
        ctx.strokeStyle = el.color;
        ctx.lineWidth = Math.max(1, el.fontSize / 16);
        ctx.beginPath();
        ctx.moveTo(x, underlineY);
        ctx.lineTo(x + width, underlineY);
        ctx.stroke();
      }
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
      this.drawCheckboxGlyph(checkbox, item.checked);

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

  /** Quadradinho de checklist — reaproveitado tanto pelo ChecklistElement (bloco
   * separado) quanto pelas linhas de checklist inline dentro de um TextElement, pra
   * manter os dois com a mesma cara. */
  private drawCheckboxGlyph(checkbox: { x: number; y: number; w: number; h: number }, checked: boolean): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.roundRect(checkbox.x, checkbox.y, checkbox.w, checkbox.h, Math.max(3, checkbox.w * 0.3));
    if (checked) {
      ctx.fillStyle = ACCENT;
      ctx.fill();
      ctx.strokeStyle = ACCENT;
    } else {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    }
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (checked) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1.2, checkbox.w * 0.12);
      ctx.beginPath();
      ctx.moveTo(checkbox.x + checkbox.w * 0.22, checkbox.y + checkbox.h * 0.55);
      ctx.lineTo(checkbox.x + checkbox.w * 0.42, checkbox.y + checkbox.h * 0.75);
      ctx.lineTo(checkbox.x + checkbox.w * 0.78, checkbox.y + checkbox.h * 0.28);
      ctx.stroke();
    }
  }

  /** Cartão do timer Pomodoro — cor de fundo indica a fase (foco/pausa), mm:ss grande
   * centralizado e dois botões (play/pause, reiniciar) cujas posições vêm de
   * pomodoroButtonLayouts, a mesma função usada pelo canvas-host pra testar clique. */
  private drawPomodoro(el: PomodoroElement): void {
    const ctx = this.ctx;
    const isWork = el.phase === 'work';
    ctx.save();
    ctx.shadowColor = 'rgba(20, 20, 43, 0.18)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = isWork ? '#efecff' : '#e3f6e8';
    ctx.beginPath();
    ctx.roundRect(el.x, el.y, el.w, el.h, CORNER_RADIUS);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = isWork ? 'rgba(109, 94, 248, 0.35)' : 'rgba(46, 168, 79, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(el.x, el.y, el.w, el.h, CORNER_RADIUS);
    ctx.stroke();

    const cx = el.x + el.w / 2;
    const labelColor = isWork ? ACCENT : '#2ea84f';

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = labelColor;
    ctx.font = '600 12px sans-serif';
    const label = isWork ? 'Foco' : 'Pausa';
    const text = el.cyclesCompleted > 0 ? `${label} · ${el.cyclesCompleted} concluído${el.cyclesCompleted > 1 ? 's' : ''}` : label;
    ctx.fillText(text, cx, el.y + 10);

    ctx.fillStyle = '#1d1d1d';
    ctx.font = '700 30px sans-serif';
    ctx.fillText(formatPomodoroTime(pomodoroDisplaySec(el)), cx, el.y + 32);
    ctx.textAlign = 'left';

    const { playPause, reset } = pomodoroButtonLayouts(el);
    this.drawPomodoroButton(playPause, labelColor, el.running ? 'pause' : 'play');
    this.drawPomodoroButton(reset, 'rgba(29,29,29,0.55)', 'reset');
  }

  private drawPomodoroButton(box: { x: number; y: number; w: number; h: number }, color: string, kind: 'play' | 'pause' | 'reset'): void {
    const ctx = this.ctx;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const r = box.w / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    if (kind === 'play') {
      const s = r * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.5, cy - s);
      ctx.lineTo(cx - s * 0.5, cy + s);
      ctx.lineTo(cx + s, cy);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'pause') {
      const barW = r * 0.32;
      const barH = r * 1.05;
      ctx.fillRect(cx - r * 0.42 - barW / 2, cy - barH / 2, barW, barH);
      ctx.fillRect(cx + r * 0.42 - barW / 2, cy - barH / 2, barW, barH);
    } else {
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.55, 0.6, Math.PI * 1.7);
      ctx.stroke();
      const headAngle = Math.PI * 1.7;
      const hx = cx + Math.cos(headAngle) * r * 0.55;
      const hy = cy + Math.sin(headAngle) * r * 0.55;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx - r * 0.28, hy - r * 0.05);
      ctx.lineTo(hx - r * 0.05, hy + r * 0.28);
      ctx.closePath();
      ctx.fill();
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
    } else {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
      el.fill ? ctx.fill() : ctx.stroke();
    }
  }

  private drawArrow(el: ArrowElement): void {
    const ctx = this.ctx;
    ctx.strokeStyle = el.color;
    ctx.fillStyle = el.color;
    ctx.lineWidth = el.thickness;
    ctx.lineCap = 'round';

    // Com lineCap 'round', o traço projeta uma meia-lua além do ponto final. Quando há
    // farpa naquela ponta isso vaza para fora do triângulo, criando uma "bolha" na ponta
    // da seta — por isso recuamos o traço em thickness/2 (o raio do cap) ao longo da
    // tangente, fazendo a meia-lua terminar exatamente na ponta, coberta pela farpa.
    const halfThick = el.thickness / 2;
    let from = el.from;
    let to = el.to;
    if (el.endArrow) {
      const a = arrowEndAngle(el);
      to = { x: el.to.x - halfThick * Math.cos(a), y: el.to.y - halfThick * Math.sin(a) };
    }
    if (el.startArrow) {
      const a = arrowStartAngle(el);
      from = { x: el.from.x - halfThick * Math.cos(a), y: el.from.y - halfThick * Math.sin(a) };
    }

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    const ctrl = arrowControlPoint(el);
    if (ctrl) {
      ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
    } else {
      ctx.lineTo(to.x, to.y);
    }
    ctx.stroke();

    const headLen = 8 + el.thickness * 2;
    if (el.endArrow) this.drawArrowhead(el.to, arrowEndAngle(el), headLen);
    if (el.startArrow) this.drawArrowhead(el.from, arrowStartAngle(el), headLen);
  }

  private drawArrowhead(tip: Point, angle: number, headLen: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(
      tip.x - headLen * Math.cos(angle - Math.PI / 7),
      tip.y - headLen * Math.sin(angle - Math.PI / 7),
    );
    ctx.lineTo(
      tip.x - headLen * Math.cos(angle + Math.PI / 7),
      tip.y - headLen * Math.sin(angle + Math.PI / 7),
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
