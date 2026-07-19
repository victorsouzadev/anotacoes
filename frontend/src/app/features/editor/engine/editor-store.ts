import { signal } from '@angular/core';
import { uuid } from '../../../core/uuid';
import { CanvasElement, PaperStyle, ToolType } from '../../../data/models';
import { Command, History } from './history';
import { Viewport } from './viewport';
import { CHECKLIST_DEFAULT_FONT_SIZE } from './checklist-layout';
import { STICKY_FONT_SIZE } from './sticky-layout';

export class EditorStore {
  elements = signal<CanvasElement[]>([]);
  selectedIds = signal<Set<string>>(new Set());
  tool = signal<ToolType>('select');
  penColor = signal('#1d1d1d');
  penThickness = signal(3);
  stickyColor = signal('#FAC775');
  fillShape = signal(false);
  paperStyle = signal<PaperStyle>('blank');

  viewport = new Viewport();
  history = new History();

  private nextZ = 1;

  nextZIndex(): number {
    return this.nextZ++;
  }

  private setElements(next: CanvasElement[]): void {
    this.elements.set(next);
  }

  addElement(el: CanvasElement): void {
    const before = this.elements();
    this.history.push({
      do: () => this.setElements([...this.elements(), el]),
      undo: () => this.setElements(before),
    });
  }

  removeElements(ids: string[]): void {
    const idSet = new Set(ids);
    const before = this.elements();
    const after = before.filter((e) => !idSet.has(e.id));
    this.history.push({
      do: () => this.setElements(after),
      undo: () => this.setElements(before),
    });
    this.clearSelection();
  }

  updateElement(id: string, patch: Partial<CanvasElement>, opts: { commit: boolean }): void {
    const before = this.elements();
    const after = before.map((e) => (e.id === id ? ({ ...e, ...patch } as CanvasElement) : e));
    if (opts.commit) {
      this.history.push({
        do: () => this.setElements(after),
        undo: () => this.setElements(before),
      });
    } else {
      // Preview durante arraste: não entra no histórico até soltar o ponteiro.
      this.setElements(after);
    }
  }

  updateElements(patches: Map<string, Partial<CanvasElement>>, opts: { commit: boolean }): void {
    const before = this.elements();
    const after = before.map((e) => {
      const patch = patches.get(e.id);
      return patch ? ({ ...e, ...patch } as CanvasElement) : e;
    });
    if (opts.commit) {
      this.history.push({
        do: () => this.setElements(after),
        undo: () => this.setElements(before),
      });
    } else {
      this.setElements(after);
    }
  }

  pushCommand(cmd: Command): void {
    this.history.push(cmd);
  }

  bringToFront(ids: string[]): void {
    const idSet = new Set(ids);
    const before = this.elements();
    const after = before.map((e) => (idSet.has(e.id) ? { ...e, zIndex: this.nextZIndex() } : e));
    this.history.push({
      do: () => this.setElements(after),
      undo: () => this.setElements(before),
    });
  }

  sendToBack(ids: string[]): void {
    const idSet = new Set(ids);
    const before = this.elements();
    const minZ = Math.min(0, ...before.map((e) => e.zIndex)) - 1;
    let offset = 0;
    const after = before.map((e) =>
      idSet.has(e.id) ? { ...e, zIndex: minZ - offset++ } : e,
    );
    this.history.push({
      do: () => this.setElements(after),
      undo: () => this.setElements(before),
    });
  }

  select(ids: string[]): void {
    this.selectedIds.set(new Set(ids));
  }

  clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  loadElements(elements: CanvasElement[]): void {
    // Notas salvas antes do campo fontSize existir no checklist/sticky não têm essa
    // prop no JSON persistido — sem isso, os cálculos de altura por fonte viram NaN.
    const normalized = elements.map((e) => {
      if (e.type === 'checklist' && e.fontSize == null) return { ...e, fontSize: CHECKLIST_DEFAULT_FONT_SIZE };
      if (e.type === 'sticky' && e.fontSize == null) return { ...e, fontSize: STICKY_FONT_SIZE };
      return e;
    });
    this.setElements(normalized);
    this.nextZ = elements.reduce((m, e) => Math.max(m, e.zIndex + 1), 1);
    this.history.clear();
    this.clearSelection();
  }

  duplicateSelection(): void {
    const ids = this.selectedIds();
    if (ids.size === 0) return;
    const offset = 12;
    const copies: CanvasElement[] = [];
    for (const e of this.elements()) {
      if (!ids.has(e.id)) continue;
      const copy = structuredClone(e) as CanvasElement;
      copy.id = uuid();
      copy.zIndex = this.nextZIndex();
      translateElement(copy, offset, offset);
      copies.push(copy);
    }
    const before = this.elements();
    const after = [...before, ...copies];
    this.history.push({
      do: () => this.setElements(after),
      undo: () => this.setElements(before),
    });
    this.select(copies.map((c) => c.id));
  }
}

export function translateElement(e: CanvasElement, dx: number, dy: number): void {
  switch (e.type) {
    case 'stroke':
      e.points = e.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      break;
    case 'shape':
    case 'text':
    case 'sticky':
    case 'checklist':
    case 'image':
    case 'pomodoro':
      e.x += dx;
      e.y += dy;
      break;
    case 'arrow':
      e.from = { x: e.from.x + dx, y: e.from.y + dy };
      e.to = { x: e.to.x + dx, y: e.to.y + dy };
      if (e.curve) e.curve = { x: e.curve.x + dx, y: e.curve.y + dy };
      break;
  }
}
