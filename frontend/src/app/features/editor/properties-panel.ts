import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PEN_COLORS, STICKY_COLORS, ToolType } from '../../data/models';
import { EditorStore } from './engine/editor-store';

const SHAPE_TOOLS: ToolType[] = ['rect', 'ellipse', 'line', 'arrow'];
const FILLABLE_SHAPE_TOOLS: ToolType[] = ['rect', 'ellipse'];

/** Painel flutuante de propriedades (cor/espessura/preenchimento) da ferramenta
 * ativa, estilo Excalidraw — sempre visível quando a ferramenta tem propriedades,
 * sem precisar abrir um menu. */
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
    } @else if (isShapeTool()) {
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
        @if (isFillableShapeTool()) {
          <label class="fill-toggle">
            <input type="checkbox" [ngModel]="fillShape()" (ngModelChange)="store.fillShape.set($event)" />
            preenchido
          </label>
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
  `],
})
export class PropertiesPanelComponent {
  @Input({ required: true }) store!: EditorStore;

  penColors = PEN_COLORS;
  stickyColors = STICKY_COLORS;

  get tool() { return this.store.tool; }
  get penColor() { return this.store.penColor; }
  get thickness() { return this.store.penThickness; }
  get stickyColor() { return this.store.stickyColor; }
  get fillShape() { return this.store.fillShape; }

  isShapeTool(): boolean {
    return SHAPE_TOOLS.includes(this.tool());
  }

  isFillableShapeTool(): boolean {
    return FILLABLE_SHAPE_TOOLS.includes(this.tool());
  }
}
