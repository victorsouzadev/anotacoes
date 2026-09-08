import { describe, expect, it } from 'vitest';
import { TaskCategory, TaskItem } from '../models/task.model';
import { NO_CATEGORY, csvEscape, filterAndSortTasks, groupTasksByFirstCategory, tasksToCsv } from './task-filters';

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: overrides.id ?? 'id-1',
    title: 'Tarefa',
    description: null,
    dueDate: null,
    priority: 'Medium',
    categoryIds: [],
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
      categoryFilterIds: ['cat1'],
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
      categoryFilterIds: [NO_CATEGORY],
      viewFilter: 'all',
      searchTerm: '',
      sortMode: 'dueDate',
      now,
    });
    expect(result.map((t) => t.id)).toEqual(['b']);
  });

  it('filtra por mais de uma categoria (união)', () => {
    const tasks = [
      task({ id: 'a', categoryIds: ['cat1'] }),
      task({ id: 'b', categoryIds: ['cat2'] }),
      task({ id: 'c', categoryIds: ['cat3'] }),
    ];
    const result = filterAndSortTasks(tasks, {
      categoryFilterIds: ['cat1', 'cat2'],
      viewFilter: 'all',
      searchTerm: '',
      sortMode: 'dueDate',
      now,
    });
    expect(result.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('combina NO_CATEGORY com outra categoria selecionada', () => {
    const tasks = [
      task({ id: 'a', categoryIds: ['cat1'] }),
      task({ id: 'b', categoryIds: [] }),
      task({ id: 'c', categoryIds: ['cat2'] }),
    ];
    const result = filterAndSortTasks(tasks, {
      categoryFilterIds: [NO_CATEGORY, 'cat1'],
      viewFilter: 'all',
      searchTerm: '',
      sortMode: 'dueDate',
      now,
    });
    expect(result.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('filtra tarefas atrasadas', () => {
    const tasks = [
      task({ id: 'past', dueDate: '2026-08-18T12:00:00.000Z' }),
      task({ id: 'future', dueDate: '2026-08-20T12:00:00.000Z' }),
      task({ id: 'done-past', dueDate: '2026-08-18T12:00:00.000Z', isCompleted: true }),
    ];
    const result = filterAndSortTasks(tasks, {
      categoryFilterIds: [],
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
      categoryFilterIds: [],
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
      categoryFilterIds: [],
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
      categoryFilterIds: [],
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
      categoryFilterIds: [],
      viewFilter: 'all',
      searchTerm: '',
      sortMode: 'dueDate',
      now,
    });
    expect(result.map((t) => t.id)).toEqual(['sooner', 'later', 'no-date']);
  });
});

describe('groupTasksByFirstCategory', () => {
  function category(id: string, name: string): TaskCategory {
    return { id, name, colorHex: '#000', updatedAt: '2026-01-01T00:00:00.000Z' };
  }

  it('agrupa pela primeira categoria da tarefa, sem duplicar em outros grupos', () => {
    const categories = [category('cat1', 'Trabalho'), category('cat2', 'Casa')];
    const tasks = [
      task({ id: 'a', categoryIds: ['cat1', 'cat2'] }),
      task({ id: 'b', categoryIds: ['cat2'] }),
    ];
    const groups = groupTasksByFirstCategory(tasks, categories);
    expect(groups.map((g) => g.label)).toEqual(['Trabalho', 'Casa']);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['a']);
    expect(groups[1].tasks.map((t) => t.id)).toEqual(['b']);
  });

  it('coloca tarefas sem categoria num grupo "Sem categoria" por último', () => {
    const categories = [category('cat1', 'Trabalho')];
    const tasks = [task({ id: 'a', categoryIds: [] }), task({ id: 'b', categoryIds: ['cat1'] })];
    const groups = groupTasksByFirstCategory(tasks, categories);
    expect(groups.map((g) => g.label)).toEqual(['Trabalho', 'Sem categoria']);
    expect(groups[1].categoryId).toBeNull();
    expect(groups[1].tasks.map((t) => t.id)).toEqual(['a']);
  });

  it('omite grupos de categorias sem nenhuma tarefa', () => {
    const categories = [category('cat1', 'Trabalho'), category('cat2', 'Casa')];
    const tasks = [task({ id: 'a', categoryIds: ['cat1'] })];
    const groups = groupTasksByFirstCategory(tasks, categories);
    expect(groups.map((g) => g.label)).toEqual(['Trabalho']);
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
