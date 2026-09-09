import { Injectable, computed, signal } from '@angular/core';

export type FocoPanelId = 'info' | 'subtasks' | 'notes' | 'pomodoro';
export type FocoColumn = 'left' | 'center' | 'right';

export const FOCO_COLUMNS: FocoColumn[] = ['left', 'center', 'right'];

export const FOCO_COLUMN_LABELS: Record<FocoColumn, string> = {
  left: 'Esquerda',
  center: 'Centro',
  right: 'Direita',
};

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

/** Estado completo do layout: os painéis e quais áreas estão recolhidas. */
export interface FocoLayoutState {
  panels: FocoPanelLayout[];
  collapsedColumns: FocoColumn[];
}

export const DEFAULT_FOCO_LAYOUT: FocoPanelLayout[] = [
  { id: 'info', column: 'left', collapsed: false },
  { id: 'subtasks', column: 'center', collapsed: false },
  { id: 'notes', column: 'center', collapsed: false },
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
      column: FOCO_COLUMNS.includes(item.column as FocoColumn) ? (item.column as FocoColumn) : 'center',
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

  const byColumn = new Map<FocoColumn, FocoPanelLayout[]>(
    FOCO_COLUMNS.map((c) => [c, layout.filter((p) => p.column === c && p.id !== panelId)]),
  );
  const target = byColumn.get(column)!;
  const at = Math.max(0, Math.min(index, target.length));
  target.splice(at, 0, { ...moved, column });

  return FOCO_COLUMNS.flatMap((c) => byColumn.get(c)!);
}

/** Aceita tanto o formato antigo (só o array de painéis) quanto o atual, com as áreas recolhidas. */
export function normalizeState(raw: unknown): FocoLayoutState {
  const source: Partial<FocoLayoutState> = Array.isArray(raw)
    ? { panels: raw as FocoPanelLayout[] }
    : ((raw ?? {}) as Partial<FocoLayoutState>);
  const collapsed = Array.isArray(source.collapsedColumns) ? source.collapsedColumns : [];
  return {
    panels: normalizeLayout(source.panels),
    collapsedColumns: FOCO_COLUMNS.filter((c) => collapsed.includes(c)),
  };
}

export function loadLayout(storage: Pick<Storage, 'getItem'>): FocoLayoutState {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return normalizeState(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeState(null);
  }
}

/** Layout da tela de foco: em que coluna cada painel fica, em que ordem, e se está colapsado. */
@Injectable({ providedIn: 'root' })
export class FocoLayoutService {
  private state = signal<FocoLayoutState>(loadLayout(localStorage));

  panels = computed(() => this.state().panels);
  collapsedColumns = computed(() => this.state().collapsedColumns);

  /** Colunas que têm algum painel — usado pra não deixar coluna vazia comendo espaço. */
  usedColumns = computed(() => FOCO_COLUMNS.filter((c) => this.panels().some((p) => p.column === c)));

  panelsIn(column: FocoColumn): FocoPanelLayout[] {
    return this.panels().filter((p) => p.column === column);
  }

  isColumnCollapsed(column: FocoColumn): boolean {
    return this.collapsedColumns().includes(column);
  }

  toggleColumnCollapsed(column: FocoColumn): void {
    const collapsed = this.isColumnCollapsed(column)
      ? this.collapsedColumns().filter((c) => c !== column)
      : [...this.collapsedColumns(), column];
    this.commit(this.panels(), collapsed);
  }

  setColumnsCollapsed(collapsed: boolean): void {
    this.commit(this.panels(), collapsed ? [...FOCO_COLUMNS] : []);
  }

  isCollapsed(id: FocoPanelId): boolean {
    return this.panels().find((p) => p.id === id)?.collapsed ?? false;
  }

  move(panelId: FocoPanelId, column: FocoColumn, index: number): void {
    this.commit(movePanel(this.panels(), panelId, column, index));
  }

  /** Manda o painel pra coluna vizinha, no fim dela — atalho dos botões ← / →. */
  shiftColumn(panelId: FocoPanelId, delta: number): void {
    const panel = this.panels().find((p) => p.id === panelId);
    if (!panel) return;
    const at = FOCO_COLUMNS.indexOf(panel.column) + delta;
    if (at < 0 || at >= FOCO_COLUMNS.length) return;
    const target = FOCO_COLUMNS[at];
    this.commit(movePanel(this.panels(), panelId, target, this.panelsIn(target).length));
  }

  canShift(panelId: FocoPanelId, delta: number): boolean {
    const panel = this.panels().find((p) => p.id === panelId);
    if (!panel) return false;
    const at = FOCO_COLUMNS.indexOf(panel.column) + delta;
    return at >= 0 && at < FOCO_COLUMNS.length;
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
    this.commit(DEFAULT_FOCO_LAYOUT.map((p) => ({ ...p })), []);
  }

  private commit(panels: FocoPanelLayout[], collapsedColumns = this.collapsedColumns()): void {
    const state: FocoLayoutState = { panels, collapsedColumns };
    this.state.set(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}
