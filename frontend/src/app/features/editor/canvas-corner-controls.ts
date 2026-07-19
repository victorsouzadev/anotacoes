import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { EditorStore } from './engine/editor-store';
import { IconComponent } from '../../shared/icon';

/** Desfazer/refazer (canto inferior esquerdo) e zoom (canto inferior direito),
 * flutuando sobre o quadro — estilo Excalidraw. */
@Component({
  selector: 'app-canvas-corner-controls',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="history">
      <button (click)="onUndo()" [disabled]="!canUndo()" title="Desfazer (Ctrl+Z)"><app-icon name="undo" /></button>
      <button (click)="onRedo()" [disabled]="!canRedo()" title="Refazer (Ctrl+Y)"><app-icon name="redo" /></button>
    </div>
    <div class="zoom">
      <button (click)="onZoomOut()" title="Diminuir zoom"><app-icon name="zoom-out" /></button>
      <span class="zoom-pct">{{ zoomPercent() }}%</span>
      <button (click)="onZoomIn()" title="Aumentar zoom"><app-icon name="zoom-in" /></button>
      <span class="divider"></span>
      <button (click)="onFitToScreen()" title="Ajustar à tela"><app-icon name="fit-to-screen" /></button>
    </div>
  `,
  styles: [`
    :host { position: absolute; inset: 0; pointer-events: none; }
    .history, .zoom {
      position: absolute;
      bottom: 14px;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 2px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 4px;
      box-shadow: var(--shadow);
      pointer-events: auto;
    }
    .history { left: 14px; }
    .zoom { right: 14px; }
    .divider { width: 1px; height: 20px; background: var(--border); margin: 0 2px; flex-shrink: 0; }
    .zoom-pct { font-size: 12px; color: var(--text-muted); width: 40px; text-align: center; flex-shrink: 0; }
    button {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: transparent;
      border-radius: var(--radius-sm);
      color: var(--text);
      flex-shrink: 0;
      transition: background 0.12s, transform 0.1s;
    }
    button:hover:not(:disabled) { background: var(--bg); }
    button:active:not(:disabled) { transform: scale(0.92); }
    button:disabled { opacity: 0.35; cursor: default; }
  `],
})
export class CanvasCornerControlsComponent {
  @Input({ required: true }) store!: EditorStore;
  @Output() undo = new EventEmitter<void>();
  @Output() redo = new EventEmitter<void>();
  @Output() zoomIn = new EventEmitter<void>();
  @Output() zoomOut = new EventEmitter<void>();
  @Output() fitToScreen = new EventEmitter<void>();

  zoomPercent = signal(100);

  canUndo = () => this.store.history.canUndo();
  canRedo = () => this.store.history.canRedo();

  /** `viewport.scale` é um campo simples, não um signal — chamado depois de qualquer
   * ação que possa ter mudado o zoom fora dos botões daqui (ex.: `fitToScreen()`
   * automático ao abrir a nota/trocar de página, disparado por editor.page.ts). */
  refreshZoomPercent(): void {
    this.zoomPercent.set(Math.round(this.store.viewport.scale * 100));
  }

  onUndo(): void {
    this.undo.emit();
  }

  onRedo(): void {
    this.redo.emit();
  }

  onZoomIn(): void {
    this.zoomIn.emit();
    this.refreshZoomPercent();
  }

  onZoomOut(): void {
    this.zoomOut.emit();
    this.refreshZoomPercent();
  }

  onFitToScreen(): void {
    this.fitToScreen.emit();
    this.refreshZoomPercent();
  }
}
