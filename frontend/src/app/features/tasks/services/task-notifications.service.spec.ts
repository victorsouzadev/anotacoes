import { describe, expect, it } from 'vitest';
import { TaskItem } from '../models/task.model';
import { dueSoon } from './task-notifications.service';

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: overrides.id ?? 'id-1',
    title: 'Tarefa',
    description: null,
    dueDate: null,
    priority: 'Medium',
    categoryId: null,
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

describe('dueSoon', () => {
  const now = new Date('2026-08-19T12:00:00.000Z');

  it('inclui tarefas com prazo dentro da janela', () => {
    const tasks = [task({ id: 'a', dueDate: '2026-08-19T12:10:00.000Z' })];
    expect(dueSoon(tasks, now, 15).map((t) => t.id)).toEqual(['a']);
  });

  it('exclui tarefas com prazo fora da janela', () => {
    const tasks = [task({ id: 'a', dueDate: '2026-08-19T13:00:00.000Z' })];
    expect(dueSoon(tasks, now, 15)).toEqual([]);
  });

  it('exclui tarefas já concluídas ou apagadas', () => {
    const tasks = [
      task({ id: 'done', dueDate: '2026-08-19T12:05:00.000Z', isCompleted: true }),
      task({ id: 'deleted', dueDate: '2026-08-19T12:05:00.000Z', deletedAt: '2026-08-19T00:00:00.000Z' }),
    ];
    expect(dueSoon(tasks, now, 15)).toEqual([]);
  });

  it('exclui tarefas sem prazo ou já vencidas', () => {
    const tasks = [
      task({ id: 'no-date', dueDate: null }),
      task({ id: 'past', dueDate: '2026-08-19T11:00:00.000Z' }),
    ];
    expect(dueSoon(tasks, now, 15)).toEqual([]);
  });
});
