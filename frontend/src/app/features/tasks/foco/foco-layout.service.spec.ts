import { describe, expect, it } from 'vitest';
import { DEFAULT_FOCO_LAYOUT, FocoPanelLayout, loadLayout, movePanel, normalizeLayout } from './foco-layout.service';

const layout = (): FocoPanelLayout[] => DEFAULT_FOCO_LAYOUT.map((p) => ({ ...p }));
const idsIn = (list: FocoPanelLayout[], column: 'left' | 'right') =>
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

  it('sanea valores inválidos', () => {
    const result = normalizeLayout([{ id: 'info', column: 'meio', collapsed: 'sim' }]);
    expect(result[0]).toEqual({ id: 'info', column: 'right', collapsed: false });
  });
});

describe('movePanel', () => {
  it('move para a outra coluna na posição pedida', () => {
    const result = movePanel(layout(), 'notes', 'left', 0);
    expect(idsIn(result, 'left')).toEqual(['notes', 'info']);
    expect(idsIn(result, 'right')).toEqual(['subtasks', 'pomodoro']);
  });

  it('reordena dentro da mesma coluna', () => {
    const result = movePanel(layout(), 'pomodoro', 'right', 0);
    expect(idsIn(result, 'right')).toEqual(['pomodoro', 'subtasks', 'notes']);
  });

  it('prende o índice aos limites da coluna', () => {
    const result = movePanel(layout(), 'info', 'right', 99);
    expect(idsIn(result, 'right')).toEqual(['subtasks', 'notes', 'pomodoro', 'info']);
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

describe('loadLayout', () => {
  it('sobrevive a JSON corrompido no storage', () => {
    expect(loadLayout({ getItem: () => '{{{' })).toEqual(DEFAULT_FOCO_LAYOUT);
  });

  it('lê o que foi salvo', () => {
    const saved = JSON.stringify(movePanel(layout(), 'notes', 'left', 0));
    expect(idsIn(loadLayout({ getItem: () => saved }), 'left')).toEqual(['notes', 'info']);
  });
});
