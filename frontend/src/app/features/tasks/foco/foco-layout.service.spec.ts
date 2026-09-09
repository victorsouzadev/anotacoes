import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOCO_LAYOUT,
  FocoColumn,
  FocoPanelLayout,
  loadLayout,
  movePanel,
  normalizeLayout,
  normalizeState,
} from './foco-layout.service';

const layout = (): FocoPanelLayout[] => DEFAULT_FOCO_LAYOUT.map((p) => ({ ...p }));
const idsIn = (list: FocoPanelLayout[], column: FocoColumn) =>
  list.filter((p) => p.column === column).map((p) => p.id);

describe('normalizeLayout', () => {
  it('cai no padrão quando não há nada salvo', () => {
    expect(normalizeLayout(null)).toEqual(DEFAULT_FOCO_LAYOUT);
  });

  it('descarta painel desconhecido e repetido', () => {
    const result = normalizeLayout([
      { id: 'notes', column: 'left', collapsed: true },
      { id: 'notes', column: 'right', collapsed: false },
      { id: 'inventado', column: 'left', collapsed: false },
    ]);
    expect(result.filter((p) => p.id === 'notes')).toHaveLength(1);
    expect(result.map((p) => p.id).sort()).toEqual(['info', 'notes', 'pomodoro', 'subtasks']);
  });

  it('completa painel faltando, preservando a ordem salva', () => {
    const result = normalizeLayout([{ id: 'pomodoro', column: 'left', collapsed: false }]);
    expect(result[0].id).toBe('pomodoro');
    expect(result.map((p) => p.id)).toContain('notes');
  });

  it('sanea valores inválidos, caindo na coluna do meio', () => {
    const result = normalizeLayout([{ id: 'info', column: 'diagonal', collapsed: 'sim' }]);
    expect(result[0]).toEqual({ id: 'info', column: 'center', collapsed: false });
  });

  it('aceita as três colunas', () => {
    const result = normalizeLayout([
      { id: 'info', column: 'left', collapsed: false },
      { id: 'notes', column: 'center', collapsed: false },
      { id: 'pomodoro', column: 'right', collapsed: false },
    ]);
    expect(result.slice(0, 3).map((p) => p.column)).toEqual(['left', 'center', 'right']);
  });
});

describe('movePanel', () => {
  it('move para outra coluna na posição pedida', () => {
    const result = movePanel(layout(), 'notes', 'left', 0);
    expect(idsIn(result, 'left')).toEqual(['notes', 'info']);
    expect(idsIn(result, 'center')).toEqual(['subtasks']);
  });

  it('move para a coluna do meio sem mexer nas outras', () => {
    const result = movePanel(layout(), 'pomodoro', 'center', 1);
    expect(idsIn(result, 'center')).toEqual(['subtasks', 'pomodoro', 'notes']);
    expect(idsIn(result, 'right')).toEqual([]);
    expect(idsIn(result, 'left')).toEqual(['info']);
  });

  it('reordena dentro da mesma coluna', () => {
    const result = movePanel(layout(), 'notes', 'center', 0);
    expect(idsIn(result, 'center')).toEqual(['notes', 'subtasks']);
  });

  it('prende o índice aos limites da coluna', () => {
    const result = movePanel(layout(), 'info', 'center', 99);
    expect(idsIn(result, 'center')).toEqual(['subtasks', 'notes', 'info']);
    expect(idsIn(result, 'left')).toEqual([]);
  });

  it('ignora painel inexistente', () => {
    const before = layout();
    expect(movePanel(before, 'sumido' as never, 'left', 0)).toBe(before);
  });

  it('preserva o estado de colapso ao mover', () => {
    const source = layout().map((p) => (p.id === 'notes' ? { ...p, collapsed: true } : p));
    const result = movePanel(source, 'notes', 'left', 0);
    expect(result.find((p) => p.id === 'notes')?.collapsed).toBe(true);
  });
});

describe('normalizeState', () => {
  it('aceita o formato antigo, que era só o array de painéis', () => {
    const state = normalizeState(movePanel(layout(), 'notes', 'left', 0));
    expect(idsIn(state.panels, 'left')).toEqual(['notes', 'info']);
    expect(state.collapsedColumns).toEqual([]);
  });

  it('mantém as áreas recolhidas, na ordem das colunas', () => {
    const state = normalizeState({ panels: layout(), collapsedColumns: ['right', 'left'] });
    expect(state.collapsedColumns).toEqual(['left', 'right']);
  });

  it('descarta área inexistente', () => {
    const state = normalizeState({ panels: layout(), collapsedColumns: ['fundo'] });
    expect(state.collapsedColumns).toEqual([]);
  });
});

describe('loadLayout', () => {
  it('sobrevive a JSON corrompido no storage', () => {
    expect(loadLayout({ getItem: () => '{{{' })).toEqual({ panels: DEFAULT_FOCO_LAYOUT, collapsedColumns: [] });
  });

  it('lê o que foi salvo', () => {
    const saved = JSON.stringify({
      panels: movePanel(layout(), 'notes', 'right', 0),
      collapsedColumns: ['left'],
    });
    const state = loadLayout({ getItem: () => saved });
    expect(idsIn(state.panels, 'right')).toEqual(['notes', 'pomodoro']);
    expect(state.collapsedColumns).toEqual(['left']);
  });
});
