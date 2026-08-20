import { describe, expect, it } from 'vitest';
import type { KanbanLane, TaskCategory, TaskItem } from './tasksApi.js';
import { findCategoryByName, findLaneByName, findTaskMatch } from './taskMatch.js';

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
    subtasks: '[]',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const alwaysTrue = () => true;

describe('findTaskMatch', () => {
  it('acha por id exato mesmo que o predicate exclua a tarefa', () => {
    const tasks = [task({ id: 'abc', title: 'Comprar pão', isCompleted: true })];
    const result = findTaskMatch(tasks, 'abc', (t) => !t.isCompleted);
    expect(result.task?.id).toBe('abc');
  });

  it('acha por trecho do título, case-insensitive', () => {
    const tasks = [task({ id: 'a', title: 'Comprar Pão' }), task({ id: 'b', title: 'Estudar' })];
    const result = findTaskMatch(tasks, 'pão', alwaysTrue);
    expect(result.task?.id).toBe('a');
  });

  it('retorna erro quando nada corresponde', () => {
    const tasks = [task({ id: 'a', title: 'Comprar pão' })];
    const result = findTaskMatch(tasks, 'inexistente', alwaysTrue);
    expect(result.task).toBeNull();
    expect(result.error).toContain('Nenhuma tarefa encontrada');
  });

  it('retorna erro com candidatos quando o título é ambíguo', () => {
    const tasks = [
      task({ id: 'a', title: 'Reunião de equipe' }),
      task({ id: 'b', title: 'Reunião com cliente' }),
    ];
    const result = findTaskMatch(tasks, 'reunião', alwaysTrue);
    expect(result.task).toBeNull();
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates?.map((c) => c.id).sort()).toEqual(['a', 'b']);
  });

  it('respeita o predicate ao buscar por título', () => {
    const tasks = [task({ id: 'a', title: 'Tarefa', isCompleted: true })];
    const result = findTaskMatch(tasks, 'tarefa', (t) => !t.isCompleted);
    expect(result.task).toBeNull();
  });
});

describe('findCategoryByName', () => {
  const categories: TaskCategory[] = [
    { id: 'c1', name: 'Trabalho', colorHex: '#000', updatedAt: '2026-01-01T00:00:00.000Z' },
  ];

  it('encontra por nome exato, ignorando maiúsculas/minúsculas e espaços', () => {
    expect(findCategoryByName(categories, '  trabalho  ')?.id).toBe('c1');
  });

  it('retorna undefined se não existir', () => {
    expect(findCategoryByName(categories, 'Pessoal')).toBeUndefined();
  });
});

describe('findLaneByName', () => {
  const lanes: KanbanLane[] = [
    { id: 'l1', name: 'Em andamento', colorHex: '#000', position: 0, updatedAt: '2026-01-01T00:00:00.000Z' },
  ];

  it('encontra por nome exato, ignorando maiúsculas/minúsculas e espaços', () => {
    expect(findLaneByName(lanes, '  EM ANDAMENTO  ')?.id).toBe('l1');
  });

  it('retorna undefined se não existir', () => {
    expect(findLaneByName(lanes, 'Feito')).toBeUndefined();
  });
});
