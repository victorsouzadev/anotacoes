/** Painel Camadas, no molde do Illustrator: colunas de visibilidade e trava à
 * esquerda, miniatura do desenho, nome editável com duplo clique, marcador de
 * seleção à direita e ordem mudada arrastando a linha. */

import { Component, computed, inject, signal } from '@angular/core';
import { FocusOnInitDirective } from '../../shared/focus-on-init.directive';
import { IlIconComponent } from './illustration-icons';
import { IllustrationStore } from './illustration-store';
import { Layer } from './illustration-model';

interface Row {
  layer: Layer;
  index: number;
  viewBox: string;
  d: string;
  stroke: number;
}

@Component({
  selector: 'il-layers',
  standalone: true,
  imports: [IlIconComponent, FocusOnInitDirective],
  template: `
    <div class="ly-list" (dragleave)="onLeave($event)">
      @for (r of rows(); track r.layer.id) {
        <div
          class="ly-row"
          [class.ly-sel]="selected().has(r.layer.id)"
          [class.ly-off]="!r.layer.visible"
          [class.ly-grouped]="r.layer.groupId"
          [class.ly-drop-above]="drop()?.id === r.layer.id && drop()?.above"
          [class.ly-drop-below]="drop()?.id === r.layer.id && !drop()?.above"
          draggable="true"
          (dragstart)="onDragStart($event, r.layer.id)"
          (dragover)="onDragOver($event, r.layer.id)"
          (drop)="onDrop($event, r)"
          (dragend)="drop.set(null)"
          (click)="onClick($event, r.layer.id)"
        >
          <button type="button" class="ly-col" [attr.aria-label]="r.layer.visible ? 'Ocultar' : 'Mostrar'" [title]="r.layer.visible ? 'Ocultar' : 'Mostrar'" (click)="$event.stopPropagation(); store.patch(r.layer.id, { visible: !r.layer.visible })">
            <il-icon [name]="r.layer.visible ? 'eye' : 'eye-off'" [size]="14" />
          </button>
          <button type="button" class="ly-col" [class.ly-dim]="!r.layer.locked" [attr.aria-label]="r.layer.locked ? 'Destravar' : 'Travar'" [title]="r.layer.locked ? 'Destravar' : 'Travar'" (click)="$event.stopPropagation(); store.patch(r.layer.id, { locked: !r.layer.locked })">
            <il-icon [name]="r.layer.locked ? 'lock' : 'unlock'" [size]="13" />
          </button>
          <svg class="ly-thumb" [attr.viewBox]="r.viewBox" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            @if (r.layer.kind === 'imagem') {
              <image [attr.href]="r.layer.src" [attr.x]="-r.layer.w / 2" [attr.y]="-r.layer.h / 2" [attr.width]="r.layer.w" [attr.height]="r.layer.h" preserveAspectRatio="none" />
            } @else {
              <path [attr.d]="r.d" fill-rule="evenodd" [attr.fill]="r.layer.fill ?? 'none'" [attr.stroke]="r.layer.stroke ?? (r.layer.fill ? null : '#888')" [attr.stroke-width]="r.stroke" />
            }
          </svg>
          @if (editing() === r.layer.id) {
            <input class="ly-name-edit" [value]="r.layer.name" (click)="$event.stopPropagation()" (keydown.enter)="rename(r.layer.id, $event)" (keydown.escape)="editing.set(null)" (blur)="rename(r.layer.id, $event)" appFocusOnInit />
          } @else {
            <span class="ly-name" (dblclick)="editing.set(r.layer.id)" [title]="r.layer.name + ' — duplo clique pra renomear'">{{ r.layer.name }}</span>
          }
          @if (r.layer.cut) { <il-icon class="ly-badge ly-cut" name="cut" [size]="12" title="Linha de corte" /> }
          @if (r.layer.groupId) { <span class="ly-badge" title="Em grupo">G</span> }
          <span class="ly-target" [class.ly-target-on]="selected().has(r.layer.id)"></span>
        </div>
      } @empty {
        <p class="ly-empty">Nenhuma camada. Desenhe, escreva ou vetorize uma imagem.</p>
      }
    </div>
    <div class="ly-foot">
      <span class="ly-count">{{ store.layers().length }} camada(s)</span>
      <button type="button" class="il-ib" [disabled]="store.selection().length < 2" data-tip="Agrupar  Ctrl+G" aria-label="Agrupar" (click)="store.group()"><il-icon name="group" /></button>
      <button type="button" class="il-ib" [disabled]="!grouped()" data-tip="Desagrupar  Ctrl+Shift+G" aria-label="Desagrupar" (click)="store.ungroup()"><il-icon name="ungroup" /></button>
      <button type="button" class="il-ib" [disabled]="!store.selection().length" data-tip="Duplicar  Ctrl+D" aria-label="Duplicar" (click)="store.duplicate(store.selectedIds())"><il-icon name="copy" /></button>
      <button type="button" class="il-ib" [disabled]="!store.selection().length" data-tip="Apagar  Delete" aria-label="Apagar" (click)="store.remove(store.selectedIds())"><il-icon name="trash" /></button>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; flex: 1; }
    .ly-list { flex: 1; overflow-y: auto; min-height: 0; }
    .ly-row {
      position: relative; display: flex; align-items: center; gap: 4px; height: 32px; padding: 0 8px 0 2px;
      border-bottom: 1px solid var(--il-line); cursor: default; user-select: none;
    }
    .ly-row:hover { background: var(--il-hover); }
    .ly-row.ly-sel { background: var(--il-active); }
    .ly-row.ly-off .ly-thumb, .ly-row.ly-off .ly-name { opacity: 0.45; }
    .ly-row.ly-grouped { box-shadow: inset 3px 0 0 var(--il-line-strong); }
    .ly-row.ly-drop-above::before, .ly-row.ly-drop-below::after {
      content: ''; position: absolute; left: 0; right: 0; height: 2px; background: var(--il-blue); z-index: 1;
    }
    .ly-row.ly-drop-above::before { top: -1px; }
    .ly-row.ly-drop-below::after { bottom: -1px; }
    .ly-col { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: none; background: none; color: var(--text); border-radius: 3px; flex-shrink: 0; }
    .ly-col:hover { background: var(--il-hover); }
    .ly-col.ly-dim { color: transparent; }
    .ly-row:hover .ly-col.ly-dim { color: var(--text-muted); }
    .ly-thumb { width: 26px; height: 22px; flex-shrink: 0; background: #fff; border: 1px solid var(--il-line); border-radius: 2px; }
    .ly-name { flex: 1; min-width: 0; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ly-name-edit { flex: 1; min-width: 0; height: 22px; font: inherit; font-size: 12px; padding: 0 4px; color: var(--text); background: var(--il-field); border: 1px solid var(--il-blue); border-radius: 3px; }
    .ly-badge { font-size: 9px; font-weight: 700; color: var(--text-muted); flex-shrink: 0; }
    .ly-cut { color: #e53935; }
    .ly-target { width: 9px; height: 9px; border: 1px solid var(--il-line-strong); border-radius: 50%; flex-shrink: 0; }
    .ly-target.ly-target-on { background: var(--il-blue); border-color: var(--il-blue); border-radius: 1px; }
    .ly-empty { margin: 14px 12px; font-size: 11px; color: var(--text-muted); line-height: 1.5; }
    .ly-foot { display: flex; align-items: center; gap: 2px; padding: 4px 6px; border-top: 1px solid var(--il-line); background: var(--il-chrome); }
    .ly-count { flex: 1; font-size: 11px; color: var(--text-muted); padding-left: 4px; }
  `],
})
export class IlLayersComponent {
  store = inject(IllustrationStore);
  editing = signal<string | null>(null);
  drop = signal<{ id: string; above: boolean } | null>(null);
  private dragging: string | null = null;

  selected = computed(() => new Set(this.store.selectedIds()));
  grouped = computed(() => this.store.selection().some((l) => l.groupId));

  /** Da frente pra trás, como em todo editor: a de cima da lista é a de cima do desenho. */
  rows = computed<Row[]>(() => {
    this.store.fonts.version();
    const list = this.store.layers();
    return list.map((layer, index) => {
      const b = this.store.localBounds(layer);
      const w = Math.max(b.maxX - b.minX, 0.01), h = Math.max(b.maxY - b.minY, 0.01);
      const pad = Math.max(w, h) * 0.08;
      return {
        layer, index,
        viewBox: `${b.minX - pad} ${b.minY - pad} ${w + pad * 2} ${h + pad * 2}`,
        d: this.store.pathD(layer),
        stroke: Math.max(w, h) / 22,
      };
    }).reverse();
  });

  onClick(event: MouseEvent, id: string): void {
    this.store.select(id, event.shiftKey || event.ctrlKey || event.metaKey);
  }

  rename(id: string, event: Event): void {
    if (this.editing() !== id) return;
    const name = (event.target as HTMLInputElement).value.trim();
    this.editing.set(null);
    const l = this.store.layer(id);
    if (name && l && name !== l.name) this.store.patch(id, { name });
  }

  onDragStart(event: DragEvent, id: string): void {
    this.dragging = id;
    event.dataTransfer?.setData('text/plain', id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onDragOver(event: DragEvent, id: string): void {
    if (!this.dragging) return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.drop.set({ id, above: event.clientY < rect.top + rect.height / 2 });
  }

  onLeave(event: DragEvent): void {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) this.drop.set(null);
  }

  onDrop(event: DragEvent, target: Row): void {
    event.preventDefault();
    const id = this.dragging;
    const d = this.drop();
    this.dragging = null;
    this.drop.set(null);
    if (!id || !d || id === target.layer.id) return;
    const from = this.store.layers().findIndex((l) => l.id === id);
    // Posição na pilha sem a camada arrastada; "acima" na lista é na frente.
    const k = target.index - (from < target.index ? 1 : 0);
    this.store.moveLayerTo(id, d.above ? k + 1 : k);
  }
}
