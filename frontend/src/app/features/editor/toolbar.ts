import { Component, ElementRef, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PEN_COLORS, PaperStyle, STICKY_COLORS, ToolType } from '../../data/models';
import { EditorStore } from './engine/editor-store';

type GroupName = 'draw' | 'shapes' | 'insert' | 'actions' | 'view';

const DRAW_TOOLS: ToolType[] = ['pen', 'eraser-stroke', 'eraser-area'];
const SHAPE_TOOLS: ToolType[] = ['rect', 'ellipse', 'line', 'arrow'];
const INSERT_TOOLS: ToolType[] = ['text', 'sticky', 'checklist'];

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <div class="group">
        <button [class.active]="tool() === 'select'" (click)="setTool('select')" title="Selecionar">⬚</button>
        <button [class.active]="tool() === 'pan'" (click)="setTool('pan')" title="Mover tela">✋</button>
      </div>

      <div class="menu">
        <button class="trigger" [class.active]="isGroupActive('draw')" [class.open]="openGroup() === 'draw'" (click)="toggleGroup('draw', $event)">
          ✏️ Desenho <span class="chevron">▾</span>
        </button>
        @if (openGroup() === 'draw') {
          <div class="panel" [style.top.px]="panelPos()?.top" [style.left.px]="panelPos()?.left">
            <div class="row">
              <button [class.active]="tool() === 'pen'" (click)="setTool('pen')" title="Caneta">✏️ Caneta</button>
              <button [class.active]="tool() === 'eraser-stroke'" (click)="setTool('eraser-stroke')" title="Borracha (traço)">🩹 Traço</button>
              <button [class.active]="tool() === 'eraser-area'" (click)="setTool('eraser-area')" title="Borracha (área)">🧹 Área</button>
            </div>
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
        }
      </div>

      <div class="menu">
        <button class="trigger" [class.active]="isGroupActive('shapes')" [class.open]="openGroup() === 'shapes'" (click)="toggleGroup('shapes', $event)">
          ▭ Formas <span class="chevron">▾</span>
        </button>
        @if (openGroup() === 'shapes') {
          <div class="panel" [style.top.px]="panelPos()?.top" [style.left.px]="panelPos()?.left">
            <div class="row">
              <button [class.active]="tool() === 'rect'" (click)="setTool('rect')" title="Retângulo">▭ Retângulo</button>
              <button [class.active]="tool() === 'ellipse'" (click)="setTool('ellipse')" title="Elipse">⬭ Elipse</button>
            </div>
            <div class="row">
              <button [class.active]="tool() === 'line'" (click)="setTool('line')" title="Linha">╱ Linha</button>
              <button [class.active]="tool() === 'arrow'" (click)="setTool('arrow')" title="Seta (segure Shift p/ ângulo)">➜ Seta</button>
            </div>
            <label class="fill-toggle">
              <input type="checkbox" [ngModel]="fillShape()" (ngModelChange)="store.fillShape.set($event)" />
              preenchido
            </label>
          </div>
        }
      </div>

      <div class="menu">
        <button class="trigger" [class.active]="isGroupActive('insert')" [class.open]="openGroup() === 'insert'" (click)="toggleGroup('insert', $event)">
          🅣 Inserir <span class="chevron">▾</span>
        </button>
        @if (openGroup() === 'insert') {
          <div class="panel" [style.top.px]="panelPos()?.top" [style.left.px]="panelPos()?.left">
            <div class="row">
              <button [class.active]="tool() === 'text'" (click)="setTool('text')" title="Texto">🅣 Texto</button>
              <button [class.active]="tool() === 'sticky'" (click)="setTool('sticky')" title="Nota adesiva">🗒️ Adesiva</button>
              <button [class.active]="tool() === 'checklist'" (click)="setTool('checklist')" title="Lista de tarefas">☑️ Checklist</button>
            </div>
            <div class="row">
              @for (c of stickyColors; track c) {
                <button class="swatch" [class.active]="stickyColor() === c" [style.background]="c" (click)="store.stickyColor.set(c)"></button>
              }
            </div>
          </div>
        }
      </div>

      <div class="menu">
        <button class="trigger" [class.open]="openGroup() === 'actions'" (click)="toggleGroup('actions', $event)">
          ⚙️ Ações <span class="chevron">▾</span>
        </button>
        @if (openGroup() === 'actions') {
          <div class="panel" [style.top.px]="panelPos()?.top" [style.left.px]="panelPos()?.left">
            <div class="row">
              <button (click)="undo.emit()" [disabled]="!canUndo()" title="Desfazer (Ctrl+Z)">↺ Desfazer</button>
              <button (click)="redo.emit()" [disabled]="!canRedo()" title="Refazer (Ctrl+Y)">↻ Refazer</button>
            </div>
            <div class="row">
              <button (click)="duplicate.emit()" title="Duplicar seleção (Ctrl+D)">⧉ Duplicar</button>
              <button (click)="deleteSelection.emit()" title="Excluir seleção (Delete)">🗑️ Excluir</button>
            </div>
            <div class="row">
              <button (click)="bringToFront.emit()" title="Trazer para frente">⬆️ Frente</button>
              <button (click)="sendToBack.emit()" title="Enviar para trás">⬇️ Trás</button>
            </div>
            <div class="row">
              <button (click)="exportPng.emit(exportTransparent)" title="Exportar a página atual como imagem PNG">⬇️ Exportar PNG</button>
            </div>
            <label class="export-option">
              <input type="checkbox" [(ngModel)]="exportTransparent" />
              Fundo transparente
            </label>
          </div>
        }
      </div>

      <div class="menu">
        <button class="trigger" [class.open]="openGroup() === 'view'" (click)="toggleGroup('view', $event)">
          🔍 Visualizar <span class="chevron">▾</span>
        </button>
        @if (openGroup() === 'view') {
          <div class="panel" [style.top.px]="panelPos()?.top" [style.left.px]="panelPos()?.left">
            <div class="row">
              <button (click)="zoomOut.emit()" title="Diminuir zoom">− Zoom</button>
              <button (click)="fitToScreen.emit()" title="Ajustar à tela">⤢ Ajustar</button>
              <button (click)="zoomIn.emit()" title="Aumentar zoom">+ Zoom</button>
            </div>
            <select class="paper-select" [ngModel]="store.paperStyle()" (ngModelChange)="paperStyleChange.emit($event)" title="Estilo da folha">
              <option value="blank">Folha lisa</option>
              <option value="ruled">Folha pautada</option>
              <option value="grid">Folha quadriculada</option>
            </select>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .toolbar {
      position: relative;
      display: flex;
      flex-wrap: nowrap;
      overflow-x: auto;
      gap: 8px;
      align-items: center;
      padding: 8px 14px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      scrollbar-width: thin;
    }
    .group { display: flex; align-items: center; gap: 4px; padding-right: 8px; margin-right: 2px; border-right: 1px solid var(--border); flex-shrink: 0; }
    .menu { position: relative; flex-shrink: 0; }
    button {
      border: 1px solid var(--border);
      background: var(--bg);
      border-radius: var(--radius-sm);
      padding: 7px 10px;
      font-size: 14px;
      line-height: 1;
      white-space: nowrap;
      transition: background 0.12s, border-color 0.12s, color 0.12s, transform 0.1s;
    }
    button:hover:not(:disabled):not(.active) { border-color: var(--accent); }
    button:active:not(:disabled) { transform: scale(0.94); }
    button.active { background: var(--accent); border-color: var(--accent); color: #fff; box-shadow: 0 2px 8px var(--accent-soft); }
    button:disabled { opacity: 0.35; cursor: default; }
    .trigger { display: flex; align-items: center; gap: 4px; font-weight: 500; }
    .trigger.open { border-color: var(--accent); background: var(--accent-soft); }
    .chevron { font-size: 9px; opacity: 0.6; }
    .panel {
      position: fixed;
      z-index: 20;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px;
      box-shadow: var(--shadow-lg);
      min-width: 200px;
    }
    .row { display: flex; align-items: center; gap: 6px; }
    .swatch { width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 2px solid var(--border); }
    .swatch.active { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
    .fill-toggle { font-size: 12px; display: flex; gap: 6px; align-items: center; color: var(--text-muted); white-space: nowrap; }
    .thickness-label { font-size: 12px; color: var(--text-muted); width: 32px; }
    input[type=range] { accent-color: var(--accent); flex: 1; }
    input[type=color] { width: 28px; height: 28px; padding: 0; border: 1px solid var(--border); border-radius: 6px; }
    .paper-select { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 7px 8px; font-size: 13px; background: var(--bg); width: 100%; }
    .export-option { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-muted); padding: 4px 2px 0; }
  `],
})
export class ToolbarComponent {
  @Input({ required: true }) store!: EditorStore;
  @Output() undo = new EventEmitter<void>();
  @Output() redo = new EventEmitter<void>();
  @Output() duplicate = new EventEmitter<void>();
  @Output() deleteSelection = new EventEmitter<void>();
  @Output() bringToFront = new EventEmitter<void>();
  @Output() sendToBack = new EventEmitter<void>();
  @Output() exportPng = new EventEmitter<boolean>();
  exportTransparent = false;
  @Output() zoomIn = new EventEmitter<void>();
  @Output() zoomOut = new EventEmitter<void>();
  @Output() fitToScreen = new EventEmitter<void>();
  @Output() paperStyleChange = new EventEmitter<PaperStyle>();

  penColors = PEN_COLORS;
  stickyColors = STICKY_COLORS;
  openGroup = signal<GroupName | null>(null);
  panelPos = signal<{ top: number; left: number } | null>(null);

  constructor(private el: ElementRef<HTMLElement>) {}

  get tool() { return this.store.tool; }
  get penColor() { return this.store.penColor; }
  get thickness() { return this.store.penThickness; }
  get stickyColor() { return this.store.stickyColor; }
  get fillShape() { return this.store.fillShape; }
  canUndo = () => this.store.history.canUndo();
  canRedo = () => this.store.history.canRedo();

  setTool(t: ToolType): void {
    this.store.tool.set(t);
    this.openGroup.set(null);
  }

  /** Painéis usam position:fixed (não absolute) porque o toolbar tem overflow-x:auto
   * para caber em telas estreitas — isso recorta implicitamente o overflow no eixo Y
   * também, escondendo qualquer painel posicionado relativo ao gatilho. Calculamos a
   * posição na tela a partir do próprio botão clicado para escapar desse recorte. */
  toggleGroup(name: GroupName, ev: MouseEvent): void {
    if (this.openGroup() === name) {
      this.openGroup.set(null);
      return;
    }
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    this.panelPos.set({ top: rect.bottom + 6, left: rect.left });
    this.openGroup.set(name);
  }

  isGroupActive(name: GroupName): boolean {
    const t = this.tool();
    if (name === 'draw') return DRAW_TOOLS.includes(t);
    if (name === 'shapes') return SHAPE_TOOLS.includes(t);
    if (name === 'insert') return INSERT_TOOLS.includes(t);
    return false;
  }

  /** Fecha o painel aberto ao clicar fora dele — sem isso o usuário teria que clicar
   * de novo no gatilho pra fechar, o que atrapalha num toolbar com vários grupos. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    if (this.openGroup() && !this.el.nativeElement.contains(ev.target as Node)) {
      this.openGroup.set(null);
    }
  }
}
