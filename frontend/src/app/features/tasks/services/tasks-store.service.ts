import { Injectable, computed, signal } from '@angular/core';
import { uuid } from '../../../core/uuid';
import { KanbanLane, Subtask, TaskAttachment, TaskCategory, TaskComment, TaskItem } from '../models/task.model';
import { TaskUpsertInput, TasksService } from './tasks.service';

export interface TaskStateSnapshot {
  id: string;
  isCompleted: boolean;
  completedAt: string | null;
  deletedAt: string | null;
}

type TaskDraft = Partial<
  Pick<
    TaskUpsertInput,
    | 'title'
    | 'description'
    | 'dueDate'
    | 'priority'
    | 'categoryId'
    | 'kanbanLaneId'
    | 'isRecurring'
    | 'recurrenceRule'
    | 'locationLabel'
  >
> & { subtasks?: Subtask[] };

@Injectable({ providedIn: 'root' })
export class TasksStoreService {
  categories = signal<TaskCategory[]>([]);
  kanbanLanes = signal<KanbanLane[]>([]);
  tasks = signal<TaskItem[]>([]);
  loading = signal(true);

  activeTasks = computed(() => this.tasks().filter((t) => !t.deletedAt));
  trashedTasks = computed(() =>
    this.tasks()
      .filter((t) => !!t.deletedAt)
      .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')),
  );

  constructor(private api: TasksService) {}

  async reload(): Promise<void> {
    this.loading.set(true);
    const [categories, lanes, tasks] = await Promise.all([
      this.api.listCategories(),
      this.api.listKanbanLanes(),
      this.api.listTasks(),
    ]);
    this.categories.set(categories);
    this.kanbanLanes.set(lanes);
    this.tasks.set(tasks);
    this.loading.set(false);
  }

  categoryFor(task: TaskItem): TaskCategory | undefined {
    return task.categoryId ? this.categories().find((c) => c.id === task.categoryId) : undefined;
  }

  laneFor(task: TaskItem): KanbanLane | undefined {
    return task.kanbanLaneId ? this.kanbanLanes().find((l) => l.id === task.kanbanLaneId) : undefined;
  }

  async createTask(draft: TaskDraft): Promise<TaskItem> {
    const now = new Date().toISOString();
    const id = uuid();
    const maxPosition = Math.max(0, ...this.activeTasks().map((t) => t.position));
    const created = await this.api.upsertTask(id, {
      title: draft.title?.trim() || 'Sem título',
      description: draft.description ?? null,
      dueDate: draft.dueDate ?? null,
      priority: draft.priority ?? 'Medium',
      categoryId: draft.categoryId ?? null,
      kanbanLaneId: draft.kanbanLaneId ?? null,
      isRecurring: draft.isRecurring ?? false,
      recurrenceRule: draft.recurrenceRule ?? null,
      isCompleted: false,
      createdAt: now,
      completedAt: null,
      deletedAt: null,
      completedPomodoros: 0,
      position: maxPosition + 1,
      locationLat: null,
      locationLng: null,
      locationRadiusMeters: null,
      locationLabel: draft.locationLabel ?? null,
      subtasks: draft.subtasks ?? [],
      updatedAt: now,
    });
    this.tasks.update((list) => [...list, created]);
    return created;
  }

  async updateTask(task: TaskItem, patch: TaskDraft): Promise<void> {
    await this.save(task, patch);
  }

  async toggleComplete(task: TaskItem): Promise<void> {
    await this.setCompleted(task, !task.isCompleted);
  }

  async setCompleted(task: TaskItem, isCompleted: boolean): Promise<void> {
    if (task.isCompleted === isCompleted) return;
    await this.save(task, {}, { isCompleted, completedAt: isCompleted ? new Date().toISOString() : null });
  }

  async toggleSubtask(task: TaskItem, index: number): Promise<void> {
    const subtasks = task.subtasks.map((s, i) => (i === index ? { ...s, isCompleted: !s.isCompleted } : s));
    await this.save(task, { subtasks });
  }

  async moveToTrash(task: TaskItem): Promise<void> {
    await this.save(task, {}, { deletedAt: new Date().toISOString() });
  }

  async restore(task: TaskItem): Promise<void> {
    await this.save(task, {}, { deletedAt: null });
  }

  async deleteForever(task: TaskItem): Promise<void> {
    await this.api.deleteTaskForever(task.id);
    this.tasks.update((list) => list.filter((t) => t.id !== task.id));
  }

  async duplicateTask(task: TaskItem): Promise<TaskItem> {
    return this.createTask({
      title: `${task.title} (cópia)`,
      description: task.description,
      dueDate: task.dueDate,
      priority: task.priority,
      categoryId: task.categoryId,
      kanbanLaneId: task.kanbanLaneId,
      isRecurring: task.isRecurring,
      recurrenceRule: task.recurrenceRule,
      locationLabel: task.locationLabel,
      subtasks: task.subtasks.map((s) => ({ ...s, isCompleted: false })),
    });
  }

  async bulkComplete(tasks: TaskItem[], isCompleted: boolean): Promise<void> {
    await Promise.all(
      tasks.map((t) => this.save(t, {}, { isCompleted, completedAt: isCompleted ? new Date().toISOString() : null })),
    );
  }

  async bulkTrash(tasks: TaskItem[]): Promise<void> {
    const deletedAt = new Date().toISOString();
    await Promise.all(tasks.map((t) => this.save(t, {}, { deletedAt })));
  }

  async bulkSetCategory(tasks: TaskItem[], categoryId: string | null): Promise<void> {
    await Promise.all(tasks.map((t) => this.save(t, { categoryId })));
  }

  /** Captura o estado mutável por ações em massa, pra permitir desfazer depois. */
  snapshotState(task: TaskItem): TaskStateSnapshot {
    return { id: task.id, isCompleted: task.isCompleted, completedAt: task.completedAt, deletedAt: task.deletedAt };
  }

  async restoreState(snapshots: TaskStateSnapshot[]): Promise<void> {
    const byId = new Map(this.tasks().map((t) => [t.id, t]));
    await Promise.all(
      snapshots.map((s) => {
        const task = byId.get(s.id);
        if (!task) return Promise.resolve();
        return this.save(task, {}, { isCompleted: s.isCompleted, completedAt: s.completedAt, deletedAt: s.deletedAt });
      }),
    );
  }

  listComments(taskId: string): Promise<TaskComment[]> {
    return this.api.listComments(taskId);
  }

  addComment(taskId: string, text: string): Promise<TaskComment> {
    return this.api.addComment(taskId, text);
  }

  deleteComment(taskId: string, commentId: string): Promise<void> {
    return this.api.deleteComment(taskId, commentId);
  }

  listAttachments(taskId: string): Promise<TaskAttachment[]> {
    return this.api.listAttachments(taskId);
  }

  addAttachment(taskId: string, fileName: string, contentType: string, dataBase64: string): Promise<TaskAttachment> {
    return this.api.addAttachment(taskId, fileName, contentType, dataBase64);
  }

  deleteAttachment(taskId: string, attachmentId: string): Promise<void> {
    return this.api.deleteAttachment(taskId, attachmentId);
  }

  downloadAttachment(taskId: string, attachmentId: string): Promise<Blob> {
    return this.api.downloadAttachment(taskId, attachmentId);
  }

  async incrementPomodoro(task: TaskItem): Promise<void> {
    await this.save(task, {}, { completedPomodoros: task.completedPomodoros + 1 });
  }

  async reorder(orderedIds: string[]): Promise<void> {
    const byId = new Map(this.tasks().map((t) => [t.id, t]));
    await Promise.all(
      orderedIds.map((id, index) => {
        const task = byId.get(id);
        return task && task.position !== index ? this.save(task, {}, { position: index }) : Promise.resolve();
      }),
    );
  }

  async createCategory(name: string, colorHex: string): Promise<TaskCategory> {
    const id = uuid();
    const category = await this.api.upsertCategory(id, name.trim(), colorHex, new Date().toISOString());
    this.categories.update((list) => [...list, category].sort((a, b) => a.name.localeCompare(b.name)));
    return category;
  }

  async renameCategory(category: TaskCategory, name: string, colorHex: string): Promise<void> {
    const updated = await this.api.upsertCategory(category.id, name.trim(), colorHex, new Date().toISOString());
    this.categories.update((list) =>
      list.map((c) => (c.id === category.id ? updated : c)).sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async deleteCategory(category: TaskCategory): Promise<void> {
    await this.api.deleteCategory(category.id);
    this.categories.update((list) => list.filter((c) => c.id !== category.id));
    this.tasks.update((list) => list.map((t) => (t.categoryId === category.id ? { ...t, categoryId: null } : t)));
  }

  async createLane(name: string, colorHex: string): Promise<KanbanLane> {
    const id = uuid();
    const position = Math.max(-1, ...this.kanbanLanes().map((l) => l.position)) + 1;
    const lane = await this.api.upsertKanbanLane(id, name.trim(), colorHex, position, new Date().toISOString());
    this.kanbanLanes.update((list) => [...list, lane].sort((a, b) => a.position - b.position));
    return lane;
  }

  async renameLane(lane: KanbanLane, name: string, colorHex: string): Promise<void> {
    const updated = await this.api.upsertKanbanLane(lane.id, name.trim(), colorHex, lane.position, new Date().toISOString());
    this.kanbanLanes.update((list) =>
      list.map((l) => (l.id === lane.id ? updated : l)).sort((a, b) => a.position - b.position),
    );
  }

  async deleteLane(lane: KanbanLane): Promise<void> {
    await this.api.deleteKanbanLane(lane.id);
    this.kanbanLanes.update((list) => list.filter((l) => l.id !== lane.id));
    this.tasks.update((list) => list.map((t) => (t.kanbanLaneId === lane.id ? { ...t, kanbanLaneId: null } : t)));
  }

  async reorderLanes(orderedIds: string[]): Promise<void> {
    const byId = new Map(this.kanbanLanes().map((l) => [l.id, l]));
    const updated = await Promise.all(
      orderedIds.map(async (id, index) => {
        const lane = byId.get(id);
        if (!lane || lane.position === index) return lane;
        return this.api.upsertKanbanLane(lane.id, lane.name, lane.colorHex, index, new Date().toISOString());
      }),
    );
    this.kanbanLanes.update((list) => {
      const merged = new Map(list.map((l) => [l.id, l]));
      for (const lane of updated) if (lane) merged.set(lane.id, lane);
      return [...merged.values()].sort((a, b) => a.position - b.position);
    });
  }

  async setTaskLane(task: TaskItem, kanbanLaneId: string | null): Promise<void> {
    if (task.kanbanLaneId === kanbanLaneId) return;
    await this.save(task, { kanbanLaneId });
  }

  /** Aplica um patch parcial numa tarefa e persiste — sempre reenvia o objeto inteiro (upsert idempotente). */
  private async save(task: TaskItem, draft: TaskDraft, overrides: Partial<TaskItem> = {}): Promise<void> {
    const now = new Date().toISOString();
    const merged: TaskItem = {
      ...task,
      title: draft.title !== undefined ? draft.title.trim() || task.title : task.title,
      description: draft.description !== undefined ? draft.description : task.description,
      dueDate: draft.dueDate !== undefined ? draft.dueDate : task.dueDate,
      priority: draft.priority ?? task.priority,
      categoryId: draft.categoryId !== undefined ? draft.categoryId : task.categoryId,
      kanbanLaneId: draft.kanbanLaneId !== undefined ? draft.kanbanLaneId : task.kanbanLaneId,
      isRecurring: draft.isRecurring ?? task.isRecurring,
      recurrenceRule: draft.recurrenceRule !== undefined ? draft.recurrenceRule : task.recurrenceRule,
      subtasks: draft.subtasks ?? task.subtasks,
      ...overrides,
      updatedAt: now,
    };
    const saved = await this.api.upsertTask(task.id, {
      title: merged.title,
      description: merged.description,
      dueDate: merged.dueDate,
      priority: merged.priority,
      categoryId: merged.categoryId,
      kanbanLaneId: merged.kanbanLaneId,
      isRecurring: merged.isRecurring,
      recurrenceRule: merged.recurrenceRule,
      isCompleted: merged.isCompleted,
      createdAt: merged.createdAt,
      completedAt: merged.completedAt,
      deletedAt: merged.deletedAt,
      completedPomodoros: merged.completedPomodoros,
      position: merged.position,
      locationLat: merged.locationLat,
      locationLng: merged.locationLng,
      locationRadiusMeters: merged.locationRadiusMeters,
      locationLabel: merged.locationLabel,
      subtasks: merged.subtasks,
      updatedAt: merged.updatedAt,
    });
    this.tasks.update((list) => list.map((t) => (t.id === task.id ? saved : t)));
  }
}
