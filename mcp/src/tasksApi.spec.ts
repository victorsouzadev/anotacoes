import { beforeEach, describe, expect, it, vi } from 'vitest';

const authedFetch = vi.fn();
vi.mock('./auth.js', () => ({ authedFetch: (...args: unknown[]) => authedFetch(...args) }));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('tasksApi', () => {
  beforeEach(() => {
    authedFetch.mockReset();
  });

  it('createTask manda um payload de tarefa completo com defaults corretos', async () => {
    authedFetch.mockResolvedValue(jsonResponse({ id: 'x' }));
    const api = await import('./tasksApi.js');

    await api.createTask({ title: 'Nova tarefa' });

    expect(authedFetch).toHaveBeenCalledTimes(1);
    const [path, init] = authedFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toMatch(/^\/api\/tasks\/items\/[0-9a-f-]+$/);
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body as string);
    expect(body.title).toBe('Nova tarefa');
    expect(body.priority).toBe('Medium');
    expect(body.isCompleted).toBe(false);
    expect(body.deletedAt).toBeNull();
    expect(body.subtasks).toBe('[]');
  });

  it('updateTask mescla mudanças sobre a tarefa existente e atualiza updatedAt', async () => {
    authedFetch.mockResolvedValue(jsonResponse({ id: 'x' }));
    const api = await import('./tasksApi.js');

    const task: import('./tasksApi.js').TaskItem = {
      id: 'x',
      title: 'Antigo',
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
    };

    await api.updateTask(task, { title: 'Novo título', isCompleted: true });

    const [path, init] = authedFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/tasks/items/x');
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body as string);
    expect(body.title).toBe('Novo título');
    expect(body.isCompleted).toBe(true);
    expect(body.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('moveToTrash seta deletedAt e restoreTask limpa de novo', async () => {
    authedFetch.mockImplementation(async () => jsonResponse({ id: 'x' }));
    const api = await import('./tasksApi.js');
    const task = { id: 'x', updatedAt: '2026-01-01T00:00:00.000Z' } as import('./tasksApi.js').TaskItem;

    await api.moveToTrash(task);
    let body = JSON.parse((authedFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.deletedAt).not.toBeNull();

    authedFetch.mockClear();
    await api.restoreTask(task);
    body = JSON.parse((authedFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.deletedAt).toBeNull();
  });

  it('addComment posta o texto e retorna o comentário criado', async () => {
    authedFetch.mockResolvedValue(jsonResponse({ id: 'c1', taskId: 'x', text: 'oi' }));
    const api = await import('./tasksApi.js');

    const comment = await api.addComment('x', 'oi');

    expect(comment.id).toBe('c1');
    const [path, init] = authedFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/tasks/items/x/comments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ text: 'oi' });
  });

  it('joga erro descritivo quando a resposta não é ok', async () => {
    authedFetch.mockResolvedValue(new Response('boom', { status: 500 }));
    const api = await import('./tasksApi.js');

    await expect(api.listTasks()).rejects.toThrow(/HTTP 500/);
  });

  it('deleteTaskForever não lança erro em 404 (idempotente)', async () => {
    authedFetch.mockResolvedValue(new Response(null, { status: 404 }));
    const api = await import('./tasksApi.js');

    await expect(api.deleteTaskForever('x')).resolves.toBeUndefined();
  });

  it('createKanbanLane coloca a nova raia no fim da posição atual', async () => {
    authedFetch.mockImplementation(async (path: string) => {
      if (path === '/api/tasks/kanban-lanes') {
        return jsonResponse([
          { id: 'a', name: 'A fazer', colorHex: '#000', position: 0, updatedAt: '2026-01-01T00:00:00.000Z' },
          { id: 'b', name: 'Feito', colorHex: '#000', position: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
        ]);
      }
      return jsonResponse({ id: 'c', name: 'Em andamento', colorHex: '#6b7280', position: 2, updatedAt: '2026-01-01T00:00:00.000Z' });
    });
    const api = await import('./tasksApi.js');

    await api.createKanbanLane('Em andamento');

    const putCall = authedFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
    const body = JSON.parse((putCall![1] as RequestInit).body as string);
    expect(body.name).toBe('Em andamento');
    expect(body.position).toBe(2);
  });

  it('createKanbanLane usa posição 0 quando não há raias ainda', async () => {
    authedFetch.mockImplementation(async (path: string) => {
      if (path === '/api/tasks/kanban-lanes') return jsonResponse([]);
      return jsonResponse({ id: 'a', name: 'A fazer', colorHex: '#6b7280', position: 0, updatedAt: '2026-01-01T00:00:00.000Z' });
    });
    const api = await import('./tasksApi.js');

    await api.createKanbanLane('A fazer');

    const putCall = authedFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
    const body = JSON.parse((putCall![1] as RequestInit).body as string);
    expect(body.position).toBe(0);
  });

  it('deleteKanbanLane não lança erro em 404 (idempotente)', async () => {
    authedFetch.mockResolvedValue(new Response(null, { status: 404 }));
    const api = await import('./tasksApi.js');

    await expect(api.deleteKanbanLane('x')).resolves.toBeUndefined();
  });
});
