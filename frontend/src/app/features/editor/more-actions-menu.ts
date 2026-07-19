import { Component, ElementRef, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PaperStyle } from '../../data/models';
import { EditorStore } from './engine/editor-store';
import { IconComponent } from '../../shared/icon';

/** Botão "⋯" no canto superior direito do quadro, abrindo um painel compacto com
 * as ações menos frequentes (duplicar/excluir/ordem/exportar/estilo de papel) —
 * estilo Excalidraw, onde essas ações ficam fora da barra principal de ferramentas. */
@Component({
  selector: 'app-more-actions-menu',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <button class="trigger" [class.open]="open()" (click)="toggle()" title="Mais ações">
      <app-icon name="more" />
    </button>
    @if (open()) {
      <div class="panel">
        <div class="row">
          <button (click)="duplicate.emit(); close()" title="Duplicar seleção (Ctrl+D)"><app-icon name="duplicate" />Duplicar</button>
          <button (click)="deleteSelection.emit(); close()" title="Excluir seleção (Delete)"><app-icon name="delete" />Excluir</button>
        </div>
        <div class="row">
          <button (click)="bringToFront.emit(); close()" title="Trazer para frente"><app-icon name="bring-to-front" />Frente</button>
          <button (click)="sendToBack.emit(); close()" title="Enviar para trás"><app-icon name="send-to-back" />Trás</button>
        </div>
        <div class="row">
          <button (click)="exportPng.emit(exportTransparent); close()" title="Exportar a página atual como imagem PNG"><app-icon name="download" />Exportar PNG</button>
        </div>
        <label class="export-option">
          <input type="checkbox" [(ngModel)]="exportTransparent" />
          Fundo transparente
        </label>
        <select class="paper-select" [ngModel]="store.paperStyle()" (ngModelChange)="paperStyleChange.emit($event)" title="Estilo da folha">
          <option value="blank">Folha lisa</option>
          <option value="ruled">Folha pautada</option>
          <option value="grid">Folha quadriculada</option>
        </select>
      </div>
    }
  `,
  styles: [`
    :host { position: absolute; top: 14px; right: 14px; z-index: 10; }
    .trigger {
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
      background: var(--surface);
      border-radius: var(--radius-lg);
      color: var(--text);
      box-shadow: var(--shadow-lg);
    }
    .trigger.open { border-color: var(--accent); background: var(--accent-soft); }
    .trigger:hover { border-color: var(--accent); }
    .panel {
      position: absolute;
      top: 44px;
      right: 0;
      z-index: 11;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px;
      box-shadow: var(--shadow-lg);
      min-width: 200px;
      max-width: calc(100vw - 28px);
    }
    .row { display: flex; align-items: center; gap: 6px; }
    .row button {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--border);
      background: var(--bg);
      border-radius: var(--radius-sm);
      padding: 7px 10px;
      font-size: 13px;
      white-space: nowrap;
    }
    .row button:hover { border-color: var(--accent); }
    .paper-select { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 7px 8px; font-size: 13px; background: var(--bg); width: 100%; }
    .export-option { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-muted); padding: 4px 2px 0; }
  `],
})
export class MoreActionsMenuComponent {
  @Input({ required: true }) store!: EditorStore;
  @Output() duplicate = new EventEmitter<void>();
  @Output() deleteSelection = new EventEmitter<void>();
  @Output() bringToFront = new EventEmitter<void>();
  @Output() sendToBack = new EventEmitter<void>();
  @Output() exportPng = new EventEmitter<boolean>();
  @Output() paperStyleChange = new EventEmitter<PaperStyle>();

  exportTransparent = false;
  open = signal(false);

  constructor(private el: ElementRef<HTMLElement>) {}

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    if (this.open() && !this.el.nativeElement.contains(ev.target as Node)) {
      this.open.set(false);
    }
  }
}
