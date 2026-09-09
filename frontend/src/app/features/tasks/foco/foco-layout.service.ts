import { Injectable, computed, signal } from '@angular/core';

export type FocoPanelId = 'info' | 'subtasks' | 'notes' | 'pomodoro';
export type FocoColumn = 'left' | 'right';

export interface FocoPanelLayout {
  id: FocoPanelId;
  column: FocoColumn;
  collapsed: boolean;
}

export const FOCO_PANEL_LABELS: Record<FocoPanelId, string> = {
  info: 'Tarefa',
  subtasks: 'Subtarefas',
  notes: 'Anotações',
  pomodoro: 'Pomodoro',
};

const STORAGE_KEY = 'tasks.foco.layout.v1';

export const DEFAULT_FOCO_LAYOUT: FocoPanelLayout[] = [
  { id: 'info', column: 'left', collapsed: false },
  { id: 'subtasks', column: 'right', collapsed: false },
  { id: 'notes', column: 'right', collapsed: false },
  { id: 'pomodoro', column: 'right', collapsed: false },
];

/** Normaliza o que veio do storage: descarta lixo, completa painel faltando e mantém a ordem salva. */
export function normalizeLayout(raw: unknown): FocoPanelLayout[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<FocoPanelId>();
  const result: FocoPanelLayout[] = [];

  for (const entry of list) {
    const item = entry as Partial<FocoPanelLayout>;
    const id = item?.id as FocoPanelId;
    if (!DEFAULT_FOCO_LAYOUT.some((d) => d.id === id) || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      column: item.column === 'left' ? 'left' : 'right',
      collapsed: item.collapsed === true,
    });
  }

  for (const fallback of DEFAULT_FOCO_LAYOUT) {
    if (!seen.has(fallback.id)) result.push({ ...fallback });
  }
  return result;
}

/**
 * Move `panelId` para `column`, na posição `index` **dentro daquela coluna**. A lista global é
 * reconstruída a partir das duas colunas, então a ordem relativa de quem não se moveu é preservada.
 */
export function movePanel(
  layout: FocoPanelLayout[],
  panelId: FocoPanelId,
  column: FocoColumn,
  index: number,
): FocoPanelLayout[] {
  const moved = layout.find((p) => p.id === panelId);
  if (!moved) return layout;

  const left = layout.filter((p) => p.column === 'left' && p.id !== panelId);
  const right = layout.filter((p) => p.column === 'right' && p.id !== panelId);
  const target = column === 'left' ? left : right;
  const at = Math.max(0, Math.min(index, target.length));
  target.splice(at, 0, { ...moved, column });

  return [...left, ...right];
}

export function loadLayout(storage: Pick<Storage, 'getItem'>): FocoPanelLayout[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return normalizeLayout(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeLayout(null);
  }
}

/** Layout da tela de foco: em que coluna cada painel fica, em que ordem, e se está colapsado. */
@Injectable({ providedIn: 'root' })
export class FocoLayoutService {
  panels = signal<FocoPanelLayout[]>(loadLayout(localStorage));

  left = computed(() => this.panels().filter((p) => p.column === 'left'));
  right = computed(() => this.panels().filter((p) => p.column === 'right'));

  panelsIn(column: FocoColumn): FocoPanelLayout[] {
    return column === 'left' ? this.left() : this.right();
  }

  isCollapsed(id: FocoPanelId): boolean {
    return this.panels().find((p) => p.id === id)?.collapsed ?? false;
  }

  move(panelId: FocoPanelId, column: FocoColumn, index: number): void {
    this.commit(movePanel(this.panels(), panelId, column, index));
  }

  /** Manda o painel pra outra coluna, no fim dela — atalho dos botões ← / →. */
  switchColumn(panelId: FocoPanelId): void {
    const panel = this.panels().find((p) => p.id === panelId);
    if (!panel) return;
    const target: FocoColumn = panel.column === 'left' ? 'right' : 'left';
    this.commit(movePanel(this.panels(), panelId, target, this.panelsIn(target).length));
  }

  moveBy(panelId: FocoPanelId, delta: number): void {
    const panel = this.panels().find((p) => p.id === panelId);
    if (!panel) return;
    const inColumn = this.panelsIn(panel.column);
    const current = inColumn.findIndex((p) => p.id === panelId);
    this.commit(movePanel(this.panels(), panelId, panel.column, current + delta));
  }

  toggleCollapsed(panelId: FocoPanelId): void {
    this.commit(this.panels().map((p) => (p.id === panelId ? { ...p, collapsed: !p.collapsed } : p)));
  }

  setCollapsedAll(collapsed: boolean): void {
    this.commit(this.panels().map((p) => ({ ...p, collapsed })));
  }

  reset(): void {
    this.commit(DEFAULT_FOCO_LAYOUT.map((p) => ({ ...p })));
  }

  private commit(panels: FocoPanelLayout[]): void {
    this.panels.set(panels);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(panels));
  }
}
