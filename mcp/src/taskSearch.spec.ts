import { describe, expect, it } from 'vitest';
import type { TaskCategory, TaskItem } from './tasksApi.js';
import { searchTasks } from './taskSearch.js';

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: overrides.id ?? 'id-1',
    title: 'Tarefa',
    description: null,
    dueDate: null,
    priority: 'Medium',
    categoryId: null,
    kanbanLaneId: null,
    isRecurring: false,
    recurrenceRule: null,
    isCompleted: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    deletedAt: null,
    completedPomodoros: 0,
    position: 0,
    locationLat: null,
    locationLng: null,
    locationRadiusMeters: null,
    locationLabel: null,
    subtasks: '[]',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const categories: TaskCategory[] = [
  { id: 'work', name: 'Trabalho', colorHex: '#000', updatedAt: '2026-01-01T00:00:00.000Z' },
];

describe('searchTasks', () => {
  it('exclui concluídas e apagadas por padrão', () => {
    const tasks = [
      task({ id: 'a' }),
      task({ id: 'b', isCompleted: true }),
      task({ id: 'c', deletedAt: '2026-01-02T00:00:00.000Z' }),
    ];
    expect(searchTasks(tasks, categories, {}).map((t) => t.id)).toEqual(['a']);
  });

  it('inclui concluídas/apagadas quando pedido', () => {
    const tasks = [task({ id: 'a', isCompleted: true }), task({ id: 'b', deletedAt: '2026-01-02T00:00:00.000Z' })];
    const result = searchTasks(tasks, categories, { includeCompleted: true, includeDeleted: true });
    expect(result.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('filtra por texto em título ou descrição', () => {
    const tasks = [
      task({ id: 'a', title: 'Comprar leite' }),
      task({ id: 'b', title: 'Estudar', description: 'Revisar leite de matemática' }),
      task({ id: 'c', title: 'Nada a ver' }),
    ];
    const result = searchTasks(tasks, categories, { query: 'leite' });
    expect(result.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('filtra por categoria pelo nome', () => {
    const tasks = [task({ id: 'a', categoryId: 'work' }), task({ id: 'b', categoryId: null })];
    expect(searchTasks(tasks, categories, { categoryName: 'Trabalho' }).map((t) => t.id)).toEqual(['a']);
  });

  it('retorna lista vazia se a categoria não existir', () => {
    const tasks = [task({ id: 'a', categoryId: 'work' })];
    expect(searchTasks(tasks, categories, { categoryName: 'Inexistente' })).toEqual([]);
  });

  it('filtra por prioridade', () => {
    const tasks = [task({ id: 'a', priority: 'High' }), task({ id: 'b', priority: 'Low' })];
    expect(searchTasks(tasks, categories, { priority: 'High' }).map((t) => t.id)).toEqual(['a']);
  });

  it('filtra por dueBefore e dueAfter', () => {
    const tasks = [
      task({ id: 'early', dueDate: '2026-08-01T00:00:00.000Z' }),
      task({ id: 'mid', dueDate: '2026-08-15T00:00:00.000Z' }),
      task({ id: 'late', dueDate: '2026-08-30T00:00:00.000Z' }),
      task({ id: 'none', dueDate: null }),
    ];
    const result = searchTasks(tasks, categories, {
      dueAfter: '2026-08-05T00:00:00.000Z',
      dueBefore: '2026-08-20T00:00:00.000Z',
    });
    expect(result.map((t) => t.id)).toEqual(['mid']);
  });
});
