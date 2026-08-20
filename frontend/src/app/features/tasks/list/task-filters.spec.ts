import { describe, expect, it } from 'vitest';
import { TaskItem } from '../models/task.model';
import { NO_CATEGORY, csvEscape, filterAndSortTasks, tasksToCsv } from './task-filters';

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: overrides.id ?? 'id-1',
    title: 'Tarefa',
    description: null,
    dueDate: null,
    priority: 'Medium',
    categoryIds: [],
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
    subtasks: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('filterAndSortTasks', () => {
  const now = new Date('2026-08-19T12:00:00.000Z');

  it('filtra por categoria', () => {
    const tasks = [task({ id: 'a', categoryIds: ['cat1'] }), task({ id: 'b', categoryIds: ['cat2'] })];
    const result = filterAndSortTasks(tasks, {
      categoryFilter: 'cat1',
      viewFilter: 'all',
      searchTerm: '',
      sortMode: 'dueDate',
      now,
    });
    expect(result.map((t) => t.id)).toEqual(['a']);
  });

  it('filtra tarefas sem categoria com NO_CATEGORY', () => {
    const tasks = [task({ id: 'a', categoryIds: ['cat1'] }), task({ id: 'b', categoryIds: [] })];
    const result = filterAndSortTasks(tasks, {
      categoryFilter: NO_CATEGORY,
      viewFilter: 'all',
      searchTerm: '',
      sortMode: 'dueDate',
      now,
    });
    expect(result.map((t) => t.id)).toEqual(['b']);
  });

  it('filtra tarefas atrasadas', () => {
    const tasks = [
      task({ id: 'past', dueDate: '2026-08-18T12:00:00.000Z' }),
      task({ id: 'future', dueDate: '2026-08-20T12:00:00.000Z' }),
      task({ id: 'done-past', dueDate: '2026-08-18T12:00:00.000Z', isCompleted: true }),
    ];
    const result = filterAndSortTasks(tasks, {
      categoryFilter: null,
      viewFilter: 'overdue',
      searchTerm: '',
      sortMode: 'dueDate',
      now,
    });
    expect(result.map((t) => t.id)).toEqual(['past']);
  });

  it('filtra tarefas sem prazo', () => {
    const tasks = [task({ id: 'a', dueDate: null }), task({ id: 'b', dueDate: '2026-08-20T12:00:00.000Z' })];
    const result = filterAndSortTasks(tasks, {
      categoryFilter: null,
      viewFilter: 'noDate',
      searchTerm: '',
      sortMode: 'dueDate',
      now,
    });
    expect(result.map((t) => t.id)).toEqual(['a']);
  });

  it('busca por título e descrição, case-insensitive', () => {
    const tasks = [
      task({ id: 'a', title: 'Comprar leite' }),
      task({ id: 'b', title: 'Estudar', description: 'Revisar LEITE de matemática' }),
      task({ id: 'c', title: 'Nada a ver' }),
    ];
    const result = filterAndSortTasks(tasks, {
      categoryFilter: null,
      viewFilter: 'all',
      searchTerm: 'leite',
      sortMode: 'created',
      now,
    });
    expect(result.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('ordena por prioridade (Alta, Média, Baixa)', () => {
    const tasks = [task({ id: 'low', priority: 'Low' }), task({ id: 'high', priority: 'High' }), task({ id: 'medium', priority: 'Medium' })];
    const result = filterAndSortTasks(tasks, {
      categoryFilter: null,
      viewFilter: 'all',
      searchTerm: '',
      sortMode: 'priority',
      now,
    });
    expect(result.map((t) => t.id)).toEqual(['high', 'medium', 'low']);
  });

  it('ordena por prazo, mandando tarefas sem prazo pro fim', () => {
    const tasks = [
      task({ id: 'no-date', dueDate: null }),
      task({ id: 'later', dueDate: '2026-09-01T00:00:00.000Z' }),
      task({ id: 'sooner', dueDate: '2026-08-20T00:00:00.000Z' }),
    ];
    const result = filterAndSortTasks(tasks, {
      categoryFilter: null,
      viewFilter: 'all',
      searchTerm: '',
      sortMode: 'dueDate',
      now,
    });
    expect(result.map((t) => t.id)).toEqual(['sooner', 'later', 'no-date']);
  });
});

describe('csvEscape', () => {
  it('escapa aspas duplicando-as e envolve em aspas', () => {
    expect(csvEscape('simples')).toBe('"simples"');
    expect(csvEscape('com "aspas"')).toBe('"com ""aspas"""');
  });
});

describe('tasksToCsv', () => {
  it('gera uma linha de cabeçalho e uma por tarefa', () => {
    const tasks = [task({ id: 'a', title: 'Tarefa A' }), task({ id: 'b', title: 'Tarefa B', isCompleted: true })];
    const csv = tasksToCsv(tasks, () => '', () => '');
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Título');
    expect(lines[1]).toContain('Tarefa A');
    expect(lines[2]).toContain('Sim');
  });
});
