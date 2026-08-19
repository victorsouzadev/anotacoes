import { randomUUID } from 'node:crypto';
import { authedFetch } from './auth.js';

export type Priority = 'Low' | 'Medium' | 'High';

export interface TaskCategory {
  id: string;
  name: string;
  colorHex: string;
  updatedAt: string;
}

export interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: Priority;
  categoryId: string | null;
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
