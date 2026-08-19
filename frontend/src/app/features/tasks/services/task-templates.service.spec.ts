import { describe, expect, it } from 'vitest';
import { TaskFormResult } from '../components/task-form.component';
import { loadTemplates, templateFromResult } from './task-templates.service';

function result(overrides: Partial<TaskFormResult> = {}): TaskFormResult {
  return {
    title: 'Reunião semanal',
    description: 'Alinhar prioridades',
    dueDate: null,
    priority: 'Medium',
    categoryId: null,
    isRecurring: false,
    recurrenceRule: null,
    subtasks: [{ title: 'Preparar pauta', isCompleted: true, position: 0 }],
    ...overrides,
  };
}

describe('templateFromResult', () => {
  it('copia os campos do resultado do form, zerando subtarefas concluídas', () => {
    const template = templateFromResult('id-1', 'Modelo X', result());
    expect(template).toEqual({
      id: 'id-1',
      name: 'Modelo X',
      title: 'Reunião semanal',
      description: 'Alinhar prioridades',
      priority: 'Medium',
      categoryId: null,
      isRecurring: false,
      recurrenceRule: null,
      subtasks: [{ title: 'Preparar pauta', isCompleted: false, position: 0 }],
    });
  });
});

describe('loadTemplates', () => {
  it('retorna lista vazia quando não há nada salvo', () => {
    const storage = { getItem: () => null };
    expect(loadTemplates(storage)).toEqual([]);
  });

  it('faz parse do JSON salvo', () => {
    const template = templateFromResult('id-1', 'Modelo X', result());
    const storage = { getItem: () => JSON.stringify([template]) };
    expect(loadTemplates(storage)).toEqual([template]);
  });

  it('retorna lista vazia se o JSON estiver corrompido', () => {
    const storage = { getItem: () => '{not json' };
    expect(loadTemplates(storage)).toEqual([]);
  });
});
