import { randomUUID } from 'node:crypto';
import { authedFetch } from './auth.js';

export type Priority = 'Low' | 'Medium' | 'High';

export interface TaskCategory {
  id: string;
  name: string;
  colorHex: string;
  updatedAt: string;
}

export interface KanbanLane {
  id: string;
  name: string;
  colorHex: string;
  position: number;
  updatedAt: string;
}

export interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: Priority;
  categoryId: string | null;
  kanbanLaneId: string | null;
  isRecurring: boolean;
  recurrenceRule: string | null;
  isCompleted: boolean;
  createdAt: string;
  completedAt: string | null;
  deletedAt: string | null;
  completedPomodoros: number;
  position: number;
  locationLat: number | null;
  locationLng: number | null;
  locationRadiusMeters: number | null;
  locationLabel: string | null;
  subtasks: string;
  updatedAt: string;
}

export interface TaskComment {
  id: string;
  taskId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

async function asJson<T>(res: Response, action: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${action} falhou (HTTP ${res.status}): ${body}`);
  }
  return (await res.json()) as T;
}

export async function listCategories(): Promise<TaskCategory[]> {
  const res = await authedFetch('/api/tasks/categories');
  return asJson<TaskCategory[]>(res, 'Listar categorias');
}

export async function createCategory(name: string): Promise<TaskCategory> {
  const id = randomUUID();
  const res = await authedFetch(`/api/tasks/categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name,
      colorHex: '#6b7280',
      updatedAt: new Date().toISOString(),
    }),
  });
  return asJson<TaskCategory>(res, 'Criar categoria');
}

export async function renameCategory(category: TaskCategory, name: string): Promise<TaskCategory> {
  const res = await authedFetch(`/api/tasks/categories/${category.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name,
      colorHex: category.colorHex,
      updatedAt: new Date().toISOString(),
    }),
  });
  return asJson<TaskCategory>(res, 'Renomear categoria');
}

export async function deleteCategory(id: string): Promise<void> {
  const res = await authedFetch(`/api/tasks/categories/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '');
    throw new Error(`Apagar categoria falhou (HTTP ${res.status}): ${body}`);
  }
}

export async function listKanbanLanes(): Promise<KanbanLane[]> {
  const res = await authedFetch('/api/tasks/kanban-lanes');
  return asJson<KanbanLane[]>(res, 'Listar raias');
}

export async function createKanbanLane(name: string): Promise<KanbanLane> {
  const id = randomUUID();
  const lanes = await listKanbanLanes();
  const position = Math.max(-1, ...lanes.map((l) => l.position)) + 1;
  const res = await authedFetch(`/api/tasks/kanban-lanes/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name,
      colorHex: '#6b7280',
      position,
      updatedAt: new Date().toISOString(),
    }),
  });
  return asJson<KanbanLane>(res, 'Criar raia');
}

export async function renameKanbanLane(lane: KanbanLane, name: string): Promise<KanbanLane> {
  const res = await authedFetch(`/api/tasks/kanban-lanes/${lane.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name,
      colorHex: lane.colorHex,
      position: lane.position,
      updatedAt: new Date().toISOString(),
    }),
  });
  return asJson<KanbanLane>(res, 'Renomear raia');
}

export async function deleteKanbanLane(id: string): Promise<void> {
  const res = await authedFetch(`/api/tasks/kanban-lanes/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '');
    throw new Error(`Apagar raia falhou (HTTP ${res.status}): ${body}`);
  }
}

// Todas as tarefas do usuário (o backend não pagina — escala pessoal), incluindo concluídas e
// as que estão na lixeira (deletedAt setado). Filtragem fica por conta de quem chama.
export async function listTasks(): Promise<TaskItem[]> {
  const res = await authedFetch('/api/tasks/items');
  return asJson<TaskItem[]>(res, 'Listar tarefas');
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  priority?: Priority;
  categoryId?: string | null;
}

export async function createTask(input: CreateTaskInput): Promise<TaskItem> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const res = await authedFetch(`/api/tasks/items/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      title: input.title,
      description: input.description ?? null,
      dueDate: input.dueDate ?? null,
      priority: input.priority ?? 'Medium',
      categoryId: input.categoryId ?? null,
      isRecurring: false,
      recurrenceRule: null,
      isCompleted: false,
      createdAt: now,
      completedAt: null,
      deletedAt: null,
      completedPomodoros: 0,
      position: 0,
      locationLat: null,
      locationLng: null,
      locationRadiusMeters: null,
      locationLabel: null,
      subtasks: '[]',
      updatedAt: now,
    }),
  });
  return asJson<TaskItem>(res, 'Criar tarefa');
}

// Upsert é o único jeito de editar (o backend não tem PATCH) — manda a tarefa inteira de volta
// com os campos alterados e updatedAt novo, igual ao que o web/Android fazem.
export async function updateTask(task: TaskItem, changes: Partial<TaskItem>): Promise<TaskItem> {
  const merged = { ...task, ...changes, updatedAt: new Date().toISOString() };
  const res = await authedFetch(`/api/tasks/items/${task.id}`, {
    method: 'PUT',
    body: JSON.stringify(merged),
  });
  return asJson<TaskItem>(res, 'Atualizar tarefa');
}

export async function moveToTrash(task: TaskItem): Promise<TaskItem> {
  return updateTask(task, { deletedAt: new Date().toISOString() });
}

export async function restoreTask(task: TaskItem): Promise<TaskItem> {
  return updateTask(task, { deletedAt: null });
}

// Diferente de moveToTrash: apaga de vez (fora da lixeira), sem volta.
export async function deleteTaskForever(id: string): Promise<void> {
  const res = await authedFetch(`/api/tasks/items/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '');
    throw new Error(`Apagar tarefa falhou (HTTP ${res.status}): ${body}`);
  }
}

export async function listComments(taskId: string): Promise<TaskComment[]> {
  const res = await authedFetch(`/api/tasks/items/${taskId}/comments`);
  return asJson<TaskComment[]>(res, 'Listar comentários');
}

export async function addComment(taskId: string, text: string): Promise<TaskComment> {
  const res = await authedFetch(`/api/tasks/items/${taskId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
  return asJson<TaskComment>(res, 'Adicionar comentário');
}
