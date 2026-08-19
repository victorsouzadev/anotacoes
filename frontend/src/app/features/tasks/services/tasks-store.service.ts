import { Injectable, computed, signal } from '@angular/core';
import { uuid } from '../../../core/uuid';
import { Subtask, TaskAttachment, TaskCategory, TaskComment, TaskItem } from '../models/task.model';
import { TaskUpsertInput, TasksService } from './tasks.service';

type TaskDraft = Partial<
  Pick<
    TaskUpsertInput,
    | 'title'
    | 'description'
    | 'dueDate'
    | 'priority'
    | 'categoryId'
    | 'isRecurring'
    | 'recurrenceRule'
    | 'locationLabel'
  >
> & { subtasks?: Subtask[] };

@Injectable({ providedIn: 'root' })
export class TasksStoreService {
  categories = signal<TaskCategory[]>([]);
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
    const [categories, tasks] = await Promise.all([this.api.listCategories(), this.api.listTasks()]);
    this.categories.set(categories);
    this.tasks.set(tasks);
    this.loading.set(false);
  }

  categoryFor(task: TaskItem): TaskCategory | undefined {
    return task.categoryId ? this.categories().find((c) => c.id === task.categoryId) : undefined;
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
    const isCompleted = !task.isCompleted;
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
