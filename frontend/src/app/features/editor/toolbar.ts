import { Component, Input } from '@angular/core';
import { ToolType } from '../../data/models';
import { EditorStore } from './engine/editor-store';
import { IconComponent } from '../../shared/icon';

/** Pílula flutuante de ferramentas, estilo Excalidraw — cada ícone já troca a
 * ferramenta direto, sem menus/dropdown. Cor/espessura/preenchimento ficam no
 * painel de propriedades (app-properties-panel), que aparece conforme a
 * ferramenta ativa. */
@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="toolbar">
      <button [class.active]="tool() === 'select'" (click)="setTool('select')" title="Selecionar"><app-icon name="select" /></button>
      <button [class.active]="tool() === 'pan'" (click)="setTool('pan')" title="Mover tela"><app-icon name="pan" /></button>
      <span class="divider"></span>
      <button [class.active]="tool() === 'pen'" (click)="setTool('pen')" title="Caneta"><app-icon name="pen" /></button>
      <button [class.active]="tool() === 'eraser-stroke'" (click)="setTool('eraser-stroke')" title="Borracha (traço)"><app-icon name="eraser-stroke" /></button>
      <button [class.active]="tool() === 'eraser-area'" (click)="setTool('eraser-area')" title="Borracha (área)"><app-icon name="eraser-area" /></button>
      <span class="divider"></span>
      <button [class.active]="tool() === 'rect'" (click)="setTool('rect')" title="Retângulo"><app-icon name="rect" /></button>
      <button [class.active]="tool() === 'ellipse'" (click)="setTool('ellipse')" title="Elipse"><app-icon name="ellipse" /></button>
      <button [class.active]="tool() === 'line'" (click)="setTool('line')" title="Linha"><app-icon name="line" /></button>
      <button [class.active]="tool() === 'arrow'" (click)="setTool('arrow')" title="Seta (segure Shift p/ ângulo)"><app-icon name="arrow" /></button>
      <span class="divider"></span>
      <button [class.active]="tool() === 'text'" (click)="setTool('text')" title="Texto"><app-icon name="text" /></button>
      <button [class.active]="tool() === 'sticky'" (click)="setTool('sticky')" title="Nota adesiva"><app-icon name="sticky" /></button>
      <button [class.active]="tool() === 'checklist'" (click)="setTool('checklist')" title="Lista de tarefas"><app-icon name="checklist" /></button>
      <button [class.active]="tool() === 'pomodoro'" (click)="setTool('pomodoro')" title="Pomodoro"><app-icon name="pomodoro" /></button>
    </div>
  `,
  styles: [`
    .toolbar {
      position: absolute;
      top: 14px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      max-width: calc(100vw - 28px);
      gap: 2px;
      align-items: center;
      padding: 6px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
    }
    .divider { width: 1px; height: 22px; background: var(--border); margin: 0 3px; flex-shrink: 0; }
    button {
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: transparent;
      border-radius: var(--radius-sm);
      color: var(--text);
      flex-shrink: 0;
      transition: background 0.12s, color 0.12s, transform 0.1s;
    }
    button:hover:not(.active) { background: var(--bg); }
    button:active { transform: scale(0.92); }
    button.active { background: var(--accent); color: #fff; }
    @media (max-width: 560px) {
      button { width: 32px; height: 32px; }
    }
  `],
})
export class ToolbarComponent {
  @Input({ required: true }) store!: EditorStore;

  get tool() { return this.store.tool; }

  setTool(t: ToolType): void {
    this.store.tool.set(t);
  }
}
