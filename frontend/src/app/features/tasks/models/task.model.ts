export type Priority = 'Low' | 'Medium' | 'High';

export interface TaskCategory {
  id: string;
  name: string;
  colorHex: string;
  updatedAt: string;
}

// Raia do quadro Kanban — independente de categoria, o usuário monta o próprio fluxo
// (ex.: "A fazer"/"Em andamento"/"Feito" ou qualquer outra sequência).
export interface KanbanLane {
  id: string;
  name: string;
  colorHex: string;
  position: number;
  updatedAt: string;
}

export interface Subtask {
  title: string;
  isCompleted: boolean;
  position: number;
}

// Forma "de fio" — subtasks chega como string JSON opaca, igual ao Elements das notas.
export interface TaskItemWire {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: Priority;
  categoryIds: string[];
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

// Forma usada pela UI — subtasks já parseadas.
export interface TaskItem extends Omit<TaskItemWire, 'subtasks'> {
  subtasks: Subtask[];
}

export const POMODORO_WORK_SECONDS = 25 * 60;

export function totalTimeSpent(completedPomodoros: number): number {
  return completedPomodoros * POMODORO_WORK_SECONDS;
}

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

export interface TaskComment {
  id: string;
  taskId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export const CATEGORY_COLORS = [
  '#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#4b5563', '#ea580c',
];

export const RECURRENCE_WEEKDAYS = [
  { value: 'MONDAY', label: 'Seg' },
  { value: 'TUESDAY', label: 'Ter' },
  { value: 'WEDNESDAY', label: 'Qua' },
  { value: 'THURSDAY', label: 'Qui' },
  { value: 'FRIDAY', label: 'Sex' },
  { value: 'SATURDAY', label: 'Sáb' },
  { value: 'SUNDAY', label: 'Dom' },
];

/** Codifica no mesmo formato compacto que o app Android usa em Task.recurrenceRule. */
export function encodeRecurrence(kind: 'DAILY' | 'WEEKLY' | 'MONTHLY', param?: string | number): string | null {
  if (kind === 'DAILY') return `DAILY:${param ?? 1}`;
  if (kind === 'WEEKLY') return param ? `WEEKLY:${param}` : null;
  return 'MONTHLY';
}

export interface DecodedRecurrence {
  kind: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  intervalDays?: number;
  daysOfWeek?: string[];
}

export function decodeRecurrence(raw: string | null): DecodedRecurrence | null {
  if (!raw) return null;
  const [kind, param] = raw.split(':');
  if (kind === 'DAILY') return { kind: 'DAILY', intervalDays: Number(param) || 1 };
  if (kind === 'WEEKLY') return { kind: 'WEEKLY', daysOfWeek: param ? param.split(',') : [] };
  if (kind === 'MONTHLY') return { kind: 'MONTHLY' };
  return null;
}
