import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ArrowElement, CanvasElement, PEN_COLORS, ShapeElement, StickyElement, STICKY_COLORS, StrokeElement, TextElement, ToolType } from '../../data/models';
import { EditorStore } from './engine/editor-store';

const SHAPE_TOOLS: ToolType[] = ['rect', 'ellipse'];
const LINE_TOOLS: ToolType[] = ['line', 'arrow'];

type Colorable = StrokeElement | ShapeElement | ArrowElement | TextElement;
type Thicknessable = StrokeElement | ShapeElement | ArrowElement;

function isColorable(e: CanvasElement): e is Colorable {
  return e.type === 'stroke' || e.type === 'shape' || e.type === 'arrow' || e.type === 'text';
}
function isThicknessable(e: CanvasElement): e is Thicknessable {
  return e.type === 'stroke' || e.type === 'shape' || e.type === 'arrow';
}

interface ArrowheadOption {
  key: string;
  start: boolean;
  end: boolean;
  glyph: string;
  title: string;
}

const ARROWHEAD_OPTIONS: ArrowheadOption[] = [
  { key: 'none', start: false, end: false, glyph: '─', title: 'Sem ponta' },
  { key: 'end', start: false, end: true, glyph: '→', title: 'Ponta no fim' },
  { key: 'start', start: true, end: false, glyph: '←', title: 'Ponta no início' },
  { key: 'both', start: true, end: true, glyph: '↔', title: 'Ponta nas duas pontas' },
];

/** Painel flutuante de propriedades (cor/espessura/preenchimento/pontas) — estilo
 * Excalidraw, sempre visível quando há algo editável, sem precisar abrir um menu.
 * Cobre dois casos: (1) a ferramenta ativa, definindo o estilo do próximo elemento a
 * ser desenhado; (2) uma seleção de elementos já existentes, editando-os direto —
 * sem isso, mudar a cor de um traço já feito exigiria apagar e redesenhar. */
@Component({
  selector: 'app-properties-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (tool() === 'pen') {
      <div class="panel">
        <div class="row">
          @for (c of penColors; track c) {
            <button class="swatch" [class.active]="penColor() === c" [style.background]="c" (click)="store.penColor.set(c)"></button>
          }
          <input type="color" [ngModel]="penColor()" (ngModelChange)="store.penColor.set($event)" />
        </div>
        <div class="row">
          <input type="range" min="1" max="24" [ngModel]="thickness()" (ngModelChange)="store.penThickness.set($event)" />
          <span class="thickness-label">{{ thickness() }}px</span>
        </div>
      </div>
    } @else if (isShapeTool() || isLineTool()) {
      <div class="panel">
        <div class="row">
          @for (c of penColors; track c) {
            <button class="swatch" [class.active]="penColor() === c" [style.background]="c" (click)="store.penColor.set(c)"></button>
          }
          <input type="color" [ngModel]="penColor()" (ngModelChange)="store.penColor.set($event)" />
        </div>
        <div class="row">
          <input type="range" min="1" max="24" [ngModel]="thickness()" (ngModelChange)="store.penThickness.set($event)" />
          <span class="thickness-label">{{ thickness() }}px</span>
        </div>
        @if (isShapeTool()) {
          <label class="fill-toggle">
            <input type="checkbox" [ngModel]="fillShape()" (ngModelChange)="store.fillShape.set($event)" />
            preenchido
          </label>
        }
        @if (isLineTool()) {
          <div class="row arrowhead-row">
            @for (opt of arrowheadOptions; track opt.key) {
              <button class="head-btn" [class.active]="store.arrowStart() === opt.start && store.arrowEnd() === opt.end"
                [title]="opt.title" (click)="store.arrowStart.set(opt.start); store.arrowEnd.set(opt.end)">{{ opt.glyph }}</button>
            }
          </div>
        }
      </div>
    } @else if (tool() === 'sticky') {
      <div class="panel">
        <div class="row">
          @for (c of stickyColors; track c) {
            <button class="swatch" [class.active]="stickyColor() === c" [style.background]="c" (click)="store.stickyColor.set(c)"></button>
          }
        </div>
      </div>
    } @else if (tool() === 'select' && hasSelectionStyle()) {
      <div class="panel">
        @if (selectedColorEls().length) {
          <div class="row">
            @for (c of penColors; track c) {
              <button class="swatch" [class.active]="selectionColor() === c" [style.background]="c" (click)="commitSelectionColor(c)"></button>
            }
            <input type="color" [ngModel]="selectionColor()" (ngModelChange)="previewSelectionColor($event)" (change)="commitSelectionColor($any($event.target).value)" />
          </div>
        }
        @if (selectedThicknessEls().length) {
          <div class="row">
            <input type="range" min="1" max="24" [ngModel]="selectionThickness()"
              (ngModelChange)="previewSelectionThickness($event)" (change)="commitSelectionThickness($any($event.target).value)" />
            <span class="thickness-label">{{ selectionThickness() }}px</span>
          </div>
        }
        @if (selectedFillEls().length) {
          <label class="fill-toggle">
            <input type="checkbox" [ngModel]="selectionFill()" (ngModelChange)="commitSelectionFill($event)" />
            preenchido
          </label>
        }
        @if (selectedArrowEls().length) {
          <div class="row arrowhead-row">
            @for (opt of arrowheadOptions; track opt.key) {
              <button class="head-btn" [class.active]="selectionArrowStart() === opt.start && selectionArrowEnd() === opt.end"
                [title]="opt.title" (click)="commitSelectionArrowheads(opt.start, opt.end)">{{ opt.glyph }}</button>
            }
          </div>
        }
        @if (selectedStickyEls().length) {
          <div class="row">
            @for (c of stickyColors; track c) {
              <button class="swatch" [class.active]="selectionStickyColor() === c" [style.background]="c" (click)="commitSelectionStickyColor(c)"></button>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .panel {
      position: absolute;
      top: 14px;
      left: 14px;
      z-index: 10;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px;
      box-shadow: var(--shadow-lg);
      max-width: calc(100vw - 28px);
    }
    .row { display: flex; align-items: center; gap: 6px; }
    .swatch { width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 2px solid var(--border); }
    .swatch.active { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
    .fill-toggle { font-size: 12px; display: flex; gap: 6px; align-items: center; color: var(--text-muted); white-space: nowrap; }
    .thickness-label { font-size: 12px; color: var(--text-muted); width: 32px; }
    input[type=range] { accent-color: var(--accent); flex: 1; }
    input[type=color] { width: 28px; height: 28px; padding: 0; border: 1px solid var(--border); border-radius: 6px; }
    .arrowhead-row { gap: 4px; }
    .head-btn {
      width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
      border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text);
      font-size: 14px; line-height: 1;
    }
    .head-btn.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
  `],
})
export class PropertiesPanelComponent {
  @Input({ required: true }) store!: EditorStore;
  /** Emitido sempre que uma edição no painel muda elementos já existentes (ao vivo, um
   * clique em cor/preenchimento/ponta de seta não passa pelo canvas-host, então sem
   * isso essas mudanças nunca disparariam o autosave da página). */
  @Output() elementsChanged = new EventEmitter<void>();

  penColors = PEN_COLORS;
  stickyColors = STICKY_COLORS;
  arrowheadOptions = ARROWHEAD_OPTIONS;

  get tool() { return this.store.tool; }
  get penColor() { return this.store.penColor; }
  get thickness() { return this.store.penThickness; }
  get stickyColor() { return this.store.stickyColor; }
  get fillShape() { return this.store.fillShape; }

  isShapeTool(): boolean {
    return SHAPE_TOOLS.includes(this.tool());
  }

  isLineTool(): boolean {
    return LINE_TOOLS.includes(this.tool());
  }

  private selected(): CanvasElement[] {
    const ids = this.store.selectedIds();
    if (ids.size === 0) return [];
    return this.store.elements().filter((e) => ids.has(e.id));
  }

  selectedColorEls(): Colorable[] {
    return this.selected().filter(isColorable);
  }

  selectedThicknessEls(): Thicknessable[] {
    return this.selected().filter(isThicknessable);
  }

  selectedFillEls(): ShapeElement[] {
    return this.selected().filter((e): e is ShapeElement => e.type === 'shape');
  }

  selectedArrowEls(): ArrowElement[] {
    return this.selected().filter((e): e is ArrowElement => e.type === 'arrow');
  }

  selectedStickyEls(): StickyElement[] {
    return this.selected().filter((e): e is StickyElement => e.type === 'sticky');
  }

  hasSelectionStyle(): boolean {
    return this.selectedColorEls().length > 0
      || this.selectedThicknessEls().length > 0
      || this.selectedFillEls().length > 0
      || this.selectedArrowEls().length > 0
      || this.selectedStickyEls().length > 0;
  }

  selectionColor(): string { return this.selectedColorEls()[0]?.color ?? '#1d1d1d'; }
  selectionThickness(): number { return this.selectedThicknessEls()[0]?.thickness ?? 3; }
  selectionFill(): boolean { return this.selectedFillEls()[0]?.fill ?? false; }
  selectionArrowStart(): boolean { return this.selectedArrowEls()[0]?.startArrow ?? false; }
  selectionArrowEnd(): boolean { return this.selectedArrowEls()[0]?.endArrow ?? true; }
  selectionStickyColor(): string { return this.selectedStickyEls()[0]?.color ?? STICKY_COLORS[0]; }

  /** Estado do array de elementos antes do gesto de arraste (slider/color picker)
   * começar — capturado na primeira prévia e restaurado no commit final, pro undo
   * voltar pro estado real de antes em vez do último passo intermediário. Mesmo
   * truque usado pelo canvas-host para mover/redimensionar/rotacionar. */
  private editSnapshot: CanvasElement[] | null = null;

  private patchesFor(ids: string[], patch: Partial<CanvasElement>): Map<string, Partial<CanvasElement>> {
    const map = new Map<string, Partial<CanvasElement>>();
    for (const id of ids) map.set(id, patch);
    return map;
  }

  private previewPatch(ids: string[], patch: Partial<CanvasElement>): void {
    if (ids.length === 0) return;
    if (this.editSnapshot === null) this.editSnapshot = this.store.elements();
    this.store.updateElements(this.patchesFor(ids, patch), { commit: false });
  }

  private commitPatch(ids: string[], patch: Partial<CanvasElement>): void {
    if (ids.length === 0) return;
    if (this.editSnapshot) {
      this.store.elements.set(this.editSnapshot);
      this.editSnapshot = null;
    }
    this.store.updateElements(this.patchesFor(ids, patch), { commit: true });
    this.elementsChanged.emit();
  }

  previewSelectionColor(color: string): void {
    this.previewPatch(this.selectedColorEls().map((e) => e.id), { color } as Partial<CanvasElement>);
  }

  commitSelectionColor(color: string): void {
    this.commitPatch(this.selectedColorEls().map((e) => e.id), { color } as Partial<CanvasElement>);
  }

  previewSelectionThickness(thickness: number): void {
    this.previewPatch(this.selectedThicknessEls().map((e) => e.id), { thickness: Number(thickness) } as Partial<CanvasElement>);
  }

  commitSelectionThickness(thickness: number): void {
    this.commitPatch(this.selectedThicknessEls().map((e) => e.id), { thickness: Number(thickness) } as Partial<CanvasElement>);
  }

  commitSelectionFill(fill: boolean): void {
    this.commitPatch(this.selectedFillEls().map((e) => e.id), { fill } as Partial<CanvasElement>);
  }

  commitSelectionArrowheads(startArrow: boolean, endArrow: boolean): void {
    this.commitPatch(this.selectedArrowEls().map((e) => e.id), { startArrow, endArrow } as Partial<CanvasElement>);
  }

  commitSelectionStickyColor(color: string): void {
    this.commitPatch(this.selectedStickyEls().map((e) => e.id), { color } as Partial<CanvasElement>);
  }
}
